export const INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
] as const;

export type Interval = (typeof INTERVALS)[number];

export interface Candle {
  /** open time, ms since epoch */
  openTime: number;
  /** close time, ms since epoch */
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export type LevelSide = "support" | "resistance";

export interface Level {
  side: LevelSide;
  /** representative price (volume-weighted mean of the cluster) */
  price: number;
  /** number of pivots merged into this level */
  touches: number;
  /** ms timestamp of the most recent pivot in the cluster */
  lastTouchTs: number;
}

export type SetupState =
  | "IDLE"
  | "BROKEN"
  | "RETESTING"
  | "CONFIRMED"
  | "INVALIDATED"
  | "EXPIRED";

export interface Setup {
  level: Level;
  state: SetupState;
  /**
   * True once we have observed a close on the un-broken side of the level,
   * so a subsequent close on the breakout side is a real breakout (not just
   * the state machine "discovering" a level that was already broken before
   * monitoring began).
   */
  primed: boolean;
  /** open time of the candle that triggered the breakout */
  breakoutTs: number | null;
  /** close price of the breakout candle */
  breakoutClose: number | null;
  /** number of fully-closed candles since the breakout was registered */
  barsSinceBreakout: number;
  /** open time of the candle that started the retest, if any */
  retestStartTs: number | null;
  /** terminal-state cooldown counter, decremented per closed candle */
  cooldownBars: number;
}

export type AlertKind =
  | "BREAKOUT"
  | "RETEST_START"
  | "CONFIRMED"
  | "INVALIDATED"
  | "EXPIRED"
  | "RSI_OVERBOUGHT"
  | "RSI_OVERSOLD"
  | "VOLATILITY_SPIKE"
  | "MACD_CROSSOVER";

/** Runtime list — keep in sync with AlertKind union. Used for config validation. */
export const ALL_ALERT_KINDS: readonly AlertKind[] = [
  "BREAKOUT",
  "RETEST_START",
  "CONFIRMED",
  "INVALIDATED",
  "EXPIRED",
  "RSI_OVERBOUGHT",
  "RSI_OVERSOLD",
  "VOLATILITY_SPIKE",
  "MACD_CROSSOVER",
];

export interface Alert {
  kind: AlertKind;
  ts: number;
  coin: string;
  interval: Interval;
  side: LevelSide;
  levelPrice: number;
  /** the price that motivated the alert (close, or current px for retest start) */
  price: number;
  /** signed bps move from the level for this price; +ve when above the level */
  bpsFromLevel: number;
  barsSinceBreakout: number;
  /** 0..100 composite quality score, only set on BREAKOUT */
  confidence?: number;
  /** Per-component contributions for transparency. Only set on BREAKOUT. */
  confidenceBreakdown?: Record<string, number>;
  /** RSI value at the candle close. Only set on RSI_OVERBOUGHT / RSI_OVERSOLD. */
  rsiValue?: number;
  /** Range (high − low) / open as a fraction (always positive). Only on VOLATILITY_SPIKE. */
  volatilityPct?: number;
  /** Candle high. Only on VOLATILITY_SPIKE. */
  candleHigh?: number;
  /** Candle low. Only on VOLATILITY_SPIKE. */
  candleLow?: number;
  /** Crossover direction. Only on MACD_CROSSOVER. */
  macdCross?: "bullish" | "bearish";
  /** MACD line (fast EMA − slow EMA) at the crossover bar. Only on MACD_CROSSOVER. */
  macdLine?: number;
  /** MACD signal line (EMA of the MACD line) at the crossover bar. Only on MACD_CROSSOVER. */
  macdSignal?: number;
  /** MACD histogram (line − signal) at the crossover bar. Only on MACD_CROSSOVER. */
  macdHistogram?: number;
}

export interface Config {
  coin: string;
  interval: Interval;
  lookback: number;
  pollMs: number;
  pivotWindow: number;
  clusterBps: number;
  breakBps: number;
  retestBps: number;
  retestBars: number;
  maxLevels: number;
  /** Path to JSON state file. Undefined = no persistence. */
  stateFile?: string;
  /** Cap on how many bars of replay we'll do on hydrate after an outage. */
  maxReplayBars: number;
  /** RSI lookback period (Wilder smoothing). Default 14. */
  rsiPeriod: number;
  /** RSI value at or above this fires RSI_OVERBOUGHT. Default 70. */
  rsiOverbought: number;
  /** RSI value at or below this fires RSI_OVERSOLD. Default 30. */
  rsiOversold: number;
  /** Body change (close-open)/open percentage; fires VOLATILITY_SPIKE when |body| >= this. Default 1.0 (=1%). */
  volatilityThresholdPct: number;
  /** MACD fast EMA period. Default 12. */
  macdFast: number;
  /** MACD slow EMA period. Default 26. */
  macdSlow: number;
  /** MACD signal EMA period. Default 9. */
  macdSignal: number;
  /**
   * Minimum cross magnitude to fire MACD_CROSSOVER, as a fraction of price:
   * fires only when |histogram| / close >= this at the crossover bar. Price-
   * normalized so one value is comparable across all scanned markets. Default 0.0003.
   */
  macdSeparationPct: number;
  /** Suppress a MACD_CROSSOVER if another crossover occurred within this many prior bars. Default 10. */
  macdDebounceBars: number;
  /** Optional per-monitor inclusion list of alert kinds. Undefined = all kinds emit. */
  alerts?: readonly AlertKind[];
}
