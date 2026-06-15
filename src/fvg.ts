import type { Candle } from "./types.js";

/**
 * Wilder-smoothed Average True Range, aligned 1:1 with `candles`.
 *   TR[i]  = max(high-low, |high-prevClose|, |low-prevClose|)   (TR[0] = high-low)
 *   ATR[i] = SMA of the first `period` TRs at i = period-1, then
 *            ATR[i] = (ATR[i-1]*(period-1) + TR[i]) / period
 * Elements before index `period` are null (warmup). Self-contained so the live
 * monitor in src/ has no dependency on the analyst/ tree.
 */
export function atrSeries(candles: readonly Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (period <= 0 || candles.length === 0) return out;

  const tr: number[] = new Array(candles.length);
  tr[0] = candles[0]!.high - candles[0]!.low;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    tr[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  }

  if (candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

export type FvgType = "bullish" | "bearish";

export interface FvgCandidate {
  type: FvgType;
  /** upper boundary of the gap zone */
  top: number;
  /** lower boundary of the gap zone */
  bottom: number;
  /** top - bottom (always positive) */
  gapSize: number;
}

/**
 * Detect the 3-candle Fair Value Gap completing at index `i` (uses candles
 * i-2, i-1, i). Returns the gap zone, or null if no qualifying gap.
 *   Bullish: high[i-2] < low[i]   → gap [high[i-2], low[i]]   (demand / support)
 *   Bearish: low[i-2]  > high[i]  → gap [high[i],   low[i-2]] (supply / resistance)
 * The middle candle (i-1) is the displacement; the gap is the non-overlap of the
 * first and third candle wicks.
 */
export function detectFvgAt(candles: readonly Candle[], i: number): FvgCandidate | null {
  if (i < 2 || i >= candles.length) return null;
  const first = candles[i - 2]!;
  const third = candles[i]!;

  if (first.high < third.low) {
    return { type: "bullish", top: third.low, bottom: first.high, gapSize: third.low - first.high };
  }
  if (first.low > third.high) {
    return { type: "bearish", top: first.low, bottom: third.high, gapSize: first.low - third.high };
  }
  return null;
}
