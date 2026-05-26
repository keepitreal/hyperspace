import type { Candle, Level } from "./types.js";
import { sessionVwap } from "./vwap.js";

const VOLUME_WINDOW = 20;
const ATR_WINDOW = 14;
/** Fractional distance from VWAP below which we treat the close as "at VWAP" and skip the bonus/penalty. */
const VWAP_DEAD_ZONE = 0.0005;

export interface BreakoutScoreBreakdown {
  close: number;
  volume: number;
  atr: number;
  wick: number;
  level: number;
  time: number;
  vwap: number;
}

export interface BreakoutScore {
  total: number;
  breakdown: BreakoutScoreBreakdown;
  /** Components for which we lacked enough history to score. */
  missing: ReadonlyArray<keyof BreakoutScoreBreakdown>;
}

export type ConfidenceBucket = "HIGH" | "MEDIUM" | "LOW" | "VERY_LOW";

export function bucketFor(total: number): ConfidenceBucket {
  if (total >= 75) return "HIGH";
  if (total >= 50) return "MEDIUM";
  if (total >= 25) return "LOW";
  return "VERY_LOW";
}

/**
 * Position of the close within the bar's range, oriented to the breakout
 * direction. 1.0 means the close is at the most-favourable extreme for the
 * breakout (top of the bar for an upside break, bottom for downside).
 */
export function closeStrength(candle: Candle, side: Level["side"]): number {
  const range = candle.high - candle.low;
  if (range <= 0) return 0;
  const fromLow = (candle.close - candle.low) / range;
  return side === "resistance" ? fromLow : 1 - fromLow;
}

/** Returns null when history doesn't cover the required window. */
export function volumeRatio(candle: Candle, history: readonly Candle[]): number | null {
  if (history.length < VOLUME_WINDOW) return null;
  const recent = history.slice(-VOLUME_WINDOW);
  let sum = 0;
  for (const c of recent) sum += c.volume;
  const mean = sum / VOLUME_WINDOW;
  if (mean <= 0) return null;
  return candle.volume / mean;
}

/** Wilder-style simple ATR over the last ATR_WINDOW true ranges ending at `candle`. */
export function atr(candle: Candle, history: readonly Candle[]): number | null {
  if (history.length < ATR_WINDOW) return null;
  const window = history.slice(-ATR_WINDOW);
  let trSum = 0;
  let prevClose = window[0]!.close;
  for (let i = 1; i < window.length; i++) {
    const c = window[i]!;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
    trSum += tr;
    prevClose = c.close;
  }
  const lastInHistory = window[window.length - 1]!;
  const finalTr = Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - lastInHistory.close),
    Math.abs(candle.low - lastInHistory.close),
  );
  trSum += finalTr;
  return trSum / ATR_WINDOW;
}

/**
 * Ratio of the rejecting wick to the candle body, oriented to the break side.
 * Resistance breaks penalize an upper wick; support breaks penalize a lower wick.
 * Returns Infinity when the body is doji-thin (still wants to be penalized).
 */
export function wickRatio(candle: Candle, side: Level["side"]): number {
  const body = Math.abs(candle.close - candle.open);
  const upper = candle.high - Math.max(candle.open, candle.close);
  const lower = Math.min(candle.open, candle.close) - candle.low;
  const rejecting = side === "resistance" ? upper : lower;
  if (body <= 0) return rejecting > 0 ? Infinity : 0;
  return rejecting / body;
}

interface TimeBucket {
  score: number;
  label: string;
}

/**
 * Coarse liquidity bucket from UTC timestamp. Weekends and after-hours
 * Asia sessions are statistically lower-quality for crypto breakouts.
 */
export function timeBucket(ts: number): TimeBucket {
  const d = new Date(ts);
  const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
  const hour = d.getUTCHours();
  if (dow === 0 || dow === 6) return { score: 0, label: "weekend" };
  if (hour >= 12 && hour < 22) return { score: 10, label: "us_eu_overlap" };
  if (hour >= 7 && hour < 12) return { score: 8, label: "london" };
  if (hour < 7) return { score: 6, label: "asia" };
  return { score: 5, label: "post_close" };
}

function scoreClose(candle: Candle, side: Level["side"]): number {
  return Math.round(closeStrength(candle, side) * 25);
}

