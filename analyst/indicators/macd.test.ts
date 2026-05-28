import assert from "node:assert/strict";
import { test } from "node:test";
import { macd } from "./macd.js";

test("macd: null when input too short", () => {
  assert.equal(macd(new Array(33).fill(100), 12, 26, 9), null);
});

test("macd: constant input → zero line, signal, histogram", () => {
  const r = macd(new Array(60).fill(100), 12, 26, 9);
  assert.ok(r !== null);
  assert.ok(Math.abs(r!.line) < 1e-9);
  assert.ok(Math.abs(r!.signal) < 1e-9);
  assert.ok(Math.abs(r!.histogram) < 1e-9);
});

test("macd: rising sequence produces positive line (bullish)", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
  const r = macd(closes, 12, 26, 9);
  assert.ok(r !== null);
  assert.ok(r!.line > 0, `expected line > 0, got ${r!.line}`);
});

test("macd: falling sequence produces negative line (bearish)", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 200 - i);
  const r = macd(closes, 12, 26, 9);
  assert.ok(r !== null);
  assert.ok(r!.line < 0, `expected line < 0, got ${r!.line}`);
});

test("macd: histogram = line - signal", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10);
  const r = macd(closes, 12, 26, 9);
  assert.ok(r !== null);
  assert.ok(Math.abs(r!.histogram - (r!.line - r!.signal)) < 1e-9);
});
