import type { Candle } from "../../src/types.js";

/**
 * Money Flow Index — volume-weighted RSI variant.
 *
 * For each bar i (>=1): typical[i] = (H+L+C)/3, rawMF[i] = typical[i]*volume[i].
 * If typical[i] > typical[i-1] → positiveMF; if <, negativeMF; if =, neither.
 * MFR = sum(posMF, period) / sum(negMF, period); MFI = 100 - 100/(1+MFR).
 *
 * Needs `period + 1` candles.
 */
export function mfi(candles: readonly Candle[], period = 14): number | null {
  if (period <= 0 || candles.length < period + 1) return null;
  const typical: number[] = candles.map((c) => (c.high + c.low + c.close) / 3);
  let posSum = 0;
  let negSum = 0;
  const startIdx = candles.length - period;
  for (let i = startIdx; i < candles.length; i++) {
    const t = typical[i]!;
    const tPrev = typical[i - 1]!;
    const rawMf = t * candles[i]!.volume;
    if (t > tPrev) posSum += rawMf;
    else if (t < tPrev) negSum += rawMf;
  }
  if (negSum === 0) return posSum === 0 ? 50 : 100;
  const mfr = posSum / negSum;
  return 100 - 100 / (1 + mfr);
}
