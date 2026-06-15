import assert from "node:assert/strict";
import { test } from "node:test";
import { FvgTracker, type FvgTrackerConfig } from "./fvgTracker.js";
import type { Candle } from "./types.js";

const HOUR = 3_600_000;

function bar(openTime: number, high: number, low: number, close: number): Candle {
  return { openTime, closeTime: openTime + HOUR, open: close, high, low, close, volume: 1, trades: 1 };
}

/** rows of [high, low, close]; openTimes are sequential 1h bars. */
function mk(rows: [number, number, number][]): Candle[] {
  return rows.map(([h, l, c], i) => bar(i * HOUR, h, l, c));
}

const BASE: FvgTrackerConfig = {
  atrPeriod: 2,
  atrMultiple: 0,
  proximityPct: 0.005,
  lookbackBars: 1000,
  maxActive: 50,
};

// Bullish FVG completing at idx 7: first.high(100) < third.low(102) → gap [100, 102].
const BULL = mk([
  [100.5, 99.5, 100],
  [100.5, 99.5, 100],
  [100.5, 99.5, 100],
  [100.5, 99.5, 100],
  [100.5, 99.5, 100],
  [100.0, 99.0, 99.5], // idx5 first
  [106.0, 99.5, 105.0], // idx6 displacement
  [107.0, 102.0, 106.0], // idx7 third → gap [100, 102]
]);

// Bearish FVG completing at idx 7: first.low(100) > third.high(98) → gap [98, 100].
const BEAR = mk([
  [100.5, 99.5, 100],
  [100.5, 99.5, 100],
  [100.5, 99.5, 100],
  [100.5, 99.5, 100],
  [100.5, 99.5, 100],
  [101.0, 100.0, 100.5], // idx5 first
  [100.5, 94.0, 95.0], // idx6 displacement
  [98.0, 93.0, 94.0], // idx7 third → gap [98, 100]
]);

function seed(cfg: FvgTrackerConfig, candles: Candle[]): FvgTracker {
  const t = new FvgTracker(cfg);
  t.update({ closedCandles: candles, inProgress: null, coin: "BTC", interval: "1h" });
  return t;
}

test("FvgTracker: first call builds gaps but fires no alerts", () => {
  const t = seed(BASE, BULL);
  assert.equal(t.drainAlerts().length, 0, "seeding must be silent");
  assert.equal(t.dump().gaps.length, 1, "gap should be tracked");
  const g = t.dump().gaps[0]!;
  assert.equal(g.type, "bullish");
  assert.equal(g.bottom, 100);
  assert.equal(g.top, 102);
});

