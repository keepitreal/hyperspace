import type { Trade } from "./runner.js";

export interface Summary {
  count: number;
  wins: number;
  losses: number;
  /** 0..1 */
  winRate: number;
  avgPnlBps: number;
  medianPnlBps: number;
  bestBps: number;
  worstBps: number;
  /** Sum of pnlBps across trades (unit position, not compounded). */
  totalReturnBps: number;
  avgBarsHeld: number;
  exitCounts: Record<string, number>;
}

const EMPTY: Summary = {
  count: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  avgPnlBps: 0,
  medianPnlBps: 0,
  bestBps: 0,
  worstBps: 0,
  totalReturnBps: 0,
  avgBarsHeld: 0,
  exitCounts: {},
};

export function summarize(trades: readonly Trade[]): Summary {
  if (trades.length === 0) return { ...EMPTY, exitCounts: {} };

  const pnls = trades.map((t) => t.pnlBps);
  const sorted = [...pnls].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  const median =
    sorted.length % 2 === 0
      ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
      : sorted[Math.floor(mid)] ?? 0;

  let wins = 0;
  let losses = 0;
  let total = 0;
  let best = -Infinity;
  let worst = Infinity;
  let barsSum = 0;
  const exitCounts: Record<string, number> = {};
  for (const t of trades) {
    if (t.pnlBps > 0) wins += 1;
    else losses += 1;
    total += t.pnlBps;
    if (t.pnlBps > best) best = t.pnlBps;
    if (t.pnlBps < worst) worst = t.pnlBps;
    barsSum += t.barsHeld;
    exitCounts[t.exitReason] = (exitCounts[t.exitReason] ?? 0) + 1;
  }

  return {
    count: trades.length,
    wins,
    losses,
    winRate: wins / trades.length,
    avgPnlBps: total / trades.length,
    medianPnlBps: median,
    bestBps: best,
    worstBps: worst,
    totalReturnBps: total,
    avgBarsHeld: barsSum / trades.length,
    exitCounts,
  };
}

export function summarizeBySide(trades: readonly Trade[]): {
  long: Summary;
  short: Summary;
} {
  return {
    long: summarize(trades.filter((t) => t.side === "long")),
    short: summarize(trades.filter((t) => t.side === "short")),
  };
}
