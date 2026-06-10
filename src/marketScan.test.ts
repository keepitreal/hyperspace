import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchPerpDexNames,
  fetchDexOpenInterest,
  scanMarketsByOpenInterest,
} from "./marketScan.js";

/** Build a stubbed /info POST that routes by request `type` (and `dex`). */
function stubPost(routes: {
  perpDexs?: unknown;
  meta?: Record<string, unknown>; // keyed by dex ("" = main)
}): (body: unknown) => Promise<unknown> {
  return (body: unknown) => {
    const b = body as { type: string; dex?: string };
    if (b.type === "perpDexs") return Promise.resolve(routes.perpDexs);
    if (b.type === "metaAndAssetCtxs") {
      const key = b.dex ?? "";
      return Promise.resolve(routes.meta?.[key]);
    }
    throw new Error(`unexpected request ${JSON.stringify(body)}`);
  };
}

function metaCtxs(rows: { name: string; oi: string; px: string; delisted?: boolean }[]): unknown {
  const universe = rows.map((r) => ({ name: r.name, ...(r.delisted ? { isDelisted: true } : {}) }));
  const ctxs = rows.map((r) => ({ openInterest: r.oi, markPx: r.px }));
  return [{ universe }, ctxs];
}

test("fetchPerpDexNames: maps null to main dex and reads builder names", async () => {
  const post = stubPost({ perpDexs: [null, { name: "xyz" }, { name: "abc" }] });
  const names = await fetchPerpDexNames({ post });
  assert.deepEqual(names, ["", "xyz", "abc"]);
});

test("fetchDexOpenInterest: computes notional = openInterest × markPx", async () => {
  const post = stubPost({
    meta: {
      "": metaCtxs([
        { name: "BTC", oi: "100", px: "60000" }, // 6,000,000
        { name: "ETH", oi: "10", px: "3000" }, // 30,000
      ]),
    },
  });
  const markets = await fetchDexOpenInterest("", { post });
  assert.equal(markets.find((m) => m.coin === "BTC")!.notionalUsd, 6_000_000);
  assert.equal(markets.find((m) => m.coin === "ETH")!.notionalUsd, 30_000);
});

test("scanMarketsByOpenInterest: filters by threshold, excludes delisted, merges builder dexes", async () => {
  const post = stubPost({
    perpDexs: [null, { name: "xyz" }],
    meta: {
      "": metaCtxs([
        { name: "BTC", oi: "1000", px: "60000" }, // 60M ✓
        { name: "SOL", oi: "100", px: "150" }, // 15k ✗
        { name: "OLD", oi: "1000", px: "100000", delisted: true }, // delisted ✗
      ]),
      xyz: metaCtxs([
        { name: "xyz:SP500", oi: "10000", px: "29000" }, // 290M ✓ (prefix kept)
        { name: "xyz:TINY", oi: "1", px: "1" }, // ✗
      ]),
    },
  });
  const coins = await scanMarketsByOpenInterest(50_000_000, { post });
  assert.deepEqual(coins, ["BTC", "xyz:SP500"]);
});

test("scanMarketsByOpenInterest: missing OI/px counts as zero notional", async () => {
  const post = stubPost({
    perpDexs: [null],
    meta: {
      "": [
        { universe: [{ name: "WEIRD" }, { name: "BTC" }] },
        [{ markPx: "100" /* no openInterest */ }, { openInterest: "1000", markPx: "60000" }],
      ],
    },
  });
  const coins = await scanMarketsByOpenInterest(50_000_000, { post });
  assert.deepEqual(coins, ["BTC"]);
});
