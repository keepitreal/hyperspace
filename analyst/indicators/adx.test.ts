import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../../src/types.js";
import { adx } from "./adx.js";

function bar(o: number, h: number, l: number, c: number): Candle {
  return { openTime: 0, closeTime: 0, open: o, high: h, low: l, close: c, volume: 1, trades: 1 };
}

test("adx: null when too short", () => {
  assert.equal(adx(new Array(28).fill(bar(10, 11, 9, 10)), 14), null);
});

test("adx: strong uptrend → +DI > −DI, ADX rises", () => {
  // 40 monotonically rising bars, no overlap (each bar's low above prior high)
  const candles: Candle[] = Array.from({ length: 40 }, (_, i) => bar(i, i + 1, i - 0.5, i + 0.5));
  const r = adx(candles, 14);
  assert.ok(r !== null);
  assert.ok(r!.plusDI > r!.minusDI, `expected +DI > −DI, got ${r!.plusDI} vs ${r!.minusDI}`);
  assert.ok(r!.adx > 25, `expected strong-trend ADX > 25, got ${r!.adx}`);
});

test("adx: strong downtrend → −DI > +DI, ADX rises", () => {
  const candles: Candle[] = Array.from({ length: 40 }, (_, i) => bar(50 - i, 51 - i, 49 - i - 0.5, 50 - i - 0.5));
  const r = adx(candles, 14);
  assert.ok(r !== null);
  assert.ok(r!.minusDI > r!.plusDI);
  assert.ok(r!.adx > 25);
});

test("adx: zero-range flat market → ADX = 0, DIs = 0", () => {
  const candles = new Array(40).fill(bar(10, 10, 10, 10));
  const r = adx(candles, 14);
  assert.ok(r !== null);
  assert.equal(r!.adx, 0);
  assert.equal(r!.plusDI, 0);
  assert.equal(r!.minusDI, 0);
});

test("adx: choppy sideways → low ADX", () => {
  // Alternating bars with overlapping highs/lows
  const candles: Candle[] = Array.from({ length: 40 }, (_, i) => {
    const m = 100;
    return i % 2 === 0 ? bar(m, m + 1, m - 1, m + 0.5) : bar(m + 0.5, m + 1, m - 1, m);
  });
  const r = adx(candles, 14);
  assert.ok(r !== null);
  assert.ok(r!.adx < 30, `expected low-trend ADX (<30), got ${r!.adx}`);
});

test("adx: result fields all in [0, 100]", () => {
  const candles: Candle[] = Array.from({ length: 50 }, (_, i) => {
    const p = 100 + Math.sin(i / 3) * 5;
    return bar(p, p + 1, p - 1, p);
  });
  const r = adx(candles, 14);
  assert.ok(r !== null);
  assert.ok(r!.adx >= 0 && r!.adx <= 100);
  assert.ok(r!.plusDI >= 0 && r!.plusDI <= 100);
  assert.ok(r!.minusDI >= 0 && r!.minusDI <= 100);
});
