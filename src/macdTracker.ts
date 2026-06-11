import { macdSeries, type MacdPoint } from "./macd.js";
import type { Alert, Candle, Interval } from "./types.js";

export interface MacdTrackerConfig {
  fast: number;
  slow: number;
  signal: number;
  /**
   * Minimum |histogram| / close required at the crossover bar to fire. Price-
   * normalized so it is comparable across markets of very different price.
   */
  separationPct: number;
  /** Suppress a crossover if another crossover happened within this many prior bars. */
  debounceBars: number;
  /**
   * When true, only fire when the MACD line sits on the trend-consistent side of
   * the zero line at the cross: bullish requires line > 0, bearish requires line < 0.
   */
  requireZeroLineSide: boolean;
}

export interface MacdUpdateInput {
  closedCandles: readonly Candle[];
  coin: string;
  interval: Interval;
}

export interface MacdTrackerState {
  lastProcessedOpenTs: number;
}

/**
 * Emits MACD_CROSSOVER when the MACD line crosses its signal line (histogram
 * changes sign) on a newly closed candle. Three gates:
 *  - direction: bullish (hist ≤0 → >0) or bearish (hist ≥0 → <0)
 *  - zero-line side: bullish requires line > 0, bearish line < 0 (when requireZeroLineSide)
 *  - magnitude: |histogram| / close ≥ separationPct (filters tiny grazes)
 *  - debounce: no other crossover in the prior `debounceBars` bars
 * Mirrors RsiTracker's cursor/dump/hydrate lifecycle.
 */
export class MacdTracker {
  private readonly alerts: Alert[] = [];
  private lastProcessedOpenTs = 0;
  private readonly config: MacdTrackerConfig;

  constructor(config: MacdTrackerConfig) {
    this.config = config;
  }

  update(input: MacdUpdateInput): void {
    const { closedCandles, coin, interval } = input;
    if (closedCandles.length === 0) return;

    if (this.lastProcessedOpenTs === 0) {
      const last = closedCandles[closedCandles.length - 1]!;
      this.lastProcessedOpenTs = last.openTime;
      return;
    }

    let startIdx = -1;
    for (let i = 0; i < closedCandles.length; i++) {
      const c = closedCandles[i];
      if (c !== undefined && c.openTime > this.lastProcessedOpenTs) {
        startIdx = i;
        break;
      }
    }
    if (startIdx < 0) return;

    const closes = closedCandles.map((c) => c.close);
    const series = macdSeries(closes, this.config.fast, this.config.slow, this.config.signal);

    for (let i = startIdx; i < closedCandles.length; i++) {
      const candle = closedCandles[i]!;
      const cur = series[i];
      const prev = i > 0 ? series[i - 1] : null;
      if (cur != null && prev != null) {
        const cross = this.classifyCross(prev, cur);
        if (
          cross !== null &&
          this.zeroSideOk(cross, cur) &&
          this.magnitudeOk(cur, candle.close) &&
          !this.crossedRecently(series, i)
        ) {
          this.emit(cross, cur, candle, coin, interval);
        }
      }
      this.lastProcessedOpenTs = candle.openTime;
    }
  }

  drainAlerts(): Alert[] {
    const out = this.alerts.slice();
    this.alerts.length = 0;
    return out;
  }

  getLastProcessedOpenTs(): number {
    return this.lastProcessedOpenTs;
  }

  dump(): MacdTrackerState {
    return { lastProcessedOpenTs: this.lastProcessedOpenTs };
  }

  hydrate(
    state: MacdTrackerState,
    opts: { clampOpenTsTo?: number } = {},
  ): { clamped: boolean } {
    this.alerts.length = 0;
    let cursor = state.lastProcessedOpenTs;
    let clamped = false;
    if (opts.clampOpenTsTo !== undefined && cursor < opts.clampOpenTsTo) {
      cursor = opts.clampOpenTsTo;
      clamped = true;
    }
    this.lastProcessedOpenTs = cursor;
    return { clamped };
  }

  private classifyCross(prev: MacdPoint, cur: MacdPoint): "bullish" | "bearish" | null {
    if (prev.histogram <= 0 && cur.histogram > 0) return "bullish";
    if (prev.histogram >= 0 && cur.histogram < 0) return "bearish";
    return null;
  }

  private zeroSideOk(cross: "bullish" | "bearish", cur: MacdPoint): boolean {
    if (!this.config.requireZeroLineSide) return true;
    return cross === "bullish" ? cur.line > 0 : cur.line < 0;
  }

  private magnitudeOk(cur: MacdPoint, close: number): boolean {
    if (close <= 0) return false;
    return Math.abs(cur.histogram) >= this.config.separationPct * close;
  }

  /**
   * True if a crossover (histogram sign flip) occurred within the prior
   * `debounceBars` bars before index `i` — i.e. among the adjacent pairs ending
   * at i-1, i-2, … i-debounceBars. Null (warmup) bars are not crossovers.
   */
  private crossedRecently(series: readonly (MacdPoint | null)[], i: number): boolean {
    const from = Math.max(1, i - this.config.debounceBars);
    for (let j = from; j < i; j++) {
      const a = series[j - 1];
      const b = series[j];
      if (a == null || b == null) continue;
      if ((a.histogram <= 0 && b.histogram > 0) || (a.histogram >= 0 && b.histogram < 0)) {
        return true;
      }
    }
    return false;
  }

  private emit(
    cross: "bullish" | "bearish",
    point: MacdPoint,
    candle: Candle,
    coin: string,
    interval: Interval,
  ): void {
    this.alerts.push({
      kind: "MACD_CROSSOVER",
      ts: candle.closeTime,
      coin,
      interval,
      side: cross === "bullish" ? "resistance" : "support",
      levelPrice: 0,
      price: candle.close,
      bpsFromLevel: 0,
      barsSinceBreakout: 0,
      macdCross: cross,
      macdLine: point.line,
      macdSignal: point.signal,
      macdHistogram: point.histogram,
    });
  }
}
