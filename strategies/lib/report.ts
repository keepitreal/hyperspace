import { analyzeMae, type MaeBucket, type MaeStats } from "./mae.js";
import { summarize, summarizeBySide, type Summary } from "./metrics.js";
import type { Trade } from "./runner.js";

function bps(n: number): string {
  if (!Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}bps`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(4);
  return p.toPrecision(5);
}

function isoMin(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

function formatExitCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "(none)";
  return entries.map(([k, v]) => `${k}=${v}`).join(" ");
}

function printSummaryLine(label: string, s: Summary): void {
  if (s.count === 0) {
    process.stdout.write(`  ${label.padEnd(6)} (no trades)\n`);
    return;
  }
  process.stdout.write(
    `  ${label.padEnd(6)} n=${String(s.count).padStart(4)}  win=${pct(s.winRate).padStart(6)}  avg=${bps(s.avgPnlBps).padStart(9)}  med=${bps(s.medianPnlBps).padStart(9)}  total=${bps(s.totalReturnBps).padStart(10)}  best=${bps(s.bestBps).padStart(9)}  worst=${bps(s.worstBps).padStart(9)}  bars=${s.avgBarsHeld.toFixed(1).padStart(5)}\n`,
  );
  process.stdout.write(`         exits: ${formatExitCounts(s.exitCounts)}\n`);
}

export function printPerSymbolReport(coin: string, trades: readonly Trade[]): void {
  process.stdout.write(`\n== ${coin} ==\n`);
  printSummaryLine("all", summarize(trades));
  const { long, short } = summarizeBySide(trades);
  printSummaryLine("long", long);
  printSummaryLine("short", short);
}

export function printAggregateReport(trades: readonly Trade[]): void {
  process.stdout.write(`\n== aggregate ==\n`);
  printSummaryLine("all", summarize(trades));
  const { long, short } = summarizeBySide(trades);
  printSummaryLine("long", long);
  printSummaryLine("short", short);
}

function fmtBucketLabel(b: MaeBucket): string {
  if (b.upper === Number.POSITIVE_INFINITY) return `>=${b.lower}bps`;
  return `${b.lower}-${b.upper}bps`;
}

function bar(count: number, max: number, width: number): string {
  if (max <= 0) return "";
  const filled = Math.round((count / max) * width);
  return "█".repeat(filled);
}

function printBuckets(label: string, stats: MaeStats): void {
  if (stats.count === 0) {
    process.stdout.write(`  ${label} (n=0): (no trades)\n`);
    return;
  }
  const max = stats.buckets.reduce((m, b) => (b.count > m ? b.count : m), 0);
  process.stdout.write(
    `  ${label} (n=${stats.count})  p50=${stats.p50.toFixed(0)}bps  p75=${stats.p75.toFixed(0)}bps  p90=${stats.p90.toFixed(0)}bps  p95=${stats.p95.toFixed(0)}bps\n`,
  );
  for (const b of stats.buckets) {
    if (b.count === 0) continue;
    const label = fmtBucketLabel(b).padEnd(11);
    const countStr = String(b.count).padStart(3);
    process.stdout.write(`    ${label} ${countStr}  ${bar(b.count, max, 30)}\n`);
  }
}

export function printMaeAnalysis(label: string, trades: readonly Trade[]): void {
  if (trades.length === 0) return;
  const a = analyzeMae(trades);
  process.stdout.write(`\n== MAE: ${label} ==\n`);
  printBuckets("winners", a.winners);
  printBuckets("losers ", a.losers);
  process.stdout.write(`  stop-loss scenarios (frictionless, wick-fill assumed):\n`);
  process.stdout.write(
    `    stop    win-killed  loser-capped  small→worse  original     simulated    delta\n`,
  );
  for (const s of a.stopScenarios) {
    const stopStr = `${s.stopBps}bps`.padStart(6);
    const wkStr = String(s.winnersKilled).padStart(10);
    const lcStr = String(s.losersStopped).padStart(12);
    const swStr = String(s.smallLossesWorsened).padStart(11);
    const origStr = `${s.originalTotalBps >= 0 ? "+" : ""}${s.originalTotalBps.toFixed(0)}bps`.padStart(12);
    const simStr = `${s.simulatedTotalBps >= 0 ? "+" : ""}${s.simulatedTotalBps.toFixed(0)}bps`.padStart(12);
    const deltaStr = `${s.deltaBps >= 0 ? "+" : ""}${s.deltaBps.toFixed(0)}bps`.padStart(8);
    process.stdout.write(`   ${stopStr}  ${wkStr}  ${lcStr}  ${swStr}  ${origStr}  ${simStr}  ${deltaStr}\n`);
  }
}

export function printTradeLedger(trades: readonly Trade[]): void {
  if (trades.length === 0) {
    process.stdout.write("\n== trade ledger == (empty)\n");
    return;
  }
  process.stdout.write(`\n== trade ledger (${trades.length} trades) ==\n`);
  process.stdout.write(
    "entry             exit              coin   side    entry        exit         bars   bps         mae         mfe         reason\n",
  );
  const sorted = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  for (const t of sorted) {
    const sideStr = t.side.padEnd(5);
    const coinStr = t.coin.padEnd(5);
    const entryStr = fmtPrice(t.entryPrice).padStart(10);
    const exitStr = fmtPrice(t.exitPrice).padStart(10);
    const barsStr = String(t.barsHeld).padStart(4);
    const bpsStr = bps(t.pnlBps).padStart(10);
    const maeStr = `${t.maeBps.toFixed(0)}bps`.padStart(10);
    const mfeStr = `${t.mfeBps.toFixed(0)}bps`.padStart(10);
    process.stdout.write(
      `${isoMin(t.entryTime)}  ${isoMin(t.exitTime)}  ${coinStr}  ${sideStr}  ${entryStr}  ${exitStr}  ${barsStr}  ${bpsStr}  ${maeStr}  ${mfeStr}  ${t.exitReason}\n`,
    );
  }
}
