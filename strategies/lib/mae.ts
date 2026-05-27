import type { Trade } from "./runner.js";

const BUCKET_EDGES = [0, 25, 50, 100, 200, 500, Number.POSITIVE_INFINITY] as const;
const STOP_CANDIDATES_BPS = [50, 75, 100, 150, 200, 300] as const;

export interface MaeBucket {
  lower: number;
  upper: number;
  count: number;
}

export interface MaeStats {
  count: number;
  buckets: MaeBucket[];
  p50: number;
  p75: number;
  p90: number;
  p95: number;
}

export interface StopScenario {
  stopBps: number;
  winnersKilled: number;
  losersStopped: number;
  smallLossesWorsened: number;
  originalTotalBps: number;
  simulatedTotalBps: number;
  deltaBps: number;
}

export interface MaeAnalysis {
  total: number;
  winners: MaeStats;
  losers: MaeStats;
  stopScenarios: StopScenario[];
}

function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0] ?? 0;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loV = sortedAsc[lo] ?? 0;
  const hiV = sortedAsc[hi] ?? 0;
  if (lo === hi) return loV;
  return loV + (hiV - loV) * (rank - lo);
}

function bucketize(values: readonly number[]): MaeBucket[] {
  const out: MaeBucket[] = [];
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    const lower = BUCKET_EDGES[i] ?? 0;
    const upper = BUCKET_EDGES[i + 1] ?? Number.POSITIVE_INFINITY;
    let count = 0;
    for (const v of values) {
      if (v >= lower && v < upper) count += 1;
    }
    out.push({ lower, upper, count });
  }
  return out;
}

function statsFor(trades: readonly Trade[]): MaeStats {
  const maes = trades.map((t) => t.maeBps);
  const sorted = [...maes].sort((a, b) => a - b);
  return {
    count: trades.length,
    buckets: bucketize(maes),
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
  };
}

/**
 * Simulate a fixed-bps stop: for any trade whose MAE breached the stop,
 * assume the position would have closed at -stopBps. Trades that never
 * touched the stop keep their original pnl.
 *
 * Caveats:
 *  - Wick-fill assumption (no slippage past the stop).
 *  - Cannot account for trades that would have continued to *better*
 *    outcomes had a different entry been taken after a stop-out — pure
 *    per-trade replacement.
 */
function simulateStop(trades: readonly Trade[], stopBps: number): StopScenario {
  let winnersKilled = 0;
  let losersStopped = 0;
  let smallLossesWorsened = 0;
  let originalTotal = 0;
  let simulatedTotal = 0;
  for (const t of trades) {
    originalTotal += t.pnlBps;
    if (t.maeBps > stopBps) {
      simulatedTotal += -stopBps;
      if (t.pnlBps > 0) winnersKilled += 1;
      else if (t.pnlBps < -stopBps) losersStopped += 1;
      else smallLossesWorsened += 1;
    } else {
      simulatedTotal += t.pnlBps;
    }
  }
  return {
    stopBps,
    winnersKilled,
    losersStopped,
    smallLossesWorsened,
    originalTotalBps: originalTotal,
    simulatedTotalBps: simulatedTotal,
    deltaBps: simulatedTotal - originalTotal,
  };
}

export function analyzeMae(trades: readonly Trade[]): MaeAnalysis {
  const winners = trades.filter((t) => t.pnlBps > 0);
  const losers = trades.filter((t) => t.pnlBps <= 0);
  const stopScenarios = STOP_CANDIDATES_BPS.map((s) => simulateStop(trades, s));
  return {
    total: trades.length,
    winners: statsFor(winners),
    losers: statsFor(losers),
    stopScenarios,
  };
}
