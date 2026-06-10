import assert from "node:assert/strict";
import { test } from "node:test";
import { emaSeries, macdSeries, macdHistogramSeries } from "./macd.js";

test("emaSeries: warmup is null, seed is SMA of first period", () => {
  const s = emaSeries([1, 2, 3, 4], 3);
  assert.equal(s[0], null);
  assert.equal(s[1], null);
  assert.equal(s[2], (1 + 2 + 3) / 3);
  assert.ok(s[3] !== null);
});

test("macdSeries: null until slow + signal warmup", () => {
  const closes = new Array(40).fill(100);
  const s = macdSeries(closes, 12, 26, 9);
  // First non-null appears once both the slow EMA (idx 25) and signal EMA
  // (needs 9 line points, i.e. close idx 33) have warmed up.
  for (let i = 0; i < 33; i++) assert.equal(s[i], null, `index ${i} should be null`);
  assert.ok(s[33] !== null, "index 33 should be defined");
});

test("macdSeries: constant input → zero line/signal/histogram", () => {
  const s = macdSeries(new Array(60).fill(100), 12, 26, 9);
  const last = s[s.length - 1]!;
  assert.ok(last !== null);
  assert.ok(Math.abs(last.line) < 1e-9);
  assert.ok(Math.abs(last.signal) < 1e-9);
  assert.ok(Math.abs(last.histogram) < 1e-9);
});

test("macdSeries: steadily rising input → positive line", () => {
  const closes = Array.from({ length: 80 }, (_, i) => 100 + i);
  const s = macdSeries(closes, 12, 26, 9);
  const last = s[s.length - 1]!;
  assert.ok(last !== null);
  assert.ok(last.line > 0, "rising series should have positive MACD line");
});

test("macdHistogramSeries: histogram oscillates with the trend", () => {
  // An oscillating price (sine wave) makes the MACD line lead/lag the signal,
  // so the histogram swings through both signs and crosses zero repeatedly.
  const closes = Array.from({ length: 160 }, (_, i) => 100 + Math.sin(i / 6) * 8);
  const hist = macdHistogramSeries(closes, 12, 26, 9);
  const defined = hist.filter((h): h is number => h !== null);
  const hasPos = defined.some((h) => h > 0);
  const hasNeg = defined.some((h) => h < 0);
  assert.ok(hasPos && hasNeg, "expected both positive and negative histogram values");
});

test("macdSeries: line equals fastEMA - slowEMA at aligned indices", () => {
  const closes = Array.from({ length: 70 }, (_, i) => 100 + Math.sin(i / 3) * 5);
  const fastE = emaSeries(closes, 12);
  const slowE = emaSeries(closes, 26);
  const s = macdSeries(closes, 12, 26, 9);
  for (let i = 0; i < closes.length; i++) {
    const p = s[i];
    if (p == null) continue;
    assert.ok(Math.abs(p.line - (fastE[i]! - slowE[i]!)) < 1e-9, `line mismatch at ${i}`);
    assert.ok(Math.abs(p.histogram - (p.line - p.signal)) < 1e-12);
  }
});
