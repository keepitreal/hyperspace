import { levelKey, type DetectedLevels } from "./levels.js";
import type {
  Alert,
  AlertKind,
  Candle,
  Config,
  Interval,
  Level,
  Setup,
  SetupState,
} from "./types.js";

const BPS = 10_000;

function bpsFromLevel(level: Level, price: number): number {
  return ((price - level.price) / level.price) * BPS;
}

/** True if `close` cleared the level on the breakout side by `breakBps`. */
function isBreakoutClose(level: Level, close: number, breakBps: number): boolean {
  const buf = breakBps / BPS;
  return level.side === "resistance"
    ? close >= level.price * (1 + buf)
    : close <= level.price * (1 - buf);
}

/** True if `close` went back through the level on the wrong side by `breakBps`. */
function isInvalidationClose(level: Level, close: number, breakBps: number): boolean {
  const buf = breakBps / BPS;
  return level.side === "resistance"
    ? close <= level.price * (1 - buf)
    : close >= level.price * (1 + buf);
}

/**
 * True if the candle's range entered the retest band around the level
 * from the breakout side. For a broken resistance that means the wick
 * came back down to within `retestBps` of the level from above.
 */
function touchedRetestZone(level: Level, candle: Candle, retestBps: number): boolean {
  const tol = retestBps / BPS;
  return level.side === "resistance"
    ? candle.low <= level.price * (1 + tol)
    : candle.high >= level.price * (1 - tol);
}

/** Price within the candle that motivated a retest detection. */
function retestProbePrice(level: Level, candle: Candle): number {
  return level.side === "resistance" ? candle.low : candle.high;
}

export interface UpdateInput {
  levels: DetectedLevels;
  closedCandles: readonly Candle[];
  inProgress: Candle | null;
  coin: string;
  interval: Interval;
}

export class SetupTracker {
  private readonly setups = new Map<string, Setup>();
  private readonly alerts: Alert[] = [];
  /** open-time of the most recently processed closed candle */
  private lastProcessedOpenTs = 0;
  private readonly config: Pick<
    Config,
    "breakBps" | "retestBps" | "retestBars"
  >;

  constructor(config: Pick<Config, "breakBps" | "retestBps" | "retestBars">) {
    this.config = config;
  }

  update(input: UpdateInput): void {
    const { levels, closedCandles, inProgress, coin, interval } = input;

    this.reconcileLevels(levels, closedCandles);

    if (this.lastProcessedOpenTs === 0 && closedCandles.length > 0) {
      const last = closedCandles[closedCandles.length - 1];
      if (last !== undefined) this.lastProcessedOpenTs = last.openTime;
      return;
    }

    const newClosed: Candle[] = [];
    for (const c of closedCandles) {
      if (c.openTime > this.lastProcessedOpenTs) newClosed.push(c);
    }

    for (const candle of newClosed) {
      for (const setup of this.setups.values()) {
        this.applyClosedCandle(setup, candle, coin, interval);
      }
      this.lastProcessedOpenTs = candle.openTime;
    }

    if (inProgress !== null) {
      for (const setup of this.setups.values()) {
        this.applyInProgressCandle(setup, inProgress, coin, interval);
      }
    }

    this.cleanupTerminalSetups();
  }

  drainAlerts(): Alert[] {
    const out = this.alerts.slice();
    this.alerts.length = 0;
    return out;
  }

  /** Read-only snapshot of current setup states (for status logging). */
  snapshot(): readonly Setup[] {
    return Array.from(this.setups.values());
  }

  getLastProcessedOpenTs(): number {
    return this.lastProcessedOpenTs;
  }

  /** Serialize state for persistence. Plain JSON-safe data only. */
  dump(): { lastProcessedOpenTs: number; setups: Setup[] } {
    return {
      lastProcessedOpenTs: this.lastProcessedOpenTs,
      setups: Array.from(this.setups.values()).map(cloneSetup),
    };
  }

  /**
   * Restore state from a previous run. Drops alerts, clears in-memory setups,
   * and replaces them with the persisted data. If `clampOpenTsTo` is provided
   * and the persisted cursor is older, the cursor is fast-forwarded so we
   * don't replay a long backlog of stale candles after an outage.
   */
  hydrate(
    state: { lastProcessedOpenTs: number; setups: Setup[] },
    opts: { clampOpenTsTo?: number } = {},
  ): { clamped: boolean } {
    this.alerts.length = 0;
    this.setups.clear();
    for (const s of state.setups) {
      this.setups.set(levelKey(s.level), cloneSetup(s));
    }
    let cursor = state.lastProcessedOpenTs;
    let clamped = false;
    if (opts.clampOpenTsTo !== undefined && cursor < opts.clampOpenTsTo) {
      cursor = opts.clampOpenTsTo;
      clamped = true;
    }
    this.lastProcessedOpenTs = cursor;
    return { clamped };
  }

  private reconcileLevels(
    levels: DetectedLevels,
    closedCandles: readonly Candle[],
  ): void {
    const lastClosed =
      closedCandles.length > 0 ? closedCandles[closedCandles.length - 1] : undefined;
    const recentClose = lastClosed?.close;

    const seen = new Set<string>();
    for (const lvl of [...levels.resistance, ...levels.support]) {
      const k = levelKey(lvl);
      seen.add(k);
      const existing = this.setups.get(k);
      if (existing === undefined) {
        this.setups.set(k, this.makeIdleSetup(lvl, recentClose));
      } else {
        existing.level = {
          ...existing.level,
          price: lvl.price,
          touches: lvl.touches,
          lastTouchTs: lvl.lastTouchTs,
        };
        if (existing.state === "IDLE" && recentClose !== undefined) {
          existing.primed = !isBreakoutClose(
            existing.level,
            recentClose,
            this.config.breakBps,
          );
        }
      }
    }

    for (const [k, setup] of this.setups) {
      if (!seen.has(k) && setup.state === "IDLE") {
        this.setups.delete(k);
      }
    }
  }

