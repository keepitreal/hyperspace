import type { Candle } from "./types.js";

const MS_PER_DAY = 86_400_000;

function utcDayKey(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

/**
 * Session VWAP with a 00:00 UTC daily reset.
 *
 * Walks `[...history, candle]` to find the first bar whose UTC day matches
 * `candle`'s — that's the start of the current session — then accumulates
 * Σ(typical × volume) / Σ(volume) from there through `candle`. Typical price
 * is (high + low + close) / 3, the standard VWAP convention.
 *
 * Returns null only if total volume across the session window is zero.
 */
export function sessionVwap(
  candle: Candle,
  history: readonly Candle[],
): number | null {
  const lastDay = utcDayKey(candle.openTime);
  let pvSum = 0;
  let volSum = 0;
  for (let i = 0; i < history.length; i++) {
    const b = history[i]!;
    if (utcDayKey(b.openTime) !== lastDay) {
      pvSum = 0;
      volSum = 0;
      continue;
    }
    const typical = (b.high + b.low + b.close) / 3;
    pvSum += typical * b.volume;
    volSum += b.volume;
  }
  const typical = (candle.high + candle.low + candle.close) / 3;
  pvSum += typical * candle.volume;
  volSum += candle.volume;
  if (volSum <= 0) return null;
  return pvSum / volSum;
}
