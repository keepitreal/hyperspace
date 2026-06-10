/**
 * Exponential Moving Average series. Seed = SMA over the first `period` values,
 * then ema[i] = values[i]*k + ema[i-1]*(1-k) where k = 2/(period+1). Warmup
 * elements (before index period-1) are null. Self-contained so the live monitor
 * in src/ has no dependency on the analyst/ tree.
 */
export function emaSeries(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i]!;
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface MacdPoint {
  line: number;
  signal: number;
  histogram: number;
}

/**
 * MACD series aligned 1:1 with `closes`. For each index k:
 *   line = EMA(closes, fast)[k] - EMA(closes, slow)[k]
 *   signal = EMA(line, signalPeriod) evaluated at k
 *   histogram = line - signal
 * Element k is null until both the slow EMA and the signal EMA have warmed up.
 * (TradingView defaults: fast 12, slow 26, signal 9, source = close.)
 */
export function macdSeries(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): (MacdPoint | null)[] {
  const out: (MacdPoint | null)[] = new Array(closes.length).fill(null);
  if (fast <= 0 || slow <= 0 || signalPeriod <= 0) return out;

  const fastE = emaSeries(closes, fast);
  const slowE = emaSeries(closes, slow);

  // Build the MACD line, but keep a map back to the original close index so the
  // signal EMA (computed over the compacted line) can be re-aligned to `closes`.
  const line: number[] = [];
  const lineIdxToClose: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = fastE[i];
    const s = slowE[i];
    if (f === null || f === undefined || s === null || s === undefined) continue;
    line.push(f - s);
    lineIdxToClose.push(i);
  }

  const signalE = emaSeries(line, signalPeriod);
  for (let j = 0; j < line.length; j++) {
    const sig = signalE[j];
    if (sig === null || sig === undefined) continue;
    const lineVal = line[j]!;
    const closeIdx = lineIdxToClose[j]!;
    out[closeIdx] = { line: lineVal, signal: sig, histogram: lineVal - sig };
  }
  return out;
}

/** Convenience: just the histogram (line - signal) series aligned to `closes`. */
export function macdHistogramSeries(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): (number | null)[] {
  return macdSeries(closes, fast, slow, signalPeriod).map((p) =>
    p === null ? null : p.histogram,
  );
}
