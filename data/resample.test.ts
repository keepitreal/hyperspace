import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candle } from "../src/types.js";
import { resampleRth } from "./resample.js";

const MIN = 60_000;

/**
 * Build one EDT trading day of 5-minute bars. June is EDT (UTC-4), so 09:30 ET
 * = 13:30 UTC. RTH 09:30–16:00 = 78 bars. We also prepend two pre-market bars
 * (08:00 ET) and append two post-market bars (16:30 ET) that must be filtered.
 * Close walks +0.01 each bar so OHLC ordering is checkable.
 */
function buildDay(dateUtc: string): Candle[] {
  const out: Candle[] = [];
  const rthStart = Date.parse(`${dateUtc}T13:30:00Z`); // 09:30 ET
  // pre-market: 08:00 ET = 12:00 UTC, two bars
  const preStart = Date.parse(`${dateUtc}T12:00:00Z`);
  // post-market: 16:30 ET = 20:30 UTC, two bars
  const postStart = Date.parse(`${dateUtc}T20:30:00Z`);

  let price = 100;
  const push = (openTime: number): void => {
    const open = price;
    const close = price + 0.01;
    out.push({
      openTime,
      closeTime: openTime + 5 * MIN,
      open,
      high: close + 0.05,
      low: open - 0.05,
      close,
      volume: 10,
      trades: 2,
    });
    price = close;
  };

  push(preStart);
  push(preStart + 5 * MIN);
  for (let i = 0; i < 78; i++) push(rthStart + i * 5 * MIN);
  push(postStart);
  push(postStart + 5 * MIN);
  return out;
}

test("resampleRth 1d: one bar per session, extended hours filtered", () => {
  const day = buildDay("2024-06-04");
  const bars = resampleRth(day, "1d");
  assert.equal(bars.length, 1);
  const b = bars[0];
  assert.ok(b);
  // open = first RTH bar's open (09:30 ET = 13:30 UTC)
  assert.equal(b.openTime, Date.parse("2024-06-04T13:30:00Z"));
  // 78 RTH bars aggregated; volume 78*10
  assert.equal(b.volume, 780);
  assert.equal(b.trades, 156);
});

test("resampleRth 1h: 09:30-anchored, 6.5h session -> 7 bars (last is 30min)", () => {
  const day = buildDay("2024-06-04");
  const bars = resampleRth(day, "1h");
  assert.equal(bars.length, 7);
  // first six buckets hold 12 five-min bars (60 min); the last holds 6 (30 min)
  assert.equal(bars[0]?.volume, 120);
  assert.equal(bars[5]?.volume, 120);
  assert.equal(bars[6]?.volume, 60);
  // first bar opens at the session open
  assert.equal(bars[0]?.openTime, Date.parse("2024-06-04T13:30:00Z"));
  // second bar opens one hour later
  assert.equal(bars[1]?.openTime, Date.parse("2024-06-04T14:30:00Z"));
});

test("resampleRth 4h: 09:30-anchored -> two bars (4h + 2.5h)", () => {
  const day = buildDay("2024-06-04");
  const bars = resampleRth(day, "4h");
  assert.equal(bars.length, 2);
  assert.equal(bars[0]?.volume, 480); // 48 bars (09:30–13:30)
  assert.equal(bars[1]?.volume, 300); // 30 bars (13:30–16:00)
});

test("resampleRth 1w: consecutive sessions collapse into one ISO-week bar", () => {
  // 2024-06-04 (Tue) and 2024-06-05 (Wed) are the same ISO week.
  const week = [...buildDay("2024-06-04"), ...buildDay("2024-06-05")];
  const bars = resampleRth(week, "1w");
  assert.equal(bars.length, 1);
  assert.equal(bars[0]?.volume, 1560); // 2 * 780 RTH bars
  // opens at the first session's open
  assert.equal(bars[0]?.openTime, Date.parse("2024-06-04T13:30:00Z"));
});

test("resampleRth: unsorted input is handled", () => {
  const day = buildDay("2024-06-04");
  const shuffled = [...day].reverse();
  const bars = resampleRth(shuffled, "1d");
  assert.equal(bars.length, 1);
  assert.equal(bars[0]?.openTime, Date.parse("2024-06-04T13:30:00Z"));
});