  private makeIdleSetup(level: Level, recentClose: number | undefined): Setup {
    const primed =
      recentClose === undefined
        ? false
        : !isBreakoutClose(level, recentClose, this.config.breakBps);
    return {
      level,
      state: "IDLE",
      primed,
      breakoutTs: null,
      breakoutClose: null,
      barsSinceBreakout: 0,
      retestStartTs: null,
      cooldownBars: 0,
    };
  }

  private applyClosedCandle(
    setup: Setup,
    candle: Candle,
    coin: string,
    interval: Interval,
  ): void {
    const { breakBps, retestBps, retestBars } = this.config;

    if (
      setup.state === "CONFIRMED" ||
      setup.state === "INVALIDATED" ||
      setup.state === "EXPIRED"
    ) {
      setup.cooldownBars -= 1;
      if (setup.cooldownBars <= 0) this.resetToIdle(setup);
      return;
    }

    if (setup.state === "BROKEN" || setup.state === "RETESTING") {
      setup.barsSinceBreakout += 1;

      if (isInvalidationClose(setup.level, candle.close, breakBps)) {
        this.transition(setup, "INVALIDATED", candle, candle.close, coin, interval);
        return;
      }
    }

    if (setup.state === "BROKEN" && touchedRetestZone(setup.level, candle, retestBps)) {
      setup.state = "RETESTING";
      setup.retestStartTs = candle.openTime;
      const probe = retestProbePrice(setup.level, candle);
      this.emit("RETEST_START", setup, probe, candle.closeTime, coin, interval);
    }

    if (setup.state === "RETESTING") {
      if (isBreakoutClose(setup.level, candle.close, breakBps)) {
        this.transition(setup, "CONFIRMED", candle, candle.close, coin, interval);
        return;
      }
    }

    if (
      (setup.state === "BROKEN" || setup.state === "RETESTING") &&
      setup.barsSinceBreakout > retestBars
    ) {
      this.transition(setup, "EXPIRED", candle, candle.close, coin, interval);
      return;
    }

    if (setup.state === "IDLE") {
      if (isBreakoutClose(setup.level, candle.close, breakBps)) {
        if (!setup.primed) {
          return;
        }
        setup.state = "BROKEN";
        setup.primed = false;
        setup.breakoutTs = candle.openTime;
        setup.breakoutClose = candle.close;
        setup.barsSinceBreakout = 0;
        this.emit("BREAKOUT", setup, candle.close, candle.closeTime, coin, interval);

        if (touchedRetestZone(setup.level, candle, retestBps)) {
          setup.state = "RETESTING";
          setup.retestStartTs = candle.openTime;
          const probe = retestProbePrice(setup.level, candle);
          this.emit("RETEST_START", setup, probe, candle.closeTime, coin, interval);
        }
      } else {
        setup.primed = true;
      }
    }
  }

  private applyInProgressCandle(
    setup: Setup,
    candle: Candle,
    coin: string,
    interval: Interval,
  ): void {
    if (setup.state !== "BROKEN") return;
    if (touchedRetestZone(setup.level, candle, this.config.retestBps)) {
      setup.state = "RETESTING";
      setup.retestStartTs = candle.openTime;
      const probe = retestProbePrice(setup.level, candle);
      this.emit("RETEST_START", setup, probe, Date.now(), coin, interval);
    }
  }

  private transition(
    setup: Setup,
    next: SetupState,
    candle: Candle,
    price: number,
    coin: string,
    interval: Interval,
  ): void {
    setup.state = next;
    if (next === "CONFIRMED" || next === "INVALIDATED" || next === "EXPIRED") {
      this.emit(next, setup, price, candle.closeTime, coin, interval);
      setup.cooldownBars = this.config.retestBars;
    }
  }

  private resetToIdle(setup: Setup): void {
    setup.state = "IDLE";
    setup.primed = false;
    setup.breakoutTs = null;
    setup.breakoutClose = null;
    setup.barsSinceBreakout = 0;
    setup.retestStartTs = null;
    setup.cooldownBars = 0;
  }

  private emit(
    kind: AlertKind,
    setup: Setup,
    price: number,
    ts: number,
    coin: string,
    interval: Interval,
  ): void {
    this.alerts.push({
      kind,
      ts,
      coin,
      interval,
      side: setup.level.side,
      levelPrice: setup.level.price,
      price,
      bpsFromLevel: bpsFromLevel(setup.level, price),
      barsSinceBreakout: setup.barsSinceBreakout,
    });
  }

  private cleanupTerminalSetups(): void {
    for (const [k, s] of this.setups) {
      if (
        (s.state === "EXPIRED" ||
          s.state === "CONFIRMED" ||
          s.state === "INVALIDATED") &&
        s.cooldownBars <= 0
      ) {
        this.setups.delete(k);
      }
    }
  }
}

function cloneSetup(s: Setup): Setup {
  return {
    level: { ...s.level },
    state: s.state,
    primed: s.primed,
    breakoutTs: s.breakoutTs,
    breakoutClose: s.breakoutClose,
    barsSinceBreakout: s.barsSinceBreakout,
    retestStartTs: s.retestStartTs,
    cooldownBars: s.cooldownBars,
  };
}
