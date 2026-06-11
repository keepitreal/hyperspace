import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, resolveScanIntervals } from "./config.js";

test("resolveScanIntervals: honors an intervals array", () => {
  assert.deepEqual(resolveScanIntervals({ intervals: ["15m", "30m", "1h"] }), [
    "15m",
    "30m",
    "1h",
  ]);
});

test("resolveScanIntervals: falls back to a single interval", () => {
  assert.deepEqual(resolveScanIntervals({ interval: "30m" }), ["30m"]);
});

test("resolveScanIntervals: intervals takes precedence over interval", () => {
  assert.deepEqual(resolveScanIntervals({ interval: "5m", intervals: ["1h"] }), ["1h"]);
});

test("resolveScanIntervals: rejects an empty intervals array", () => {
  assert.throws(() => resolveScanIntervals({ intervals: [] }), ConfigError);
});

test("resolveScanIntervals: rejects an invalid interval in the array", () => {
  assert.throws(() => resolveScanIntervals({ intervals: ["15m", "7m"] }), ConfigError);
});

test("resolveScanIntervals: rejects an invalid single interval", () => {
  assert.throws(() => resolveScanIntervals({ interval: "nope" }), ConfigError);
  assert.throws(() => resolveScanIntervals({}), ConfigError);
});