test("FvgTracker: fires once when price approaches the near edge, no re-fire", () => {
  const t = seed(BASE, BULL);
  // price 102.4 → dist (102.4-102)/102.4 = 0.39% < 0.5% → fire
  const near = bar(8 * HOUR, 103, 102, 102.4);
  t.update({ closedCandles: BULL, inProgress: near, coin: "BTC", interval: "1h" });
  const fired = t.drainAlerts();
  assert.equal(fired.length, 1);
  const a = fired[0]!;
  assert.equal(a.kind, "FVG_PROXIMITY");
  assert.equal(a.fvgType, "bullish");
  assert.equal(a.side, "support");
  assert.equal(a.fvgTop, 102);
  assert.equal(a.fvgBottom, 100);
  assert.ok(a.fvgDistancePct! > 0 && a.fvgDistancePct! < 0.005);
  // same proximity again → no re-fire
  t.update({ closedCandles: BULL, inProgress: near, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 0, "must not re-fire while still in band");
});

test("FvgTracker: re-arms after price leaves the band, then fires again", () => {
  const t = seed(BASE, BULL);
  const near = bar(8 * HOUR, 103, 102, 102.4);
  const far = bar(8 * HOUR, 105, 103, 104); // dist (104-102)/104 = 1.92% >= 1.0% → re-arm
  t.update({ closedCandles: BULL, inProgress: near, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 1);
  t.update({ closedCandles: BULL, inProgress: far, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 0);
  t.update({ closedCandles: BULL, inProgress: near, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 1, "fresh approach should re-fire");
});

test("FvgTracker: bearish gap fires with resistance side", () => {
  const t = seed(BASE, BEAR);
  assert.equal(t.dump().gaps[0]!.type, "bearish");
  // price 97.6 below gap [98,100] → dist (98-97.6)/97.6 = 0.41% → fire
  const near = bar(8 * HOUR, 97.8, 97, 97.6);
  t.update({ closedCandles: BEAR, inProgress: near, coin: "BTC", interval: "1h" });
  const fired = t.drainAlerts();
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.fvgType, "bearish");
  assert.equal(fired[0]!.side, "resistance");
});

test("FvgTracker: ATR filter suppresses gaps smaller than atrMultiple × ATR", () => {
  // gap size 2; ATR at formation ≈ 4.4, so atrMultiple 1 requires >= 4.4 → suppressed.
  const strict = seed({ ...BASE, atrMultiple: 1 }, BULL);
  assert.equal(strict.dump().gaps.length, 0);
  const loose = seed({ ...BASE, atrMultiple: 0 }, BULL);
  assert.equal(loose.dump().gaps.length, 1);
});

test("FvgTracker: a closed candle entering the gap mitigates (removes) it", () => {
  const t = seed(BASE, BULL);
  assert.equal(t.dump().gaps.length, 1);
  // new closed candle whose range enters [100,102]
  const mit = bar(8 * HOUR, 101.5, 100.5, 101);
  t.update({ closedCandles: [...BULL, mit], inProgress: null, coin: "BTC", interval: "1h" });
  assert.equal(t.dump().gaps.length, 0, "gap should be mitigated and dropped");
});

test("FvgTracker: live price inside the gap mitigates it (no alert)", () => {
  const t = seed(BASE, BULL);
  const inside = bar(8 * HOUR, 101.5, 100.5, 101); // close 101 ∈ [100,102]
  t.update({ closedCandles: BULL, inProgress: inside, coin: "BTC", interval: "1h" });
  assert.equal(t.drainAlerts().length, 0);
  assert.equal(t.dump().gaps.length, 0);
});

test("FvgTracker: stale gaps are pruned by lookbackBars", () => {
  // gap forms at idx7; later non-overlapping, non-gap-forming candles age it.
  const aged: [number, number, number][] = [
    [108, 103, 107],
    [109, 104, 108],
    [110, 105, 109],
  ];
  const candles = [...BULL, ...mk(aged).map((c, i) => bar((8 + i) * HOUR, c.high, c.low, c.close))];
  assert.equal(seed({ ...BASE, lookbackBars: 1000 }, candles).dump().gaps.length, 1);
  assert.equal(seed({ ...BASE, lookbackBars: 2 }, candles).dump().gaps.length, 0);
});

test("FvgTracker: caps the number of tracked gaps", () => {
  const rows: [number, number, number][] = [
    [100.5, 99.5, 100],
    [100.5, 99.5, 100],
    [100.5, 99.5, 100],
  ];
  for (let s = 0; s < 4; s++) {
    const base = 100 + s * 20;
    rows.push([base + 1, base, base + 0.5]);
    rows.push([base + 15, base + 0.5, base + 14]);
    rows.push([base + 16, base + 5, base + 15]);
  }
  const candles = mk(rows);
  const uncapped = seed({ ...BASE, maxActive: 50 }, candles).dump().gaps.length;
  assert.ok(uncapped > 3, `expected several gaps, got ${uncapped}`);
  assert.equal(seed({ ...BASE, maxActive: 3 }, candles).dump().gaps.length, 3);
});

test("FvgTracker: dump/hydrate round-trips gaps and cursor", () => {
  const a = seed(BASE, BULL);
  const state = a.dump();
  const b = new FvgTracker(BASE);
  b.hydrate(state);
  assert.equal(b.getLastProcessedOpenTs(), state.lastProcessedOpenTs);
  assert.deepEqual(b.dump().gaps, state.gaps);
  // hydrated tracker still alerts on approach
  const near = bar(8 * HOUR, 103, 102, 102.4);
  b.update({ closedCandles: BULL, inProgress: near, coin: "BTC", interval: "1h" });
  assert.equal(b.drainAlerts().length, 1);
});

test("FvgTracker: hydrate clamps an old cursor forward", () => {
  const t = new FvgTracker(BASE);
  const { clamped } = t.hydrate({ lastProcessedOpenTs: 1000, gaps: [] }, { clampOpenTsTo: 50_000 });
  assert.equal(clamped, true);
  assert.equal(t.getLastProcessedOpenTs(), 50_000);
});
