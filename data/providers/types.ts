import type { Candle } from "../../src/types.js";

/** Aggregate bar granularity in provider-native terms. */
export type Timespan = "minute" | "hour" | "day" | "week";

export interface FetchBarsArgs {
  /** Provider ticker, e.g. "SPY". */
  symbol: string;
  /** Bar size multiplier, e.g. 5 (with timespan "minute") = 5-minute bars. */
  multiplier: number;
  timespan: Timespan;
  /** Inclusive window start, ms since epoch. */
  from: number;
  /** Inclusive window end, ms since epoch. */
  to: number;
  signal?: AbortSignal;
  /** Progress callback, fired once per network page. */
  onPage?: (info: {
    page: number;
    received: number;
    total: number;
    earliestMs: number;
    latestMs: number;
  }) => void;
}

/**
 * A historical-bars data source. Implementations normalize their wire format
 * into the project-wide `Candle` shape (ms timestamps, numeric OHLCV) and
 * return bars ascending by openTime, deduped, trimmed to [from, to].
 */
export interface BarsProvider {
  readonly name: string;
  fetchBars(args: FetchBarsArgs): Promise<Candle[]>;
}
