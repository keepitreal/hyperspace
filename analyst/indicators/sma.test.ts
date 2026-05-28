import assert from "node:assert/strict";
import { test } from "node:test";
import { sma, smaSeries } from "./sma.js";

test("sma: null when input shorter than period", () => {
  assert.equal(sma([1, 2, 3], 4), null);
});

test("sma: constant input returns the constant", () => {
  assert.equal(sma([5, 5, 5, 5, 5], 3), 5);
});

test("sma: hand-computed last-window mean", () => {
  // last 3 of [1,2,3,4,5] = (3+4+5)/3 = 4
  assert.equal(sma([1, 2, 3, 4, 5], 3), 4);
});

test("smaSeries: nulls during warmup, rolling mean after", () => {
  assert.deepEqual(smaSeries([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("smaSeries: shorter than period → all nulls", () => {
  assert.deepEqual(smaSeries([1, 2], 5), [null, null]);
});
