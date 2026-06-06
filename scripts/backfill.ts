import { loadDotEnv } from "../analyst/env.js";
import { polygonProvider } from "../data/providers/polygon.js";
import type { Timespan } from "../data/providers/types.js";
import { RESAMPLE_TARGETS, resampleRth } from "../data/resample.js";
import { openStore } from "../data/store.js";
import type { Candle, Interval } from "../src/types.js";

const MS_PER_DAY = 86_400_000;

interface ParsedArgs {
  symbol: string;
  years: number;
  multiplier: number;
  timespan: Timespan;
  db: string;
  /** Re-fetch the entire window even if the store already has data. */
  full: boolean;
  /** API requests/minute pacing (free tier = 5). */
  rpm: number;
}

const TIMESPANS: readonly Timespan[] = ["minute", "hour", "day", "week"];

function isTimespan(s: string): s is Timespan {
  return (TIMESPANS as readonly string[]).includes(s);
}

/** Map a (multiplier, timespan) pair to the project Interval label, if one exists. */
function baseIntervalLabel(multiplier: number, timespan: Timespan): Interval | null {
  const key = `${multiplier}:${timespan}`;
  const map: Record<string, Interval> = {
    "1:minute": "1m",
    "3:minute": "3m",
    "5:minute": "5m",
    "15:minute": "15m",
    "30:minute": "30m",
    "1:hour": "1h",
    "1:day": "1d",
    "1:week": "1w",
  };
  return map[key] ?? null;
}

function usage(): string {
  return [
    "Usage: pnpm backfill [--symbol SPY] [--years 2] [--multiplier 5] [--timespan minute] [--db path] [--full]",
    "",
    "  --symbol      ticker (default: SPY)",
    "  --years       lookback window in years (default: 2)",
    "  --multiplier  base bar size multiplier (default: 5)",
    `  --timespan    one of ${TIMESPANS.join(", ")} (default: minute)`,
    "  --db          SQLite path (default: data/market.db)",
    "  --full        re-fetch the whole window, ignoring existing data",
    "  --rpm         API requests/minute pacing (default: 5 = free tier)",
    "",
    "Fetches the base series, stores it, and (for a 5m base) resamples RTH-only",
    "into 1h/4h/1d/1w, persisting each to the SQLite cache.",
    "",
    "Requires MASSIVE_API_KEY (or POLYGON_API_KEY) in .env or the environment.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let symbol = "SPY";
  let years = 2;
  let multiplier = 5;
  let timespan: Timespan = "minute";
  let db = "data/market.db";
  let full = false;
  let rpm = 5;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (a === "--") continue;
    if (a === "--full") {
      full = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined) throw new Error(`missing value for ${a}`);
    if (a === "--symbol") {
      symbol = next;
      i += 1;
    } else if (a === "--years") {
      const v = Number(next);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`--years must be positive, got ${next}`);
      years = v;
      i += 1;
    } else if (a === "--multiplier") {
      const v = Number(next);
      if (!Number.isFinite(v) || v <= 0 || !Number.isInteger(v)) {
        throw new Error(`--multiplier must be a positive integer, got ${next}`);
      }
      multiplier = v;
      i += 1;
    } else if (a === "--timespan") {
      if (!isTimespan(next)) throw new Error(`invalid --timespan: ${next} (one of ${TIMESPANS.join(", ")})`);
      timespan = next;
      i += 1;
    } else if (a === "--db") {
      db = next;
      i += 1;
    } else if (a === "--rpm") {
      const v = Number(next);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`--rpm must be positive, got ${next}`);
      rpm = v;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { symbol, years, multiplier, timespan, db, full, rpm };
}

function fmtBar(c: Candle): string {
  return (
    `${new Date(c.openTime).toISOString()}  ` +
    `O=${c.open.toFixed(2)} H=${c.high.toFixed(2)} L=${c.low.toFixed(2)} C=${c.close.toFixed(2)} ` +
    `V=${c.volume.toLocaleString()} n=${c.trades}`
  );
}

