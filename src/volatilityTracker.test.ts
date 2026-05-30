import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "./types.js";
import { VolatilityTracker } from "./volatilityTracker.js";

function bar(openTime: number, open: number, close: number): Candle {
  return {
    openTime,
    closeTime: openTime + 60_000,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1,
    trades: 1,
  };
}

test("VolatilityTracker: first hydrate skips initial batch", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  // Last candle has +2% body — would normally fire, but first update skips it
  // and only sets the cursor.
  t.update({
    closedCandles: [bar(1000, 100, 100), bar(2000, 100, 102)],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 0);
  assert.equal(t.getLastProcessedOpenTs(), 2000);
});

test("VolatilityTracker: fires on >=1% body and not on <1%", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  // 0.5% body — should NOT fire
  t.update({
    closedCandles: [bar(1000, 100, 100), bar(2000, 100, 100.5)],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 0);
  // 1.0% body — should fire
  t.update({
    closedCandles: [
      bar(1000, 100, 100),
      bar(2000, 100, 100.5),
      bar(3000, 100, 101),
    ],
    coin: "ETH",
    interval: "5m",
  });
  const alerts = t.drainAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.kind, "VOLATILITY_SPIKE");
});

test("VolatilityTracker: signed direction in volatilityPct", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  // +1.5% up candle
  t.update({
    closedCandles: [bar(1000, 100, 100), bar(2000, 100, 101.5)],
    coin: "ETH",
    interval: "5m",
  });
  const upAlerts = t.drainAlerts();
  assert.equal(upAlerts.length, 1);
  assert.ok(upAlerts[0]!.volatilityPct! > 0);
  assert.equal(upAlerts[0]!.side, "resistance");
  // -1.5% down candle
  t.update({
    closedCandles: [
      bar(1000, 100, 100),
      bar(2000, 100, 101.5),
      bar(3000, 100, 98.5),
    ],
    coin: "ETH",
    interval: "5m",
  });
  const downAlerts = t.drainAlerts();
  assert.equal(downAlerts.length, 1);
  assert.ok(downAlerts[0]!.volatilityPct! < 0);
  assert.equal(downAlerts[0]!.side, "support");
});

test("VolatilityTracker: candleOpen + price populated on emit", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  t.update({
    closedCandles: [bar(1000, 100, 100), bar(2000, 200, 205)],
    coin: "ETH",
    interval: "5m",
  });
  const alert = t.drainAlerts()[0]!;
  assert.equal(alert.candleOpen, 200);
  assert.equal(alert.price, 205);
  assert.ok(Math.abs(alert.volatilityPct! - 0.025) < 1e-9);
});

test("VolatilityTracker: threshold customization", () => {
  const t = new VolatilityTracker({ thresholdPct: 2.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  // 1.5% body — below 2% threshold, no alert
  t.update({
    closedCandles: [bar(1000, 100, 100), bar(2000, 100, 101.5)],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 0);
  // 2.5% — fires
  t.update({
    closedCandles: [
      bar(1000, 100, 100),
      bar(2000, 100, 101.5),
      bar(3000, 100, 102.5),
    ],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 1);
});

test("VolatilityTracker: dump/hydrate preserves cursor", () => {
  const a = new VolatilityTracker({ thresholdPct: 1.0 });
  a.update({
    closedCandles: [bar(1000, 100, 100), bar(2000, 100, 102)],
    coin: "ETH",
    interval: "5m",
  });
  const cursor = a.getLastProcessedOpenTs();
  assert.equal(cursor, 2000);

  const b = new VolatilityTracker({ thresholdPct: 1.0 });
  b.hydrate(a.dump());
  assert.equal(b.getLastProcessedOpenTs(), 2000);

  // Replaying the same data should produce no alerts (cursor blocks them)
  b.update({
    closedCandles: [bar(1000, 100, 100), bar(2000, 100, 102)],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(b.drainAlerts().length, 0);
});

test("VolatilityTracker: ignores candles with open <= 0", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  t.update({
    closedCandles: [bar(1000, 100, 100), bar(2000, 0, 5)],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 0);
});
