import { sma } from "./sma.js";

export interface BollingerResult {
  upper: number;
  mid: number;
  lower: number;
  /** Position of latest close within bands. 0 = at lower band, 1 = at upper. */
  percentB: number;
  /** (upper - lower) / mid. Volatility regime proxy. */
  bandwidth: number;
}

/**
 * Bollinger Bands. mid = SMA(closes, period); upper/lower = mid ± k * stddev,
 * where stddev is the population (N) std-dev of the last `period` closes.
 * %b = (close - lower) / (upper - lower); bandwidth = (upper - lower) / mid.
 */
export function bollinger(
  closes: readonly number[],
  period = 20,
  k = 2,
): BollingerResult | null {
  if (period <= 0 || closes.length < period) return null;
  const mid = sma(closes, period);
  if (mid === null) return null;
  const window = closes.slice(-period);
  let varSum = 0;
  for (const v of window) {
    const d = v - mid;
    varSum += d * d;
  }
  const stddev = Math.sqrt(varSum / period);
  const upper = mid + k * stddev;
  const lower = mid - k * stddev;
  const last = closes[closes.length - 1]!;
  const range = upper - lower;
  const percentB = range > 0 ? (last - lower) / range : 0.5;
  const bandwidth = mid > 0 ? range / mid : 0;
  return { upper, mid, lower, percentB, bandwidth };
}
