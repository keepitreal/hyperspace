import { bollinger } from "../analyst/indicators/bollinger.js";
import { computeRsi } from "../src/rsi.js";
import type { Action, Strategy, StrategyContext } from "./lib/runner.js";

export interface BollingerParams {
  /** Bollinger SMA + stddev period. */
  period: number;
  /** Band width in standard deviations. */
  k: number;
  /** RSI period. */
  rsiPeriod: number;
  /** Go long when RSI <= this AND close is below the lower band. */
  rsiLong: number;
  /** Go short when RSI >= this AND close is above the upper band. */
  rsiShort: number;
  /** Force-exit after this many bars if the mean isn't tagged first. */
  maxBars: number;
  /** Enable short entries (set false for long-only mean reversion). */
  allowShort: boolean;
}

export const BOLLINGER_DEFAULTS: BollingerParams = {
  period: 20,
  k: 2,
  rsiPeriod: 14,
  rsiLong: 30,
  rsiShort: 70,
  maxBars: 30,
  allowShort: true,
};

/**
 * Bollinger-band mean reversion with an RSI confirmation.
 *
 *  - Long when close < lower band AND RSI <= rsiLong.
 *  - Short when close > upper band AND RSI >= rsiShort (if allowShort).
 *  - Exit when price reverts to the middle band (the SMA mean), or after
 *    maxBars bars, whichever comes first.
 *
 * Fills are at the signal bar's close (frictionless), matching runBacktest.
 */
export function makeBollingerMeanReversion(params: BollingerParams): Strategy {
  const { period, k, rsiPeriod, rsiLong, rsiShort, maxBars, allowShort } = params;
  return {
    name: "bollinger-mean-reversion",
    minWarmupBars: Math.max(period, rsiPeriod + 1) + 1,
    onBar({ candle, historyUpToButNotIncluding, position }: StrategyContext): Action {
      const n = historyUpToButNotIncluding.length;
      const closes: number[] = new Array(n + 1);
      for (let i = 0; i < n; i++) {
        const c = historyUpToButNotIncluding[i];
        if (c === undefined) return { type: "hold" };
        closes[i] = c.close;
      }
      closes[n] = candle.close;

      const bb = bollinger(closes, period, k);
      if (bb === null) return { type: "hold" };

      if (position !== null) {
        const barsHeld = n - position.entryIndex;
        if (barsHeld >= maxBars) return { type: "close", reason: "TIMEOUT" };
        if (position.side === "long" && candle.close >= bb.mid) {
          return { type: "close", reason: "EXIT_MEAN" };
        }
        if (position.side === "short" && candle.close <= bb.mid) {
          return { type: "close", reason: "EXIT_MEAN" };
        }
        return { type: "hold" };
      }

      const rsi = computeRsi(closes, rsiPeriod);
      if (rsi === null) return { type: "hold" };

      if (candle.close < bb.lower && rsi <= rsiLong) {
        return { type: "open", side: "long" };
      }
      if (allowShort && candle.close > bb.upper && rsi >= rsiShort) {
        return { type: "open", side: "short" };
      }
      return { type: "hold" };
    },
  };
}
