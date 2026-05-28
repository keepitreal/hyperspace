import type { Candle } from "../../src/types.js";
import { smaSeries } from "./sma.js";

export interface StochasticResult {
  /** Smoothed %K, 0–100. */
  k: number;
  /** %D = SMA of smoothed %K, 0–100. */
  d: number;
}

/**
 * Slow Stochastic Oscillator (k, kSlowing, dPeriod).
 *
 * raw%K[i] = 100 * (close[i] - min(low, period)) / (max(high, period) - min(low, period))
 * smoothed %K = SMA(raw%K, kSlowing)
 * %D = SMA(smoothed%K, dPeriod)
 *
 * Defaults (14, 3, 3) are the canonical "slow stoch."
 */
export function stochastic(
  candles: readonly Candle[],
  period = 14,
  kSlowing = 3,
  dPeriod = 3,
): StochasticResult | null {
  if (period <= 0 || kSlowing <= 0 || dPeriod <= 0) return null;
  const minBars = period + kSlowing + dPeriod - 2;
  if (candles.length < minBars) return null;

  const rawK: (number | null)[] = new Array(candles.length).fill(null);
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const c = candles[j]!;
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    const close = candles[i]!.close;
    const range = hi - lo;
    rawK[i] = range > 0 ? (100 * (close - lo)) / range : 50;
  }

  const rawKVals = rawK.filter((v): v is number => v !== null);
  const smoothedK = smaSeries(rawKVals, kSlowing);
  const smoothedKVals = smoothedK.filter((v): v is number => v !== null);
  if (smoothedKVals.length < dPeriod) return null;
  const dSeries = smaSeries(smoothedKVals, dPeriod);
  const k = smoothedKVals[smoothedKVals.length - 1];
  const d = dSeries[dSeries.length - 1];
  if (k === undefined || d === null || d === undefined) return null;
  return { k, d };
}
