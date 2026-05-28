import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../../src/types.js";
import { pivots } from "./pivots.js";

function bar(o: number, h: number, l: number, c: number): Candle {
  return { openTime: 0, closeTime: 0, open: o, high: h, low: l, close: c, volume: 1, trades: 1 };
}

test("pivots: hand-computed classic levels", () => {
  // H=110, L=90, C=100
  // P = (110+90+100)/3 = 100
  // R1 = 2*100 - 90 = 110
  // S1 = 2*100 - 110 = 90
  // R2 = 100 + (110-90) = 120
  // S2 = 100 - 20 = 80
  // R3 = 110 + 2*(100-90) = 130
  // S3 = 90 - 2*(110-100) = 70
  const r = pivots(bar(95, 110, 90, 100));
  assert.equal(r.p, 100);
  assert.equal(r.r1, 110);
  assert.equal(r.s1, 90);
  assert.equal(r.r2, 120);
  assert.equal(r.s2, 80);
  assert.equal(r.r3, 130);
  assert.equal(r.s3, 70);
});

test("pivots: collapsed range (H=L=C) → all levels equal", () => {
  const r = pivots(bar(50, 50, 50, 50));
  assert.equal(r.p, 50);
  assert.equal(r.r1, 50);
  assert.equal(r.s1, 50);
  assert.equal(r.r2, 50);
  assert.equal(r.s2, 50);
  assert.equal(r.r3, 50);
  assert.equal(r.s3, 50);
});

test("pivots: ordering invariant — S3 < S2 < S1 < P < R1 < R2 < R3", () => {
  const r = pivots(bar(100, 120, 80, 105));
  assert.ok(r.s3 < r.s2);
  assert.ok(r.s2 < r.s1);
  assert.ok(r.s1 < r.p);
  assert.ok(r.p < r.r1);
  assert.ok(r.r1 < r.r2);
  assert.ok(r.r2 < r.r3);
});
