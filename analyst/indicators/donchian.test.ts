import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../../src/types.js";
import { donchian } from "./donchian.js";

function bar(h: number, l: number, c: number): Candle {
  return { openTime: 0, closeTime: 0, open: c, high: h, low: l, close: c, volume: 1, trades: 1 };
}

test("donchian: null when shorter than period", () => {
  assert.equal(donchian([bar(1, 1, 1)], 5), null);
});

test("donchian: max high and min low across window", () => {
  const candles = [
    bar(12, 8, 11),
    bar(15, 9, 14), // max high
    bar(13, 5, 12), // min low
    bar(14, 11, 13),
    bar(14, 12, 13), // close = 13
  ];
  const r = donchian(candles, 5);
  assert.ok(r !== null);
  assert.equal(r!.upper, 15);
  assert.equal(r!.lower, 5);
  assert.equal(r!.mid, 10);
  assert.equal(r!.position, (13 - 5) / 10);
});

test("donchian: flat candles → zero range, position=0.5", () => {
  const flat = Array.from({ length: 5 }, () => bar(10, 10, 10));
  const r = donchian(flat, 5);
  assert.ok(r !== null);
  assert.equal(r!.upper, 10);
  assert.equal(r!.lower, 10);
  assert.equal(r!.position, 0.5);
});

test("donchian: position respects close near upper band", () => {
  const candles = [
    bar(10, 5, 6),
    bar(10, 5, 7),
    bar(10, 5, 9.5),
  ];
  const r = donchian(candles, 3);
  assert.ok(r !== null);
  assert.equal(r!.upper, 10);
  assert.equal(r!.lower, 5);
  assert.equal(r!.position, (9.5 - 5) / 5);
});
