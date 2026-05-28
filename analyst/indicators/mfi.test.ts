import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../../src/types.js";
import { mfi } from "./mfi.js";

function bar(h: number, l: number, c: number, v = 100): Candle {
  return { openTime: 0, closeTime: 0, open: c, high: h, low: l, close: c, volume: v, trades: 1 };
}

test("mfi: null when too short", () => {
  assert.equal(mfi(new Array(14).fill(bar(10, 9, 9.5)), 14), null);
});

test("mfi: all-rising typical prices → MFI = 100", () => {
  // 15 bars where typical price strictly increases
  const candles = Array.from({ length: 15 }, (_, i) => bar(i + 10, i, i + 5));
  assert.equal(mfi(candles, 14), 100);
});

test("mfi: all-falling typical prices → MFI = 0", () => {
  const candles = Array.from({ length: 15 }, (_, i) => bar(100 - i, 90 - i, 95 - i));
  assert.equal(mfi(candles, 14), 0);
});

test("mfi: flat prices → no flow on either side → returns 50", () => {
  const candles = new Array(15).fill(bar(10, 10, 10));
  assert.equal(mfi(candles, 14), 50);
});

test("mfi: mixed flows — hand-checked midrange", () => {
  // Period 4: build sequence where pos / neg ratio is known.
  // typical sequence: 10, 11, 10, 11, 10 → +1, -1, +1, -1 over 4 changes
  // Each bar has volume 100, so posSum = 1100*2 = 2200 if we used 11 as positive, etc.
  // Actually rawMF uses typical * volume on the bar where the change OCCURRED.
  // Bars 1,3: typical=11, posMF=11*100=1100 each → posSum=2200
  // Bars 2,4: typical=10, negMF=10*100=1000 each → negSum=2000
  // MFR = 2200/2000 = 1.1; MFI = 100 - 100/2.1 ≈ 52.38
  const candles = [
    bar(10, 10, 10),
    bar(11, 11, 11),
    bar(10, 10, 10),
    bar(11, 11, 11),
    bar(10, 10, 10),
  ];
  const result = mfi(candles, 4);
  assert.ok(result !== null);
  assert.ok(Math.abs(result! - 52.380952) < 1e-4);
});