async function main(): Promise<void> {
  loadDotEnv();

  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n\n${usage()}\n`);
    process.exit(2);
    return;
  }

  // Polygon.io is now Massive; either key name works (same account/key).
  const apiKey = process.env.MASSIVE_API_KEY ?? process.env.POLYGON_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    process.stderr.write(
      "MASSIVE_API_KEY (or POLYGON_API_KEY) is not set. Add it to .env or export it.\n" +
        "Get a free key at https://massive.com/dashboard/keys\n",
    );
    process.exit(2);
    return;
  }

  const baseInterval = baseIntervalLabel(args.multiplier, args.timespan);
  if (baseInterval === null) {
    process.stderr.write(
      `No Interval label for ${args.multiplier} ${args.timespan} bars; ` +
        `use a standard size (e.g. 5 minute, 1 hour, 1 day).\n`,
    );
    process.exit(2);
    return;
  }

  const store = openStore(args.db);
  try {
    const to = Date.now();
    const fullFrom = to - args.years * 365 * MS_PER_DAY;

    // Incremental: resume from the last stored bar (with a day of overlap so the
    // boundary bar is refreshed), unless --full was passed.
    let from = fullFrom;
    if (!args.full) {
      const last = store.lastOpenTime(args.symbol, baseInterval);
      if (last !== null) {
        from = Math.max(fullFrom, last - MS_PER_DAY);
        process.stderr.write(
          `incremental: ${baseInterval} cache ends ${new Date(last).toISOString()}; ` +
            `fetching from ${new Date(from).toISOString()} (pass --full to refetch all)\n`,
        );
      }
    }

    const baseLabel = `${args.multiplier}${args.timespan}`;
    process.stderr.write(
      `backfill: ${args.symbol} ${baseLabel} ` +
        `${new Date(from).toISOString().slice(0, 10)} → ${new Date(to).toISOString().slice(0, 10)} → ${args.db}\n`,
    );

    const provider = polygonProvider(
      process.env.MASSIVE_BASE_URL !== undefined
        ? { apiKey, baseUrl: process.env.MASSIVE_BASE_URL, requestsPerMinute: args.rpm }
        : { apiKey, requestsPerMinute: args.rpm },
    );

    const base = await provider.fetchBars({
      symbol: args.symbol,
      multiplier: args.multiplier,
      timespan: args.timespan,
      from,
      to,
      onPage: ({ page, received, total, earliestMs, latestMs }) => {
        process.stderr.write(
          `  page ${page}: +${received} bars (total ${total})  ` +
            `${new Date(earliestMs).toISOString()} → ${new Date(latestMs).toISOString()}\n`,
        );
      },
    });

    if (base.length === 0) {
      process.stderr.write("no bars returned; check the symbol, key tier, or date window\n");
      process.exit(1);
      return;
    }

    // Persist the base series.
    const wroteBase = store.upsert(args.symbol, baseInterval, base);
    process.stderr.write(`stored ${wroteBase.toLocaleString()} ${baseInterval} bars\n`);

    // Resample (RTH-only) into the coarser targets — only meaningful from a 5m base.
    if (baseInterval === "5m") {
      // Re-query the full base from the store so resampled series cover all
      // history, not just this incremental slice (which would drop earlier weeks).
      const fullBase = store.query(args.symbol, "5m");
      for (const target of RESAMPLE_TARGETS) {
        const bars = resampleRth(fullBase, target);
        const wrote = store.upsert(args.symbol, target, bars);
        process.stderr.write(`resampled → ${wrote.toLocaleString()} ${target} bars\n`);
      }
    } else {
      process.stderr.write(`(base is ${baseInterval}, not 5m; skipping RTH resample)\n`);
    }

    // Report what the cache now holds.
    process.stdout.write(`\n== cache: ${args.db} ==\n`);
    process.stdout.write("  symbol  interval  bars       from                  to\n");
    for (const s of store.listSeries()) {
      process.stdout.write(
        `  ${s.symbol.padEnd(6)}  ${s.interval.padEnd(8)}  ${String(s.count).padStart(8)}   ` +
          `${new Date(s.firstOpenTime).toISOString().slice(0, 16)}   ` +
          `${new Date(s.lastOpenTime).toISOString().slice(0, 16)}\n`,
      );
    }

    const first = base[0];
    const last = base[base.length - 1];
    if (first !== undefined && last !== undefined) {
      process.stdout.write(`\n  base first: ${fmtBar(first)}\n`);
      process.stdout.write(`  base last:  ${fmtBar(last)}\n`);
    }
  } finally {
    store.close();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
