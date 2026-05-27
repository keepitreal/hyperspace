import type { Candle } from "../../src/types.js";

export type Side = "long" | "short";

export interface OpenPosition {
  side: Side;
  entryPrice: number;
  entryTime: number;
  entryIndex: number;
}

export type Action =
  | { type: "open"; side: Side }
  | { type: "close"; reason: string }
  | { type: "hold" };

export interface StrategyContext {
  candle: Candle;
  historyUpToButNotIncluding: readonly Candle[];
  position: OpenPosition | null;
}

export interface Strategy {
  name: string;
  /** Number of leading bars to skip before invoking onBar. */
  minWarmupBars: number;
  onBar(ctx: StrategyContext): Action;
}

export interface Trade {
  coin: string;
  side: Side;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  barsHeld: number;
  exitReason: string;
  pnlBps: number;
  /** Worst adverse excursion in bps (always >= 0), seen on any bar between entry+1 and exit. */
  maeBps: number;
  /** Best favorable excursion in bps (always >= 0), seen on any bar between entry+1 and exit. */
  mfeBps: number;
}

export interface RunBacktestArgs {
  coin: string;
  candles: readonly Candle[];
  strategy: Strategy;
}

function pnlBps(side: Side, entry: number, exit: number): number {
  if (entry <= 0) return 0;
  const delta = side === "long" ? exit - entry : entry - exit;
  return (10_000 * delta) / entry;
}

function updateExcursion(
  side: Side,
  entry: number,
  candle: Candle,
  running: { maeBps: number; mfeBps: number },
): void {
  if (entry <= 0) return;
  const adv =
    side === "long"
      ? (10_000 * (entry - candle.low)) / entry
      : (10_000 * (candle.high - entry)) / entry;
  const fav =
    side === "long"
      ? (10_000 * (candle.high - entry)) / entry
      : (10_000 * (entry - candle.low)) / entry;
  if (adv > running.maeBps) running.maeBps = adv;
  if (fav > running.mfeBps) running.mfeBps = fav;
}

/**
 * Walk the candle series, calling the strategy for every bar past warmup.
 * Frictionless fills at the signal bar's close. No same-bar reversal — the
 * very next call after a close can open a fresh position. Tracks MAE/MFE
 * (in bps, wick-aware) across every bar the position is open.
 */
export function runBacktest(args: RunBacktestArgs): Trade[] {
  const { coin, candles, strategy } = args;
  const trades: Trade[] = [];
  let position: OpenPosition | null = null;
  let running = { maeBps: 0, mfeBps: 0 };

  for (let i = strategy.minWarmupBars; i < candles.length; i++) {
    const candle = candles[i];
    if (candle === undefined) continue;

    if (position !== null && i > position.entryIndex) {
      updateExcursion(position.side, position.entryPrice, candle, running);
    }

    const history = candles.slice(0, i);

    const action = strategy.onBar({
      candle,
      historyUpToButNotIncluding: history,
      position,
    });

    if (action.type === "hold") continue;

    if (action.type === "close" && position !== null) {
      const exitPrice = candle.close;
      trades.push({
        coin,
        side: position.side,
        entryTime: position.entryTime,
        exitTime: candle.openTime,
        entryPrice: position.entryPrice,
        exitPrice,
        barsHeld: i - position.entryIndex,
        exitReason: action.reason,
        pnlBps: pnlBps(position.side, position.entryPrice, exitPrice),
        maeBps: running.maeBps,
        mfeBps: running.mfeBps,
      });
      position = null;
      running = { maeBps: 0, mfeBps: 0 };
      continue;
    }

    if (action.type === "open" && position === null) {
      position = {
        side: action.side,
        entryPrice: candle.close,
        entryTime: candle.openTime,
        entryIndex: i,
      };
      running = { maeBps: 0, mfeBps: 0 };
    }
  }

  if (position !== null && candles.length > 0) {
    const last = candles[candles.length - 1];
    if (last !== undefined) {
      const exitPrice = last.close;
      trades.push({
        coin,
        side: position.side,
        entryTime: position.entryTime,
        exitTime: last.openTime,
        entryPrice: position.entryPrice,
        exitPrice,
        barsHeld: candles.length - 1 - position.entryIndex,
        exitReason: "EOD",
        pnlBps: pnlBps(position.side, position.entryPrice, exitPrice),
        maeBps: running.maeBps,
        mfeBps: running.mfeBps,
      });
    }
  }

  return trades;
}
