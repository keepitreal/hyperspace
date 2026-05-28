import type { Candle } from "../../src/types.js";

export interface IchimokuResult {
  /** Tenkan-sen (Conversion Line), 9-period midpoint. */
  tenkan: number;
  /** Kijun-sen (Base Line), 26-period midpoint. */
  kijun: number;
  /** Senkou Span A at the current bar (projected from 26 bars ago). */
  senkouA: number;
  /** Senkou Span B at the current bar (projected from 26 bars ago). */
  senkouB: number;
  /** Senkou Span A projected to +26 bars in the future from now. */
  senkouAFuture: number;
  /** Senkou Span B projected to +26 bars in the future from now. */
  senkouBFuture: number;
  /** Chikou check: current close > close[t-26]. */
  chikouAbovePast: boolean;
  /** Latest close above the *current* cloud. */
  priceAboveCloud: boolean;
  /** Latest close below the *current* cloud. */
  priceBelowCloud: boolean;
  /** Future cloud bullish (senkouA_future > senkouB_future). */
  cloudBullish: boolean;
}

function midpoint(candles: readonly Candle[], fromIdx: number, toIdxInclusive: number): number {
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = fromIdx; i <= toIdxInclusive; i++) {
    const c = candles[i]!;
    if (c.high > hi) hi = c.high;
    if (c.low < lo) lo = c.low;
  }
  return (hi + lo) / 2;
}

/**
 * Ichimoku Kinko Hyo. Defaults (9, 26, 52, 26) are canonical.
 *
 * Needs senkouBPeriod + displacement candles to populate the current
 * cloud (Senkou values at the current bar come from data 26 bars ago,
 * which in turn each need 52 bars of look-back, so 52 + 26 = 78).
 */
export function ichimoku(
  candles: readonly Candle[],
  tenkanPeriod = 9,
  kijunPeriod = 26,
  senkouBPeriod = 52,
  displacement = 26,
): IchimokuResult | null {
  if (candles.length < senkouBPeriod + displacement) return null;
  const last = candles.length - 1;

  const tenkan = midpoint(candles, last - tenkanPeriod + 1, last);
  const kijun = midpoint(candles, last - kijunPeriod + 1, last);
  const senkouAFuture = (tenkan + kijun) / 2;
  const senkouBFuture = midpoint(candles, last - senkouBPeriod + 1, last);

  const pastIdx = last - displacement;
  if (pastIdx < senkouBPeriod - 1) return null;
  const tenkanPast = midpoint(candles, pastIdx - tenkanPeriod + 1, pastIdx);
  const kijunPast = midpoint(candles, pastIdx - kijunPeriod + 1, pastIdx);
  const senkouA = (tenkanPast + kijunPast) / 2;
  const senkouB = midpoint(candles, pastIdx - senkouBPeriod + 1, pastIdx);

  const currentClose = candles[last]!.close;
  const closeShifted = candles[last - displacement]!.close;
  const cloudHigh = Math.max(senkouA, senkouB);
  const cloudLow = Math.min(senkouA, senkouB);

  return {
    tenkan,
    kijun,
    senkouA,
    senkouB,
    senkouAFuture,
    senkouBFuture,
    chikouAbovePast: currentClose > closeShifted,
    priceAboveCloud: currentClose > cloudHigh,
    priceBelowCloud: currentClose < cloudLow,
    cloudBullish: senkouAFuture > senkouBFuture,
  };
}
