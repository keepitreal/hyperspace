import type { Candle } from "../../src/types.js";

export interface ObvResult {
  value: number;
  /** OBV value from one bar prior — useful for trend direction at a glance. */
  prev: number;
}

/**
 * On-Balance Volume. Cumulative running total: add this bar's volume when
 * close > prior close, subtract when close < prior close, no change on equal.
 * Starts at 0 on the first bar (no prior). Returns the last value plus the
 * second-to-last so callers can read direction.
 */
export function obv(candles: readonly Candle[]): ObvResult | null {
  if (candles.length < 2) return null;
  let value = 0;
  let prev = 0;
  for (let i = 1; i < candles.length; i++) {
    prev = value;
    const c = candles[i]!;
    const cPrev = candles[i - 1]!;
    if (c.close > cPrev.close) value += c.volume;
    else if (c.close < cPrev.close) value -= c.volume;
  }
  return { value, prev };
}
