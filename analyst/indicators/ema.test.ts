import assert from "node:assert/strict";
import { test } from "node:test";
import { ema, emaSeries } from "./ema.js";

test("ema: null when input shorter than period", () => {
  assert.equal(ema([1, 2, 3], 4), null);
});

test("ema: constant input returns the constant", () => {
  assert.equal(ema(new Array(10).fill(10), 3), 10);
});

test("ema: rising sequence increases monotonically", () => {
  const series = emaSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  const vals = series.filter((v): v is number => v !== null);
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i]! > vals[i - 1]!, `expected ${vals[i]} > ${vals[i - 1]}`);
  }
});

test("ema: hand-computed reference (period 3, k=0.5)", () => {
  // seed at idx 2 = mean(1,2,3) = 2
  // ema[3] = 4*0.5 + 2*0.5 = 3
  // ema[4] = 5*0.5 + 3*0.5 = 4
  const s = emaSeries([1, 2, 3, 4, 5], 3);
  assert.deepEqual(s.slice(0, 2), [null, null]);
  assert.equal(s[2], 2);
  assert.equal(s[3], 3);
  assert.equal(s[4], 4);
});
