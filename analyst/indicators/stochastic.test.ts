import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../../src/types.js";
import { stochastic } from "./stochastic.js";

function bar(h: number, l: number, c: number): Candle {
  return { openTime: 0, closeTime: 0, open: c, high: h, low: l, close: c, volume: 1, trades: 1 };
}

test("stochastic: null when input too short", () => {
  // needs period(14) + kSlowing(3) + dPeriod(3) - 2 = 18 bars
  assert.equal(stochastic(new Array(17).fill(bar(10, 9, 9.5)), 14, 3, 3), null);
});

test("stochastic: close at top of range → %K near 100", () => {
  // 18 bars with high=10, low=5; last close = 10 → raw%K=100 each smoothed bar
  const candles = new Array(20).fill(bar(10, 5, 10));
  const r = stochastic(candles, 14, 3, 3);
  assert.ok(r !== null);
  assert.equal(r!.k, 100);
  assert.equal(r!.d, 100);
});

test("stochastic: close at bottom of range → %K near 0", () => {
  const candles = new Array(20).fill(bar(10, 5, 5));
  const r = stochastic(candles, 14, 3, 3);
  assert.ok(r !== null);
  assert.equal(r!.k, 0);
  assert.equal(r!.d, 0);
});

test("stochastic: flat candles → defaults to 50", () => {
  const candles = new Array(20).fill(bar(7, 7, 7));
  const r = stochastic(candles, 14, 3, 3);
  assert.ok(r !== null);
  assert.equal(r!.k, 50);
  assert.equal(r!.d, 50);
});

test("stochastic: rising sequence pulls %K above 50", () => {
  const candles = Array.from({ length: 25 }, (_, i) => bar(i + 10, i, i + 9));
  const r = stochastic(candles, 14, 3, 3);
  assert.ok(r !== null);
  assert.ok(r!.k > 50, `expected k > 50, got ${r!.k}`);
});
