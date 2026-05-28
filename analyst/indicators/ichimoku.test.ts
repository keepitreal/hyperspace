import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../../src/types.js";
import { ichimoku } from "./ichimoku.js";

function bar(h: number, l: number, c: number): Candle {
  return { openTime: 0, closeTime: 0, open: c, high: h, low: l, close: c, volume: 1, trades: 1 };
}

test("ichimoku: null when too short", () => {
  // Needs senkouB(52) + displacement(26) = 78 bars
  assert.equal(ichimoku(new Array(77).fill(bar(10, 9, 9.5))), null);
});

test("ichimoku: strong uptrend → priceAboveCloud, cloudBullish, chikouAbovePast", () => {
  // 80 monotonically rising bars (no overlap so close > past close trivially)
  const candles: Candle[] = Array.from({ length: 80 }, (_, i) => bar(i + 1, i - 1, i));
  const r = ichimoku(candles);
  assert.ok(r !== null);
  assert.ok(r!.priceAboveCloud, "expected price above cloud in uptrend");
  assert.ok(r!.cloudBullish, "expected bullish future cloud in uptrend");
  assert.ok(r!.chikouAbovePast, "expected chikou above past close in uptrend");
});

test("ichimoku: strong downtrend → priceBelowCloud, cloudBearish", () => {
  const candles: Candle[] = Array.from({ length: 80 }, (_, i) => bar(100 - i + 1, 100 - i - 1, 100 - i));
  const r = ichimoku(candles);
  assert.ok(r !== null);
  assert.ok(r!.priceBelowCloud);
  assert.ok(!r!.cloudBullish);
  assert.ok(!r!.chikouAbovePast);
});

test("ichimoku: flat market → cloud collapses to one price; price neither above nor below", () => {
  const candles = new Array(80).fill(bar(50, 50, 50));
  const r = ichimoku(candles);
  assert.ok(r !== null);
  assert.equal(r!.tenkan, 50);
  assert.equal(r!.kijun, 50);
  assert.equal(r!.senkouA, 50);
  assert.equal(r!.senkouB, 50);
  assert.ok(!r!.priceAboveCloud);
  assert.ok(!r!.priceBelowCloud);
});

test("ichimoku: tenkan and kijun reflect their respective midpoints", () => {
  // 80 bars where last 9 have high in [109..117] and low in [100..108]
  // so 9-period high=117, low=100, tenkan=(117+100)/2 = 108.5
  const candles: Candle[] = Array.from({ length: 80 }, (_, i) => bar(i + 30, i, i + 15));
  const r = ichimoku(candles);
  assert.ok(r !== null);
  // last 9 bars: i=71..79; highs 101..109, lows 71..79
  // 9-period high = 109, low = 71, tenkan = 90
  assert.equal(r!.tenkan, (109 + 71) / 2);
  // last 26: i=54..79; highs 84..109, lows 54..79; mid = (109+54)/2 = 81.5
  assert.equal(r!.kijun, (109 + 54) / 2);
});
