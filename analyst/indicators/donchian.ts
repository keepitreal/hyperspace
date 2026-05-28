import type { Candle } from "../../src/types.js";

export interface DonchianResult {
  upper: number;
  mid: number;
  lower: number;
  /** Position of latest close within channel. 0 = at lower, 1 = at upper. */
  position: number;
}

/**
 * Donchian Channels. upper = max(high) over last `period` bars; lower =
 * min(low); mid = (upper+lower)/2. position = where the latest close sits
 * inside the channel.
 */
export function donchian(candles: readonly Candle[], period = 20): DonchianResult | null {
  if (period <= 0 || candles.length < period) return null;
  const window = candles.slice(-period);
  let upper = -Infinity;
  let lower = Infinity;
  for (const c of window) {
    if (c.high > upper) upper = c.high;
    if (c.low < lower) lower = c.low;
  }
  const mid = (upper + lower) / 2;
  const last = candles[candles.length - 1]!;
  const range = upper - lower;
  const position = range > 0 ? (last.close - lower) / range : 0.5;
  return { upper, mid, lower, position };
}
