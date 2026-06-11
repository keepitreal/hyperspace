import assert from "node:assert/strict";
import { test } from "node:test";
import { MacdTracker, type MacdTrackerConfig } from "./macdTracker.js";
import type { Candle } from "./types.js";

function candlesFromCloses(closes: readonly number[]): Candle[] {
  return closes.map((close, i) => ({
    openTime: (i + 1) * 1000,
    closeTime: (i + 1) * 1000 + 900,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    trades: 1,
  }));
}

// Two superimposed oscillations → MACD line repeatedly leads/lags the signal,
// producing closely-spaced crossovers (so the debounce gate has something to drop).
const SINE: number[] = Array.from(
  { length: 260 },
  (_, i) => 100 + Math.sin(i / 3) * 6 + Math.sin(i / 1.7) * 3,
);

const BASE: MacdTrackerConfig = {
  fast: 12,
  slow: 26,
  signal: 9,
  separationPct: 0,
  debounceBars: 0,
  requireZeroLineSide: false,
};

/** Seed the cursor with the first `seed` candles, then process the rest in one update. */
function runOverSine(cfg: MacdTrackerConfig, seed = 40): ReturnType<MacdTracker["drainAlerts"]> {
  const candles = candlesFromCloses(SINE);
  const t = new MacdTracker(cfg);
  t.update({ closedCandles: candles.slice(0, seed), coin: "ETH", interval: "15m" });
  assert.equal(t.drainAlerts().length, 0, "first update must seed silently");
  t.update({ closedCandles: candles, coin: "ETH", interval: "15m" });
  return t.drainAlerts();
}

test("MacdTracker: detects both bullish and bearish crossovers with correct fields", () => {
  const alerts = runOverSine(BASE);
  assert.ok(alerts.length >= 3, `expected several crossovers, got ${alerts.length}`);
  assert.ok(alerts.some((a) => a.macdCross === "bullish"), "expected a bullish cross");
  assert.ok(alerts.some((a) => a.macdCross === "bearish"), "expected a bearish cross");
  for (const a of alerts) {
    assert.equal(a.kind, "MACD_CROSSOVER");
    assert.equal(a.interval, "15m");
    assert.ok(a.macdHistogram !== undefined && a.macdLine !== undefined && a.macdSignal !== undefined);
    // Direction must match histogram sign and side tag.
    if (a.macdCross === "bullish") {
      assert.ok(a.macdHistogram! > 0);
      assert.equal(a.side, "resistance");
    } else {
      assert.ok(a.macdHistogram! < 0);
      assert.equal(a.side, "support");
    }
    assert.ok(Math.abs(a.macdHistogram! - (a.macdLine! - a.macdSignal!)) < 1e-9);
  }
});

test("MacdTracker: magnitude gate suppresses small crosses", () => {
  const ungated = runOverSine({ ...BASE, separationPct: 0 });
  const gated = runOverSine({ ...BASE, separationPct: 0.01 }); // 1% of price
  assert.ok(gated.length < ungated.length, "magnitude gate should drop some crosses");
  for (const a of gated) {
    assert.ok(Math.abs(a.macdHistogram!) >= 0.01 * a.price, "gated alert must clear the threshold");
  }
  // An impossibly large threshold suppresses everything.
  assert.equal(runOverSine({ ...BASE, separationPct: 100 }).length, 0);
});

test("MacdTracker: debounce suppresses crossovers within N prior bars", () => {
  const noDebounce = runOverSine({ ...BASE, debounceBars: 0 });
  const debounced = runOverSine({ ...BASE, debounceBars: 10 });
  assert.ok(debounced.length < noDebounce.length, "debounce should drop closely-spaced crosses");
  // Every surviving alert must be ≥10 bars (≥10_000ms openTime) after the previous one.
  for (let i = 1; i < debounced.length; i++) {
    const gap = debounced[i]!.ts - debounced[i - 1]!.ts;
    assert.ok(gap >= 10 * 1000, `crosses ${i - 1}->${i} too close: ${gap}ms`);
  }
});

test("MacdTracker: requireZeroLineSide keeps only zero-consistent crosses", () => {
  // A trending series (uptrend then downtrend, both with wiggles) yields signal
  // crosses on both sides of zero — unlike a pure oscillator, where every cross
  // lands on the "wrong" side. The gate must keep bullish>0 / bearish<0 only.
  const trend = Array.from({ length: 300 }, (_, i) => {
    const slope = i < 150 ? i * 0.6 : (300 - i) * 0.6;
    return 100 + slope + Math.sin(i / 3) * 5;
  });
  const candles = candlesFromCloses(trend);
  const run = (requireZeroLineSide: boolean): ReturnType<MacdTracker["drainAlerts"]> => {
    const t = new MacdTracker({ ...BASE, requireZeroLineSide });
    t.update({ closedCandles: candles.slice(0, 40), coin: "ETH", interval: "15m" });
    t.drainAlerts();
    t.update({ closedCandles: candles, coin: "ETH", interval: "15m" });
    return t.drainAlerts();
  };

  const unfiltered = run(false);
  const filtered = run(true);
  assert.ok(filtered.length < unfiltered.length, "zero-line gate should drop some crosses");
  assert.ok(filtered.length > 0, "but not all");
  for (const a of filtered) {
    if (a.macdCross === "bullish") {
      assert.ok(a.macdLine! > 0, `bullish cross must be above zero, got ${a.macdLine}`);
    } else {
      assert.ok(a.macdLine! < 0, `bearish cross must be below zero, got ${a.macdLine}`);
    }
  }
  const wrongSide = unfiltered.filter(
    (a) => (a.macdCross === "bullish" && a.macdLine! <= 0) || (a.macdCross === "bearish" && a.macdLine! >= 0),
  );
  assert.ok(wrongSide.length > 0, "expected the series to contain wrong-side crosses");
});

test("MacdTracker: cursor dedups already-processed candles", () => {
  const candles = candlesFromCloses(SINE);
  const t = new MacdTracker(BASE);
  t.update({ closedCandles: candles.slice(0, 40), coin: "ETH", interval: "15m" });
  t.drainAlerts();
  t.update({ closedCandles: candles, coin: "ETH", interval: "15m" });
  const first = t.drainAlerts();
  assert.ok(first.length > 0);
  // Re-feeding the same candles yields nothing new.
  t.update({ closedCandles: candles, coin: "ETH", interval: "15m" });
  assert.equal(t.drainAlerts().length, 0);
});

test("MacdTracker: dump/hydrate round-trips the cursor", () => {
  const candles = candlesFromCloses(SINE);
  const a = new MacdTracker(BASE);
  a.update({ closedCandles: candles, coin: "ETH", interval: "15m" });
  const state = a.dump();

  const b = new MacdTracker(BASE);
  b.hydrate(state);
  assert.equal(b.getLastProcessedOpenTs(), state.lastProcessedOpenTs);
  // Hydrated to the end → re-feeding the same candles emits nothing.
  b.update({ closedCandles: candles, coin: "ETH", interval: "15m" });
  assert.equal(b.drainAlerts().length, 0);
});

test("MacdTracker: hydrate clamps an old cursor forward", () => {
  const t = new MacdTracker(BASE);
  const { clamped } = t.hydrate({ lastProcessedOpenTs: 1000 }, { clampOpenTsTo: 50_000 });
  assert.equal(clamped, true);
  assert.equal(t.getLastProcessedOpenTs(), 50_000);
});
