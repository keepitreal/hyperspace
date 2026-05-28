import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../../src/types.js";
import { obv } from "./obv.js";

function bar(c: number, v: number): Candle {
  return { openTime: 0, closeTime: 0, open: c, high: c, low: c, close: c, volume: v, trades: 1 };
}

test("obv: null when fewer than 2 candles", () => {
  assert.equal(obv([bar(10, 100)]), null);
});

test("obv: all-rising closes → OBV = sum(volumes from idx 1)", () => {
  // closes: 10 → 11 → 12 → 13. Volumes 100 each.
  // First bar starts at 0. Then +100 (10→11), +100 (11→12), +100 (12→13) = 300
  const r = obv([bar(10, 100), bar(11, 100), bar(12, 100), bar(13, 100)]);
  assert.ok(r !== null);
  assert.equal(r!.value, 300);
  assert.equal(r!.prev, 200);
});

test("obv: all-falling closes → OBV = -sum(volumes from idx 1)", () => {
  const r = obv([bar(13, 100), bar(12, 100), bar(11, 100), bar(10, 100)]);
  assert.ok(r !== null);
  assert.equal(r!.value, -300);
});

test("obv: flat closes → OBV stays at 0", () => {
  const r = obv([bar(10, 100), bar(10, 100), bar(10, 100)]);
  assert.ok(r !== null);
  assert.equal(r!.value, 0);
});

test("obv: mixed sequence — hand-computed", () => {
  // closes: 10, 12, 11, 13, 13, 12  | volumes: 100, 200, 150, 300, 50, 100
  // bar 1 (10→12): +200 → 200
  // bar 2 (12→11): -150 → 50
  // bar 3 (11→13): +300 → 350
  // bar 4 (13→13): 0 → 350
  // bar 5 (13→12): -100 → 250
  const r = obv([
    bar(10, 100),
    bar(12, 200),
    bar(11, 150),
    bar(13, 300),
    bar(13, 50),
    bar(12, 100),
  ]);
  assert.ok(r !== null);
  assert.equal(r!.value, 250);
  assert.equal(r!.prev, 350);
});
