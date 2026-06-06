import type { Candle, Interval } from "../src/types.js";
import { etParts, isRth, isoWeekKey, RTH_OPEN_MIN } from "./session.js";

/** Intervals the RTH resampler can produce from a finer base series. */
export type ResampleTarget = "1h" | "4h" | "1d" | "1w";

export const RESAMPLE_TARGETS: readonly ResampleTarget[] = ["1h", "4h", "1d", "1w"];

export function isResampleTarget(s: Interval): s is ResampleTarget {
  return (RESAMPLE_TARGETS as readonly string[]).includes(s);
}

/** Minutes per intraday target (1d/1w bucket by date/week, not by minute). */
const TARGET_MIN: Record<"1h" | "4h", number> = { "1h": 60, "4h": 240 };

/** OHLCV-merge a non-empty, ascending run of bars into one candle. */
function aggregate(bars: readonly Candle[]): Candle {
  const first = bars[0];
  const last = bars[bars.length - 1];
  // Caller guarantees bars.length > 0.
  if (first === undefined || last === undefined) {
    throw new Error("aggregate: empty bucket");
  }
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let volume = 0;
  let trades = 0;
  for (const b of bars) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
    volume += b.volume;
    trades += b.trades;
  }
  return {
    openTime: first.openTime,
    closeTime: last.closeTime,
    open: first.open,
    high,
    low,
    close: last.close,
    volume,
    trades,
  };
}

/**
 * Resample a fine base series (e.g. 5-minute SPY bars, possibly including
 * extended hours) into a coarser RTH-only series.
 *
 *  - Bars outside the regular session [09:30, 16:00) ET are dropped, so
 *    overnight/pre/post-market noise never enters the aggregate.
 *  - 1h / 4h buckets are anchored to the 09:30 open, so the first bar of each
 *    session starts exactly at the open and the final bar is clipped to 16:00
 *    (e.g. the 6.5h session yields seven 1h bars and two 4h bars).
 *  - 1d is one bar per ET session date; 1w is one bar per ISO week.
 *
 * Each bucket's openTime/closeTime come from its first/last constituent bar, so
 * timestamps stay on the base grid and chart cleanly. Input need not be sorted.
 */
export function resampleRth(base: readonly Candle[], target: ResampleTarget): Candle[] {
  const sorted = [...base].sort((a, b) => a.openTime - b.openTime);

  const buckets = new Map<string, Candle[]>();
  const order: string[] = [];

  for (const c of sorted) {
    const { date, minOfDay } = etParts(c.openTime);
    if (!isRth(minOfDay)) continue;

    let key: string;
    if (target === "1d") {
      key = date;
    } else if (target === "1w") {
      key = isoWeekKey(date);
    } else {
      const idx = Math.floor((minOfDay - RTH_OPEN_MIN) / TARGET_MIN[target]);
      key = `${date}#${idx}`;
    }

    let arr = buckets.get(key);
    if (arr === undefined) {
      arr = [];
      buckets.set(key, arr);
      order.push(key);
    }
    arr.push(c);
  }

  // `order` is first-seen order; since input is ascending, it is chronological.
  return order.map((k) => aggregate(buckets.get(k) as Candle[]));
}
