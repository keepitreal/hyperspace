import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ConfigError, loadSymbolsConfig, resolveScanIntervals } from "./config.js";

async function withConfigFile<T>(
  contents: unknown,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "hyperspace-config-"));
  const path = join(dir, "config.json");
  try {
    await writeFile(path, JSON.stringify(contents), "utf8");
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

test("loadSymbolsConfig: resolves a symbols-only file", async () => {
  await withConfigFile(
    {
      symbols: [
        { coin: "BTC", interval: "1h", alerts: ["RSI_OVERBOUGHT", "RSI_OVERSOLD"] },
        { coin: "ETH", interval: "4h", alerts: ["RSI_OVERBOUGHT", "RSI_OVERSOLD"] },
      ],
    },
    async (path) => {
      const configs = await loadSymbolsConfig(path);
      assert.equal(configs.length, 2);
      assert.deepEqual(
        configs.map((c) => `${c.coin}:${c.interval}`),
        ["BTC:1h", "ETH:4h"],
      );
    },
  );
});

test("loadSymbolsConfig: rejects a file with neither symbols nor scan", async () => {
  await withConfigFile({ defaults: { rsiOverbought: 70 } }, async (path) => {
    await assert.rejects(() => loadSymbolsConfig(path), ConfigError);
  });
});
