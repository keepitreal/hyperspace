import { computeRsi } from "./rsi.js";
import type { Alert, Candle, Interval } from "./types.js";

export interface RsiTrackerConfig {
  period: number;
  overbought: number;
  oversold: number;
}

export interface RsiUpdateInput {
  closedCandles: readonly Candle[];
  /** The live, not-yet-closed candle, if any. Evaluated so alerts fire intra-candle. */
  inProgress?: Candle | null;
  coin: string;
  interval: Interval;
}

export interface RsiTrackerState {
  lastProcessedOpenTs: number;
}

type RsiKind = "RSI_OVERBOUGHT" | "RSI_OVERSOLD";

/**
 * Fires RSI_OVERBOUGHT / RSI_OVERSOLD as soon as RSI breaches a threshold —
 * including on the live, in-progress candle — rather than waiting for the candle
 * to close. On a 1h chart this means a spike at 1:01 alerts immediately instead
 * of at 2:00.
 *
 * Edge-triggered: dedups by (candle openTime, kind) so a single candle that stays
 * extreme across many polls alerts once, not on every poll. A new candle that is
 * still extreme re-alerts, preserving the prior once-per-bar cadence. Closed
 * candles are still swept (using `lastProcessedOpenTs`) so a bar that went extreme
 * while we weren't polling — e.g. across a restart — is not missed.
 */
export class RsiTracker {
  private readonly alerts: Alert[] = [];
  private lastProcessedOpenTs = 0;
  private lastAlertOpenTs = 0;
  private lastAlertKind: RsiKind | null = null;
  private readonly config: RsiTrackerConfig;

  constructor(config: RsiTrackerConfig) {
    this.config = config;
  }

  update(input: RsiUpdateInput): void {
    const { closedCandles, inProgress, coin, interval } = input;
    if (closedCandles.length === 0) return;

    const closes = closedCandles.map((c) => c.close);

    if (this.lastProcessedOpenTs === 0) {
      // First call: don't replay history as alerts, just seed the cursor.
      this.lastProcessedOpenTs = closedCandles[closedCandles.length - 1]!.openTime;
    } else {
      let startIdx = -1;
      for (let i = 0; i < closedCandles.length; i++) {
        const c = closedCandles[i];
        if (c !== undefined && c.openTime > this.lastProcessedOpenTs) {
          startIdx = i;
          break;
        }
      }
      if (startIdx >= 0) {
        for (let i = startIdx; i < closedCandles.length; i++) {
          const candle = closedCandles[i]!;
          const rsi = computeRsi(closes.slice(0, i + 1), this.config.period);
          this.evaluate(rsi, candle.openTime, candle.closeTime, candle.close, coin, interval);
          this.lastProcessedOpenTs = candle.openTime;
        }
      }
    }

    // Evaluate the live candle so we fire the instant RSI crosses a threshold,
    // not only when the candle finally closes.
    if (inProgress !== undefined && inProgress !== null) {
      const liveCloses = [...closes, inProgress.close];
      const rsi = computeRsi(liveCloses, this.config.period);
      this.evaluate(rsi, inProgress.openTime, Date.now(), inProgress.close, coin, interval);
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
    this.lastAlertOpenTs = 0;
    this.lastAlertKind = null;
    let cursor = state.lastProcessedOpenTs;
    let clamped = false;
    if (opts.clampOpenTsTo !== undefined && cursor < opts.clampOpenTsTo) {
      cursor = opts.clampOpenTsTo;
      clamped = true;
    }
    this.lastProcessedOpenTs = cursor;
    return { clamped };
  }

  private evaluate(
    rsi: number | null,
    openTime: number,
    ts: number,
    price: number,
    coin: string,
    interval: Interval,
  ): void {
    if (rsi === null) return;
    let kind: RsiKind | null = null;
    if (rsi >= this.config.overbought) kind = "RSI_OVERBOUGHT";
    else if (rsi <= this.config.oversold) kind = "RSI_OVERSOLD";
    if (kind === null) return;
    // Edge-trigger: skip if we already alerted this candle with the same kind.
    if (openTime === this.lastAlertOpenTs && kind === this.lastAlertKind) return;
    this.lastAlertOpenTs = openTime;
    this.lastAlertKind = kind;
    this.emit(kind, ts, rsi, price, coin, interval);
  }

  private emit(
    kind: RsiKind,
    ts: number,
    rsi: number,
    price: number,
    coin: string,
    interval: Interval,
  ): void {
    this.alerts.push({
      kind,
      ts,
      coin,
      interval,
      side: kind === "RSI_OVERBOUGHT" ? "resistance" : "support",
      levelPrice: 0,
      price,
      bpsFromLevel: 0,
      barsSinceBreakout: 0,
      rsiValue: rsi,
    });
  }
}
