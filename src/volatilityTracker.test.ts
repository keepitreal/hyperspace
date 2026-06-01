import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "./types.js";
import { VolatilityTracker } from "./volatilityTracker.js";

function bar(openTime: number, open: number, high: number, low: number, close: number): Candle {
  return {
    openTime,
    closeTime: openTime + 60_000,
    open,
    high,
    low,
    close,
    volume: 1,
    trades: 1,
  };
}

test("VolatilityTracker: first hydrate skips initial batch", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  // Last candle has 2% range — would normally fire, but first update skips
  // it and only sets the cursor.
  t.update({
    closedCandles: [bar(1000, 100, 101, 99, 100), bar(2000, 100, 102, 100, 101)],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 0);
  assert.equal(t.getLastProcessedOpenTs(), 2000);
});

test("VolatilityTracker: fires on >=1% range and not on <1%", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  // 0.5% range (high 100.5 low 100) — should NOT fire
  t.update({
    closedCandles: [
      bar(1000, 100, 100, 100, 100),
      bar(2000, 100, 100.5, 100, 100.3),
    ],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 0);
  // 1.0% range — fires
  t.update({
    closedCandles: [
      bar(1000, 100, 100, 100, 100),
      bar(2000, 100, 100.5, 100, 100.3),
      bar(3000, 100, 100.5, 99.5, 100.1),
    ],
    coin: "ETH",
    interval: "5m",
  });
  const alerts = t.drainAlerts();
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]!.kind, "VOLATILITY_SPIKE");
});

test("VolatilityTracker: wicks count toward the range", () => {
  // A candle with a flat body but a huge wick should still trigger.
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  // open=100, close=100 (0% body) BUT high=102, low=99 → 3% range
  t.update({
    closedCandles: [bar(1000, 100, 100, 100, 100), bar(2000, 100, 102, 99, 100)],
    coin: "ETH",
    interval: "5m",
  });
  const alerts = t.drainAlerts();
  assert.equal(alerts.length, 1);
  assert.ok(Math.abs(alerts[0]!.volatilityPct! - 0.03) < 1e-9);
});

test("VolatilityTracker: side reflects close direction", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  // Up close — side = resistance
  t.update({
    closedCandles: [
      bar(1000, 100, 100, 100, 100),
      bar(2000, 100, 102, 99, 101.5),
    ],
    coin: "ETH",
    interval: "5m",
  });
  const up = t.drainAlerts();
  assert.equal(up.length, 1);
  assert.equal(up[0]!.side, "resistance");
  // Down close — side = support
  t.update({
    closedCandles: [
      bar(1000, 100, 100, 100, 100),
      bar(2000, 100, 102, 99, 101.5),
      bar(3000, 100, 102, 99, 98.5),
    ],
    coin: "ETH",
    interval: "5m",
  });
  const down = t.drainAlerts();
  assert.equal(down.length, 1);
  assert.equal(down[0]!.side, "support");
});

test("VolatilityTracker: candleHigh + candleLow + price populated on emit", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  t.update({
    closedCandles: [
      bar(1000, 100, 100, 100, 100),
      bar(2000, 200, 210, 195, 205),
    ],
    coin: "ETH",
    interval: "5m",
  });
  const alert = t.drainAlerts()[0]!;
  assert.equal(alert.candleHigh, 210);
  assert.equal(alert.candleLow, 195);
  assert.equal(alert.price, 205);
  // (210 - 195) / 200 = 0.075
  assert.ok(Math.abs(alert.volatilityPct! - 0.075) < 1e-9);
});

test("VolatilityTracker: threshold customization", () => {
  const t = new VolatilityTracker({ thresholdPct: 2.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  // 1.5% range — below 2% threshold, no alert
  t.update({
    closedCandles: [
      bar(1000, 100, 100, 100, 100),
      bar(2000, 100, 101.5, 100, 101),
    ],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 0);
  // 2.5% — fires
  t.update({
    closedCandles: [
      bar(1000, 100, 100, 100, 100),
      bar(2000, 100, 101.5, 100, 101),
      bar(3000, 100, 102.5, 100, 101),
    ],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 1);
});

test("VolatilityTracker: dump/hydrate preserves cursor", () => {
  const a = new VolatilityTracker({ thresholdPct: 1.0 });
  a.update({
    closedCandles: [bar(1000, 100, 100, 100, 100), bar(2000, 100, 102, 99, 101)],
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
    closedCandles: [bar(1000, 100, 100, 100, 100), bar(2000, 100, 102, 99, 101)],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(b.drainAlerts().length, 0);
});

test("VolatilityTracker: ignores candles with open <= 0", () => {
  const t = new VolatilityTracker({ thresholdPct: 1.0 });
  t.update({
    closedCandles: [bar(1000, 100, 100, 100, 100)],
    coin: "ETH",
    interval: "5m",
  });
  t.update({
    closedCandles: [bar(1000, 100, 100, 100, 100), bar(2000, 0, 10, 0, 5)],
    coin: "ETH",
    interval: "5m",
  });
  assert.equal(t.drainAlerts().length, 0);
});
