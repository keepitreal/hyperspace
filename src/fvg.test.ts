import assert from "node:assert/strict";
import { test } from "node:test";
import { atrSeries, detectFvgAt } from "./fvg.js";
import type { Candle } from "./types.js";

function bar(open: number, high: number, low: number, close: number): Candle {
  return { openTime: 0, closeTime: 0, open, high, low, close, volume: 1, trades: 1 };
}

test("detectFvgAt: bullish gap when first.high < third.low", () => {
  const c = [bar(100, 102, 99, 101), bar(101, 110, 101, 109), bar(109, 112, 105, 111)];
  const fvg = detectFvgAt(c, 2);
  assert.ok(fvg !== null);
  assert.equal(fvg!.type, "bullish");
  assert.equal(fvg!.bottom, 102); // first.high
  assert.equal(fvg!.top, 105); // third.low
  assert.equal(fvg!.gapSize, 3);
});

test("detectFvgAt: bearish gap when first.low > third.high", () => {
  const c = [bar(100, 101, 98, 99), bar(98, 98, 90, 91), bar(91, 95, 88, 89)];
  const fvg = detectFvgAt(c, 2);
  assert.ok(fvg !== null);
  assert.equal(fvg!.type, "bearish");
  assert.equal(fvg!.bottom, 95); // third.high
  assert.equal(fvg!.top, 98); // first.low
  assert.equal(fvg!.gapSize, 3);
});

test("detectFvgAt: no gap when wicks overlap", () => {
  // third.low (100) is below first.high (102) → no bullish gap; not bearish either.
  const c = [bar(100, 102, 99, 101), bar(101, 108, 100, 107), bar(107, 110, 100, 109)];
  assert.equal(detectFvgAt(c, 2), null);
});

test("detectFvgAt: needs i >= 2 and in range", () => {
  const c = [bar(1, 2, 0, 1), bar(1, 2, 0, 1), bar(1, 2, 0, 1)];
  assert.equal(detectFvgAt(c, 1), null);
  assert.equal(detectFvgAt(c, 3), null);
});

test("atrSeries: warmup null, then positive Wilder ATR", () => {
  const c = Array.from({ length: 20 }, (_, i) => bar(100 + i, 100 + i + 2, 100 + i - 2, 100 + i));
  const s = atrSeries(c, 14);
  for (let i = 0; i < 13; i++) assert.equal(s[i], null, `index ${i} should be null`);
  assert.ok(s[13] !== null && s[13]! > 0);
  assert.ok(s[19] !== null && s[19]! > 0);
});

test("atrSeries: constant-range candles → ATR equals that range", () => {
  // every TR = high-low = 4, and no gaps between closes, so ATR converges to 4.
  const c = Array.from({ length: 30 }, () => bar(100, 102, 98, 100));
  const s = atrSeries(c, 14);
  assert.ok(Math.abs(s[29]! - 4) < 1e-9);
});

test("atrSeries: returns all null when fewer candles than period", () => {
  const c = Array.from({ length: 5 }, () => bar(100, 101, 99, 100));
  assert.deepEqual(atrSeries(c, 14), new Array(5).fill(null));
});
