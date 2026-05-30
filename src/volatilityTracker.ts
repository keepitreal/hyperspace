import type { Alert, Candle, Interval } from "./types.js";

export interface VolatilityTrackerConfig {
  /** Body-volatility threshold expressed as percentage points (e.g. 1.0 = 1%). */
  thresholdPct: number;
}

export interface VolatilityUpdateInput {
  closedCandles: readonly Candle[];
  coin: string;
  interval: Interval;
}

export interface VolatilityTrackerState {
  lastProcessedOpenTs: number;
}

/**
 * Emits a `VOLATILITY_SPIKE` alert whenever a closed candle's body change
 * `(close − open) / open` (signed) has |magnitude| ≥ thresholdPct percent.
 * Body-only — wicks are deliberately ignored.
 *
 * Lifecycle mirrors `RsiTracker`: cursor-based dedup so each candle alerts at
 * most once, first-hydrate skip to avoid replay floods on cold start.
 */
export class VolatilityTracker {
  private readonly alerts: Alert[] = [];
  private lastProcessedOpenTs = 0;
  private readonly config: VolatilityTrackerConfig;

  constructor(config: VolatilityTrackerConfig) {
    this.config = config;
  }

  update(input: VolatilityUpdateInput): void {
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

    const thresholdFrac = this.config.thresholdPct / 100;
    for (let i = startIdx; i < closedCandles.length; i++) {
      const candle = closedCandles[i]!;
      if (candle.open > 0) {
        const pct = (candle.close - candle.open) / candle.open;
        if (Math.abs(pct) >= thresholdFrac) {
          this.emit(candle, pct, coin, interval);
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

  dump(): VolatilityTrackerState {
    return { lastProcessedOpenTs: this.lastProcessedOpenTs };
  }

  hydrate(
    state: VolatilityTrackerState,
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

  private emit(
    candle: Candle,
    pct: number,
    coin: string,
    interval: Interval,
  ): void {
    this.alerts.push({
      kind: "VOLATILITY_SPIKE",
      ts: candle.closeTime,
      coin,
      interval,
      side: pct >= 0 ? "resistance" : "support",
      levelPrice: 0,
      price: candle.close,
      bpsFromLevel: 0,
      barsSinceBreakout: 0,
      volatilityPct: pct,
      candleOpen: candle.open,
    });
  }
}