function scoreVolume(ratio: number | null): number {
  if (ratio === null) return 0;
  if (ratio < 1) return 0;
  if (ratio < 1.5) return 10;
  if (ratio < 2) return 18;
  return 25;
}

function scoreAtr(closeBeyondLevel: number, atrValue: number | null): number {
  if (atrValue === null || atrValue <= 0) return 0;
  const mag = closeBeyondLevel / atrValue;
  if (mag < 0.25) return 0;
  if (mag < 0.5) return 7;
  if (mag < 1) return 12;
  return 15;
}

function scoreWick(ratio: number): number {
  if (ratio > 2.5) return -15;
  if (ratio > 1.5) return -8;
  return 0;
}

function scoreLevel(touches: number): number {
  if (touches <= 1) return 0;
  if (touches === 2) return 5;
  if (touches === 3) return 10;
  return 15;
}

/**
 * Reward breakouts that close on the directionally-correct side of session
 * VWAP; penalize counter-trend breakouts. Inside a tight band around VWAP
 * the score is 0 — boundary noise shouldn't flip a 16-point swing on a
 * fractional bps difference.
 */
function scoreVwap(close: number, vwap: number | null, side: Level["side"]): number {
  if (vwap === null || vwap <= 0) return 0;
  const fracDist = (close - vwap) / vwap;
  if (Math.abs(fracDist) < VWAP_DEAD_ZONE) return 0;
  const aligned = side === "resistance" ? fracDist > 0 : fracDist < 0;
  return aligned ? 8 : -8;
}

export interface DebugFeatures {
  volumeRatio: number | null;
  atr: number | null;
  vwap: number | null;
  closePos: number;
  upperWickRatio: number;
  lowerWickRatio: number;
  timeLabel: string;
}

/**
 * Raw scoring inputs for a candle, with no orientation toward a level.
 * Intended for verbose-mode logging so each input can be eyeballed
 * independently.
 */
export function debugFeatures(candle: Candle, history: readonly Candle[]): DebugFeatures {
  const range = candle.high - candle.low;
  const closePos = range > 0 ? (candle.close - candle.low) / range : 0;
  const body = Math.abs(candle.close - candle.open);
  const upper = candle.high - Math.max(candle.open, candle.close);
  const lower = Math.min(candle.open, candle.close) - candle.low;
  const upperWickRatio = body > 0 ? upper / body : upper > 0 ? Infinity : 0;
  const lowerWickRatio = body > 0 ? lower / body : lower > 0 ? Infinity : 0;
  return {
    volumeRatio: volumeRatio(candle, history),
    atr: atr(candle, history),
    vwap: sessionVwap(candle, history),
    closePos,
    upperWickRatio,
    lowerWickRatio,
    timeLabel: timeBucket(candle.closeTime).label,
  };
}

export function scoreBreakout(args: {
  candle: Candle;
  history: readonly Candle[];
  level: Level;
}): BreakoutScore {
  const { candle, history, level } = args;

  const vr = volumeRatio(candle, history);
  const atrValue = atr(candle, history);
  const vwap = sessionVwap(candle, history);
  const wr = wickRatio(candle, level.side);
  const closeBeyond =
    level.side === "resistance" ? candle.close - level.price : level.price - candle.close;
  const tb = timeBucket(candle.closeTime);

  const breakdown: BreakoutScoreBreakdown = {
    close: scoreClose(candle, level.side),
    volume: scoreVolume(vr),
    atr: scoreAtr(closeBeyond, atrValue),
    wick: scoreWick(wr),
    level: scoreLevel(level.touches),
    time: tb.score,
    vwap: scoreVwap(candle.close, vwap, level.side),
  };

  const missing: Array<keyof BreakoutScoreBreakdown> = [];
  if (vr === null) missing.push("volume");
  if (atrValue === null) missing.push("atr");
  if (vwap === null) missing.push("vwap");

  const raw =
    breakdown.close +
    breakdown.volume +
    breakdown.atr +
    breakdown.wick +
    breakdown.level +
    breakdown.time +
    breakdown.vwap;
  const total = Math.max(0, Math.min(100, raw));

  return { total, breakdown, missing };
}
