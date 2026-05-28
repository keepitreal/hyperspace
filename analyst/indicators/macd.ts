import { emaSeries } from "./ema.js";

export interface MacdResult {
  line: number;
  signal: number;
  histogram: number;
}

/**
 * MACD = EMA(closes, fast) - EMA(closes, slow); signal = EMA(macdLine, signalPeriod);
 * histogram = macdLine - signal. Returns null until both fast/slow EMAs and
 * the signal EMA have enough warmup.
 */
export function macd(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult | null {
  if (fast <= 0 || slow <= 0 || signalPeriod <= 0) return null;
  if (closes.length < slow + signalPeriod - 1) return null;
  const fastE = emaSeries(closes, fast);
  const slowE = emaSeries(closes, slow);
  const line: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = fastE[i];
    const s = slowE[i];
    if (f === null || s === null || f === undefined || s === undefined) continue;
    line.push(f - s);
  }
  if (line.length < signalPeriod) return null;
  const signalSeries = emaSeries(line, signalPeriod);
  const signal = signalSeries[signalSeries.length - 1];
  if (signal === null || signal === undefined) return null;
  const last = line[line.length - 1]!;
  return { line: last, signal, histogram: last - signal };
}
