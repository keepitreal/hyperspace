import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAlert } from "./log.js";
import { formatTelegramMessage } from "./notify/telegram.js";
import type { Alert } from "./types.js";

function macdAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    kind: "MACD_CROSSOVER",
    ts: 1_700_000_000_000,
    coin: "BTC",
    interval: "1h",
    side: "resistance",
    levelPrice: 0,
    price: 61742,
    bpsFromLevel: 0,
    barsSinceBreakout: 0,
    macdCross: "bullish",
    macdLine: 84.2,
    macdSignal: 71.86,
    macdHistogram: 12.34,
    ...overrides,
  };
}

test("formatAlert: MACD_CROSSOVER shows zero-line distance raw + % of price", () => {
  const s = formatAlert(macdAlert());
  // 84.2 / 61742 * 100 = 0.136%
  assert.ok(s.includes("zero +84.2000 (+0.136%)"), s);
  assert.ok(s.includes("hist 12.3400"), s);
});

test("formatTelegramMessage: MACD_CROSSOVER includes a zero line", () => {
  const s = formatTelegramMessage(macdAlert());
  assert.ok(s.includes("zero +84.2000 (+0.136%)"), s);
});

test("zero-line distance is signed for a cross below zero", () => {
  const a = macdAlert({ macdCross: "bearish", macdLine: -0.0012, price: 0.5, side: "support" });
  // -0.0012 / 0.5 * 100 = -0.240%
  assert.ok(formatAlert(a).includes("zero -0.0012000 (-0.240%)"), formatAlert(a));
  assert.ok(formatTelegramMessage(a).includes("zero -0.0012000 (-0.240%)"));
});

test("zero-line segment is omitted when macdLine is absent", () => {
  const { macdLine, ...a } = macdAlert();
  void macdLine;
  assert.ok(!formatAlert(a).includes("zero "), formatAlert(a));
  assert.ok(!formatTelegramMessage(a).includes("zero "));
});
