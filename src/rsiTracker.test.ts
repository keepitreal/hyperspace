import assert from "node:assert/strict";
import { test } from "node:test";
import { RsiTracker } from "./rsiTracker.js";
import type { Candle } from "./types.js";

function bar(openTime: number, close: number): Candle {
  return {
    openTime,
    closeTime: openTime + 1000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
    trades: 1,
  };
}

/** Build closed candles from a list of close prices, openTime = index * 1000. */
function series(closes: readonly number[]): Candle[] {
  return closes.map((c, i) => bar(i * 1000, c));
}

const PERIOD = 14;
const cfg = { period: PERIOD, overbought: 70, oversold: 30 };

// A strictly rising series has no losses, so Wilder RSI pins to 100 (overbought).
const RISING = series([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]);
// A strictly falling series has no gains, so RSI pins to 0 (oversold).
const FALLING = series([115, 114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100]);
// A flat series yields RSI 50 (neutral).
const FLAT = series(new Array(16).fill(100) as number[]);

const nextOpen = (candles: readonly Candle[]): number =>
  candles[candles.length - 1]!.openTime + 1000;

test("RsiTracker: fires on the in-progress candle without waiting for it to close", () => {
  const t = new RsiTracker(cfg);
  const inProgress = bar(nextOpen(RISING), 116);
  t.update({ closedCandles: RISING, inProgress, coin: "BTC", interval: "1h" });
  const alerts = t.drainAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.kind, "RSI_OVERBOUGHT");
  assert.equal(alerts[0]!.rsiValue, 100);
  assert.equal(alerts[0]!.price, 116);
});

test("RsiTracker: does not re-fire on the same in-progress candle across polls", () => {
  const t = new RsiTracker(cfg);
  const inProgress = bar(nextOpen(RISING), 116);
  t.update({ closedCandles: RISING, inProgress, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 1);
  // Same live candle re-evaluated on the next poll — still overbought, no new alert.
  const stillHotter = bar(inProgress.openTime, 117);
  t.update({ closedCandles: RISING, inProgress: stillHotter, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 0);
});

test("RsiTracker: a new still-extreme candle re-fires once per bar", () => {
  const t = new RsiTracker(cfg);
  const live1 = bar(nextOpen(RISING), 116);
  t.update({ closedCandles: RISING, inProgress: live1, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 1);
  // live1 closes; a fresh in-progress candle opens, still overbought.
  const closed2 = [...RISING, bar(live1.openTime, 116)];
  const live2 = bar(nextOpen(closed2), 117);
  t.update({ closedCandles: closed2, inProgress: live2, coin: "BTC", interval: "1h" });
  const alerts = t.drainAlerts();
  // The closing of live1 must NOT duplicate the intra-candle alert; only the new
  // bar fires.
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.price, 117);
});

test("RsiTracker: fires RSI_OVERSOLD on the in-progress candle", () => {
  const t = new RsiTracker(cfg);
  const inProgress = bar(nextOpen(FALLING), 99);
  t.update({ closedCandles: FALLING, inProgress, coin: "BTC", interval: "1h" });
  const alerts = t.drainAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.kind, "RSI_OVERSOLD");
  assert.equal(alerts[0]!.rsiValue, 0);
});

test("RsiTracker: neutral RSI does not fire", () => {
  const t = new RsiTracker(cfg);
  // Seed the cursor with the closed history (no alerts on first call).
  t.update({ closedCandles: FLAT, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 0);
  const inProgress = bar(nextOpen(FLAT), 100);
  t.update({ closedCandles: FLAT, inProgress, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 0);
});

test("RsiTracker: first update seeds the cursor without replaying closed history", () => {
  const t = new RsiTracker(cfg);
  t.update({ closedCandles: RISING, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 0);
  assert.equal(t.getLastProcessedOpenTs(), RISING[RISING.length - 1]!.openTime);
});

test("RsiTracker: still sweeps a candle that closed extreme while not polling", () => {
  const t = new RsiTracker(cfg);
  // Seed.
  t.update({ closedCandles: RISING, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 0);
  // A new closed bar arrives (e.g. after a restart), no in-progress candle.
  const closed2 = [...RISING, bar(nextOpen(RISING), 116)];
  t.update({ closedCandles: closed2, coin: "BTC", interval: "1h" });
  const alerts = t.drainAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.kind, "RSI_OVERBOUGHT");
  // Closed-candle alert uses the candle's close time, not "now".
  assert.equal(alerts[0]!.ts, closed2[closed2.length - 1]!.closeTime);
});
