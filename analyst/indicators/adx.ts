import type { Candle } from "../../src/types.js";

export interface AdxResult {
  /** Average Directional Index (0–100). >25 typically denotes a real trend. */
  adx: number;
  /** +DI: positive directional indicator (0–100). */
  plusDI: number;
  /** −DI: negative directional indicator (0–100). */
  minusDI: number;
}

/**
 * Wilder Average Directional Index.
 *
 * 1. Per-bar (i≥1): TR, +DM, −DM
 *    TR = max(H−L, |H−prevC|, |L−prevC|)
 *    +DM = (upMove > downMove && upMove > 0) ? upMove : 0
 *    −DM = (downMove > upMove && downMove > 0) ? downMove : 0
 *      where upMove = H − prevH, downMove = prevL − L.
 * 2. Wilder-smooth TR / +DM / −DM (seed = sum of first `period`, then
 *    s[i] = s[i−1] − s[i−1]/period + curr[i]).
 * 3. +DI = 100·sPDM/sTR; −DI = 100·sMDM/sTR.
 * 4. DX = 100·|+DI − −DI| / (+DI + −DI).
 * 5. ADX seed = mean of first `period` DX values; subsequent ADX is
 *    Wilder-smoothed (k = 1/period).
 *
 * Needs at least 2·period + 1 candles for the first stable ADX.
 */
export function adx(candles: readonly Candle[], period = 14): AdxResult | null {
  if (period <= 0 || candles.length < 2 * period + 1) return null;

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    const trI = Math.max(
      c.high - c.low,
      Math.abs(c.high - p.close),
      Math.abs(c.low - p.close),
    );
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    const pdm = upMove > downMove && upMove > 0 ? upMove : 0;
    const mdm = downMove > upMove && downMove > 0 ? downMove : 0;
    tr.push(trI);
    plusDM.push(pdm);
    minusDM.push(mdm);
  }

  if (tr.length < period * 2) return null;

  let sTR = 0;
  let sPDM = 0;
  let sMDM = 0;
  for (let i = 0; i < period; i++) {
    sTR += tr[i]!;
    sPDM += plusDM[i]!;
    sMDM += minusDM[i]!;
  }

  const dx: number[] = [];
  const calcDX = (): number => {
    const pDI = sTR > 0 ? (100 * sPDM) / sTR : 0;
    const mDI = sTR > 0 ? (100 * sMDM) / sTR : 0;
    const sum = pDI + mDI;
    return sum > 0 ? (100 * Math.abs(pDI - mDI)) / sum : 0;
  };
  dx.push(calcDX());

  for (let i = period; i < tr.length; i++) {
    sTR = sTR - sTR / period + tr[i]!;
    sPDM = sPDM - sPDM / period + plusDM[i]!;
    sMDM = sMDM - sMDM / period + minusDM[i]!;
    dx.push(calcDX());
  }

  if (dx.length < period) return null;

  let adxVal = 0;
  for (let i = 0; i < period; i++) adxVal += dx[i]!;
  adxVal /= period;
  for (let i = period; i < dx.length; i++) {
    adxVal = (adxVal * (period - 1) + dx[i]!) / period;
  }

  const plusDI = sTR > 0 ? (100 * sPDM) / sTR : 0;
  const minusDI = sTR > 0 ? (100 * sMDM) / sTR : 0;

  return { adx: adxVal, plusDI, minusDI };
}
