import { computeRsi } from "./rsi.js";
import type { Alert, Candle, Interval } from "./types.js";

export interface RsiTrackerConfig {
  period: number;
  overbought: number;
  oversold: number;
}

export interface RsiUpdateInput {
  closedCandles: readonly Candle[];
  coin: string;
  interval: Interval;
}

export interface RsiTrackerState {
  lastProcessedOpenTs: number;
}

export class RsiTracker {
  private readonly alerts: Alert[] = [];
  private lastProcessedOpenTs = 0;
  private readonly config: RsiTrackerConfig;

  constructor(config: RsiTrackerConfig) {
    this.config = config;
  }

  update(input: RsiUpdateInput): void {
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

    for (let i = startIdx; i < closedCandles.length; i++) {
      const candle = closedCandles[i]!;
      const closes: number[] = [];
      for (let j = 0; j <= i; j++) closes.push(closedCandles[j]!.close);
      const rsi = computeRsi(closes, this.config.period);
      if (rsi !== null) {
        if (rsi >= this.config.overbought) {
          this.emit("RSI_OVERBOUGHT", candle, rsi, coin, interval);
        } else if (rsi <= this.config.oversold) {
          this.emit("RSI_OVERSOLD", candle, rsi, coin, interval);
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

  dump(): RsiTrackerState {
    return { lastProcessedOpenTs: this.lastProcessedOpenTs };
  }

  hydrate(
    state: RsiTrackerState,
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
    kind: "RSI_OVERBOUGHT" | "RSI_OVERSOLD",
    candle: Candle,
    rsi: number,
    coin: string,
    interval: Interval,
  ): void {
    this.alerts.push({
      kind,
      ts: candle.closeTime,
      coin,
      interval,
      side: kind === "RSI_OVERBOUGHT" ? "resistance" : "support",
      levelPrice: 0,
      price: candle.close,
      bpsFromLevel: 0,
      barsSinceBreakout: 0,
      rsiValue: rsi,
    });
  }
}
