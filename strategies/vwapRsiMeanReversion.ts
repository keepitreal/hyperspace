import { computeRsi } from "../src/rsi.js";
import { sessionVwap } from "../src/vwap.js";
import type { Action, Strategy, StrategyContext } from "./lib/runner.js";

const MS_PER_DAY = 86_400_000;
const RSI_PERIOD = 14;
const RSI_LONG_ENTRY = 20;
const RSI_SHORT_ENTRY = 80;
const RSI_EXIT = 50;

function utcDayKey(ms: number): number {
  return Math.floor(ms / MS_PER_DAY);
}

/**
 * VWAP / RSI symmetric mean reversion.
 *  - Long when price < session VWAP AND RSI(14) <= 25.
 *  - Short when price > session VWAP AND RSI(14) >= 75.
 *  - Exit either side when RSI crosses through 50.
 *  - Force-close at the first bar of a new UTC day (VWAP session boundary).
 *
 * Fills are simulated at the signal bar's close (frictionless).
 */
export const vwapRsiMeanReversion: Strategy = {
  name: "vwap-rsi-mean-reversion",
  minWarmupBars: RSI_PERIOD + 1,
  onBar({ candle, historyUpToButNotIncluding, position }: StrategyContext): Action {
    if (position !== null) {
      if (utcDayKey(candle.openTime) !== utcDayKey(position.entryTime)) {
        return { type: "close", reason: "TIMEOUT_DAY" };
      }
    }

    const closes: number[] = new Array(historyUpToButNotIncluding.length + 1);
    for (let i = 0; i < historyUpToButNotIncluding.length; i++) {
      const c = historyUpToButNotIncluding[i];
      if (c === undefined) return { type: "hold" };
      closes[i] = c.close;
    }
    closes[historyUpToButNotIncluding.length] = candle.close;

    const rsi = computeRsi(closes, RSI_PERIOD);
    if (rsi === null) return { type: "hold" };

    if (position !== null) {
      if (position.side === "long" && rsi >= RSI_EXIT) {
        return { type: "close", reason: "EXIT_RSI50" };
      }
      if (position.side === "short" && rsi <= RSI_EXIT) {
        return { type: "close", reason: "EXIT_RSI50" };
      }
      return { type: "hold" };
    }

    const vwap = sessionVwap(candle, historyUpToButNotIncluding);
    if (vwap === null) return { type: "hold" };

    if (candle.close < vwap && rsi <= RSI_LONG_ENTRY) {
      return { type: "open", side: "long" };
    }
    if (candle.close > vwap && rsi >= RSI_SHORT_ENTRY) {
      return { type: "open", side: "short" };
    }
    return { type: "hold" };
  },
};
