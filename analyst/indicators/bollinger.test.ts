import assert from "node:assert/strict";
import { test } from "node:test";
import { bollinger } from "./bollinger.js";

test("bollinger: null when input shorter than period", () => {
  assert.equal(bollinger([1, 2, 3], 5, 2), null);
});

test("bollinger: constant input → bands collapse, bandwidth=0", () => {
  const r = bollinger(new Array(25).fill(100), 20, 2);
  assert.ok(r !== null);
  assert.equal(r!.mid, 100);
  assert.equal(r!.upper, 100);
  assert.equal(r!.lower, 100);
  assert.equal(r!.bandwidth, 0);
  assert.equal(r!.percentB, 0.5);
});

test("bollinger: hand-computed reference values", () => {
  // closes = [10, 12, 14, 16, 18], period=5, k=2
  // mean = 14
  // population variance = ((-4)²+(-2)²+0+2²+4²)/5 = 40/5 = 8
  // stddev = sqrt(8) ≈ 2.8284271
  // upper ≈ 19.6568542; lower ≈ 8.3431458
  // last close = 18 → %b = (18-8.3431458) / (19.6568542-8.3431458) ≈ 0.8536
  const r = bollinger([10, 12, 14, 16, 18], 5, 2);
  assert.ok(r !== null);
  assert.equal(r!.mid, 14);
  assert.ok(Math.abs(r!.upper - 19.6568542) < 1e-4);
  assert.ok(Math.abs(r!.lower - 8.3431458) < 1e-4);
  assert.ok(Math.abs(r!.percentB - 0.8536) < 1e-3);
});

test("bollinger: %b > 1 when close above upper band", () => {
  // Construct: stable 100s then spike to 200
  const closes = [...new Array(19).fill(100), 200];
  const r = bollinger(closes, 20, 2);
  assert.ok(r !== null);
  assert.ok(r!.percentB > 1, `expected %b > 1, got ${r!.percentB}`);
});
