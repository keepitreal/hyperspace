import type { Candle } from "../../src/types.js";

export interface PivotResult {
  p: number;
  r1: number;
  r2: number;
  r3: number;
  s1: number;
  s2: number;
  s3: number;
}

/**
 * Classic daily pivot points. Caller passes the PRIOR day's daily candle
 * (or whichever bar serves as the reference period); the function returns
 * pivot + 3 R/S levels derived from that candle's H/L/C.
 *
 *   P  = (H + L + C) / 3
 *   R1 = 2P - L
 *   S1 = 2P - H
 *   R2 = P + (H - L)
 *   S2 = P - (H - L)
 *   R3 = H + 2(P - L)
 *   S3 = L - 2(H - P)
 */
export function pivots(referenceDay: Candle): PivotResult {
  const { high: h, low: l, close: c } = referenceDay;
  const p = (h + l + c) / 3;
  const range = h - l;
  return {
    p,
    r1: 2 * p - l,
    s1: 2 * p - h,
    r2: p + range,
    s2: p - range,
    r3: h + 2 * (p - l),
    s3: l - 2 * (h - p),
  };
}
