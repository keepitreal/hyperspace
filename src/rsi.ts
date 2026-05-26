/**
 * Wilder-smoothed Relative Strength Index.
 *
 * Step 1: per-candle change = close[i] - close[i-1]; gain = max(change, 0); loss = max(-change, 0).
 * Step 2: seed avgGain/avgLoss with simple means over the first `period` changes.
 * Step 3: for each subsequent change, smooth: avg = (prevAvg * (period - 1) + curr) / period.
 * Step 4: RS = avgGain / avgLoss; RSI = 100 - 100 / (1 + RS). avgLoss == 0 => RSI = 100.
 *
 * Needs at least `period + 1` closes to produce a value; returns null otherwise.
 */
export function computeRsi(closes: readonly number[], period: number): number | null {
  if (period <= 0 || !Number.isFinite(period)) return null;
  if (closes.length < period + 1) return null;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) gainSum += change;
    else lossSum -= change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
