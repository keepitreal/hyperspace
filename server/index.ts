import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadDotEnv } from "../analyst/env.js";
import { equityCurve } from "../strategies/lib/equity.js";
import { analyzeMae } from "../strategies/lib/mae.js";
import { summarize, summarizeBySide } from "../strategies/lib/metrics.js";
import { runBacktest } from "../strategies/lib/runner.js";
import { openStore } from "../data/store.js";
import { INTERVALS, type Interval } from "../src/types.js";
import { getStrategy, STRATEGIES } from "./strategies.js";

loadDotEnv();

const store = openStore(process.env.MARKET_DB ?? "data/market.db");
const app = new Hono();

app.use("/api/*", cors());

function isInterval(s: string): s is Interval {
  return (INTERVALS as readonly string[]).includes(s);
}

/** Parse an optional ms-timestamp query param; undefined if absent/invalid. */
function optMs(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

app.get("/api/series", (c) => c.json(store.listSeries()));

app.get("/api/strategies", (c) =>
  c.json(STRATEGIES.map((s) => ({ name: s.name, label: s.label, params: s.params }))),
);

app.get("/api/candles", (c) => {
  const symbol = c.req.query("symbol");
  const interval = c.req.query("interval");
  if (symbol === undefined || interval === undefined || !isInterval(interval)) {
    return c.json({ error: "symbol and a valid interval are required" }, 400);
  }
  const from = optMs(c.req.query("from"));
  const to = optMs(c.req.query("to"));
  const candles = store.query(symbol, interval, from, to);
  return c.json({ symbol, interval, candles });
});

interface BacktestBody {
  symbol?: string;
  interval?: string;
  strategy?: string;
  params?: Record<string, unknown>;
  from?: number;
  to?: number;
}

app.post("/api/backtest", async (c) => {
  let body: BacktestBody;
  try {
    body = (await c.req.json()) as BacktestBody;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const { symbol, interval } = body;
  if (symbol === undefined || interval === undefined || !isInterval(interval)) {
    return c.json({ error: "symbol and a valid interval are required" }, 400);
  }
  const def = getStrategy(body.strategy ?? "");
  if (def === undefined) {
    return c.json(
      { error: `unknown strategy; available: ${STRATEGIES.map((s) => s.name).join(", ")}` },
      400,
    );
  }

  const candles = store.query(symbol, interval, body.from, body.to);
  if (candles.length === 0) {
    return c.json({ error: `no candles for ${symbol} ${interval} in range` }, 404);
  }

  const raw = body.params ?? {};
  const strategy = def.build(raw);
  const trades = runBacktest({ coin: symbol, candles, strategy });
  const equity = equityCurve(trades);

  return c.json({
    symbol,
    interval,
    strategy: def.name,
    candles,
    overlays: def.overlays(candles, raw),
    trades,
    equity,
    stats: {
      all: summarize(trades),
      ...summarizeBySide(trades),
      mae: analyzeMae(trades),
    },
  });
});

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, (info) => {
  process.stderr.write(`backtest API listening on http://localhost:${info.port}\n`);
  const series = store.listSeries();
  process.stderr.write(
    series.length === 0
      ? "  (cache is empty — run `pnpm backfill` first)\n"
      : `  cache: ${series.map((s) => `${s.symbol}/${s.interval}=${s.count}`).join("  ")}\n`,
  );
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(
      `\nPort ${port} is already in use — another server is probably still running.\n` +
        `  kill it:        lsof -tiTCP:${port} -sTCP:LISTEN | xargs kill\n` +
        `  or use another: PORT=8788 pnpm serve\n`,
    );
    process.exit(1);
  }
  process.stderr.write(`server error: ${err.message}\n`);
  process.exit(1);
});
