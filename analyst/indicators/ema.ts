/**
 * Exponential Moving Average. Seed = SMA over first `period` values,
 * then ema[i] = close[i]*k + ema[i-1]*(1-k) where k = 2/(period+1).
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

export function ema(values: readonly number[], period: number): number | null {
  const s = emaSeries(values, period);
  return s[s.length - 1] ?? null;
}
