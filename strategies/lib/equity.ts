import type { Trade } from "./runner.js";

export interface EquityPoint {
  /** Trade exit time, ms since epoch. */
  time: number;
  /** Cumulative equity multiple (starts at startEquity, compounds each trade). */
  equity: number;
  /** Drawdown from the running peak, as a negative fraction (0 at a new high). */
  drawdown: number;
}

export interface EquityResult {
  points: EquityPoint[];
  /** Final equity multiple. */
  finalEquity: number;
  /** Total return as a fraction (finalEquity - startEquity)/startEquity. */
  totalReturn: number;
  /** Worst peak-to-trough drawdown, as a negative fraction. */
  maxDrawdown: number;
}

/**
 * Compound a unit-sized position through the closed trades in exit-time order.
 * Each trade scales equity by (1 + pnlBps/10000). Frictionless unless the trades
 * already embed fees. Returns the per-trade equity path plus drawdown stats —
 * enough to draw an equity curve and an underwater plot.
 */
export function equityCurve(
  trades: readonly Trade[],
  opts?: { startEquity?: number },
): EquityResult {
  const start = opts?.startEquity ?? 1;
  const sorted = [...trades].sort((a, b) => a.exitTime - b.exitTime);

  const points: EquityPoint[] = [];
  let eq = start;
  let peak = start;
  let maxDrawdown = 0;
  for (const t of sorted) {
    eq *= 1 + t.pnlBps / 10_000;
    if (eq > peak) peak = eq;
    const drawdown = peak > 0 ? eq / peak - 1 : 0;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
    points.push({ time: t.exitTime, equity: eq, drawdown });
  }

  return {
    points,
    finalEquity: eq,
    totalReturn: start > 0 ? (eq - start) / start : 0,
    maxDrawdown,
  };
}
