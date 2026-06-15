import { intervalToMs } from "./cli.js";
import { atrSeries, detectFvgAt, type FvgType } from "./fvg.js";
import type { Alert, Candle, Interval } from "./types.js";

export interface FvgTrackerConfig {
  atrPeriod: number;
  /** Min gap size to track, as a multiple of ATR at formation. */
  atrMultiple: number;
  /** Fire when price is within this fraction of breaching a gap's near edge. */
  proximityPct: number;
  /** Drop unfilled gaps older than this many bars. */
  lookbackBars: number;
  /** Cap on simultaneously tracked gaps. */
  maxActive: number;
}

/** A live, unfilled Fair Value Gap. Persisted across restarts. */
export interface FvgGapRecord {
  type: FvgType;
  top: number;
  bottom: number;
  /** open time of the third (completing) candle */
  formationOpenTs: number;
  /** true once a proximity alert has fired for the current approach (edge-trigger) */
  alerted: boolean;
}

export interface FvgUpdateInput {
  closedCandles: readonly Candle[];
  inProgress: Candle | null;
  coin: string;
  interval: Interval;
}

export interface FvgTrackerState {
  lastProcessedOpenTs: number;
  gaps: FvgGapRecord[];
}

/**
 * Tracks live Fair Value Gaps and fires FVG_PROXIMITY when price comes within
 * `proximityPct` of breaching an unfilled gap's near edge. Stateful (keeps a list
 * of open gaps, like SetupTracker keeps setups). Edge-triggered with hysteresis so
 * it fires once per approach, not every poll.
 */
export class FvgTracker {
  private readonly alerts: Alert[] = [];
  private gaps: FvgGapRecord[] = [];
  private lastProcessedOpenTs = 0;
  private stateVersion = 0;
  private readonly config: FvgTrackerConfig;

  constructor(config: FvgTrackerConfig) {
    this.config = config;
  }

  update(input: FvgUpdateInput): void {
    const { closedCandles, inProgress, coin, interval } = input;
    if (closedCandles.length === 0) return;

    const seeding = this.lastProcessedOpenTs === 0;
    const atr = atrSeries(closedCandles, this.config.atrPeriod);
    const intervalMs = intervalToMs(interval);

    // On a fresh start, replay the whole history to build the open-gap set (no
    // alerts). On later calls, only process candles newer than the cursor.
    let startIdx: number;
    if (seeding) {
      startIdx = 2;
    } else {
      startIdx = closedCandles.length;
      for (let i = 0; i < closedCandles.length; i++) {
        if (closedCandles[i]!.openTime > this.lastProcessedOpenTs) {
          startIdx = i;
          break;
        }
      }
    }

    for (let i = Math.max(2, startIdx); i < closedCandles.length; i++) {
      const candle = closedCandles[i]!;
      this.mitigateByCandle(candle);
      const cand = detectFvgAt(closedCandles, i);
      const a = atr[i];
      if (cand !== null && a != null && a > 0 && cand.gapSize >= this.config.atrMultiple * a) {
        this.gaps.push({
          type: cand.type,
          top: cand.top,
          bottom: cand.bottom,
          formationOpenTs: candle.openTime,
          alerted: false,
        });
        this.stateVersion += 1;
      }
    }
    if (startIdx < closedCandles.length) {
      this.lastProcessedOpenTs = closedCandles[closedCandles.length - 1]!.openTime;
    }

    this.pruneStaleAndCap(closedCandles[closedCandles.length - 1]!.openTime, intervalMs);

    if (seeding) return; // first build seeds silently

    const last = closedCandles[closedCandles.length - 1]!;
    const price = inProgress !== null ? inProgress.close : last.close;
    const evalTs = inProgress !== null ? inProgress.closeTime : last.closeTime;
    this.proximityPass(price, evalTs, coin, interval);
  }

  drainAlerts(): Alert[] {
    const out = this.alerts.slice();
    this.alerts.length = 0;
    return out;
  }

  getLastProcessedOpenTs(): number {
    return this.lastProcessedOpenTs;
  }

  /** Monotonic counter bumped on any gap add/remove/alerted change — drives persistence. */
  getStateVersion(): number {
    return this.stateVersion;
  }

  dump(): FvgTrackerState {
    return { lastProcessedOpenTs: this.lastProcessedOpenTs, gaps: this.gaps.map((g) => ({ ...g })) };
  }

  hydrate(
    state: FvgTrackerState,
    opts: { clampOpenTsTo?: number } = {},
  ): { clamped: boolean } {
    this.alerts.length = 0;
    this.gaps = state.gaps.map((g) => ({ ...g }));
    let cursor = state.lastProcessedOpenTs;
    let clamped = false;
    if (opts.clampOpenTsTo !== undefined && cursor < opts.clampOpenTsTo) {
      cursor = opts.clampOpenTsTo;
      clamped = true;
    }
    this.lastProcessedOpenTs = cursor;
    this.stateVersion += 1;
    return { clamped };
  }

  /** Remove gaps whose interior was entered by this newly closed candle. */
  private mitigateByCandle(candle: Candle): void {
    const before = this.gaps.length;
    this.gaps = this.gaps.filter((g) => !(candle.low < g.top && candle.high > g.bottom));
    if (this.gaps.length !== before) this.stateVersion += 1;
  }

  private pruneStaleAndCap(refOpenTs: number, intervalMs: number): void {
    const before = this.gaps.length;
    const minTs = refOpenTs - this.config.lookbackBars * intervalMs;
    this.gaps = this.gaps.filter((g) => g.formationOpenTs >= minTs);
    if (this.gaps.length > this.config.maxActive) {
      // keep the most recent `maxActive` by formation time
      this.gaps.sort((a, b) => a.formationOpenTs - b.formationOpenTs);
      this.gaps = this.gaps.slice(this.gaps.length - this.config.maxActive);
    }
    if (this.gaps.length !== before) this.stateVersion += 1;
  }

  private proximityPass(
    price: number,
    evalTs: number,
    coin: string,
    interval: Interval,
  ): void {
    const survivors: FvgGapRecord[] = [];
    for (const gap of this.gaps) {
      if (price >= gap.bottom && price <= gap.top) {
        // breached — gap mitigated, drop it
        this.stateVersion += 1;
        continue;
      }
      const dist = price > gap.top ? (price - gap.top) / price : (gap.bottom - price) / price;
      if (gap.alerted) {
        if (dist >= 2 * this.config.proximityPct) {
          gap.alerted = false;
          this.stateVersion += 1;
        }
      } else if (dist <= this.config.proximityPct) {
        this.emit(gap, dist, price, evalTs, coin, interval);
        gap.alerted = true;
        this.stateVersion += 1;
      }
      survivors.push(gap);
    }
    this.gaps = survivors;
  }

  private emit(
    gap: FvgGapRecord,
    dist: number,
    price: number,
    evalTs: number,
    coin: string,
    interval: Interval,
  ): void {
    this.alerts.push({
      kind: "FVG_PROXIMITY",
      ts: evalTs,
      coin,
      interval,
      side: gap.type === "bullish" ? "support" : "resistance",
      levelPrice: 0,
      price,
      bpsFromLevel: 0,
      barsSinceBreakout: 0,
      fvgType: gap.type,
      fvgTop: gap.top,
      fvgBottom: gap.bottom,
      fvgDistancePct: dist,
    });
  }
}
