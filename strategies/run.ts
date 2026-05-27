import { INTERVALS, type Interval } from "../src/types.js";
import { fetchHistory } from "./lib/fetchHistory.js";
import {
  printAggregateReport,
  printMaeAnalysis,
  printPerSymbolReport,
  printTradeLedger,
} from "./lib/report.js";
import { runBacktest, type Strategy, type Trade } from "./lib/runner.js";
import { vwapRsiMeanReversion } from "./vwapRsiMeanReversion.js";

const STRATEGIES: Record<string, Strategy> = {
  "vwap-rsi-mean-reversion": vwapRsiMeanReversion,
};

interface ParsedArgs {
  coins: string[];
  interval: Interval;
  days: number;
  strategy: string;
  verbose: boolean;
}

function isInterval(s: string): s is Interval {
  return (INTERVALS as readonly string[]).includes(s);
}

function usage(): string {
  return [
    "Usage: tsx strategies/run.ts [--coin <CSV>] [--interval <i>] [--days <n>] [--strategy <name>] [--verbose]",
    "",
    "  --coin       comma-separated symbols (default: ETH,BTC,SOL,HYPE)",
    "  --interval   Hyperliquid interval (default: 5m)",
    "  --days       lookback window in days (default: 90)",
    "  --strategy   strategy name (default: vwap-rsi-mean-reversion)",
    "  --verbose    also print the full trade ledger",
    "",
    `  available strategies: ${Object.keys(STRATEGIES).join(", ")}`,
  ].join("\n");
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let coins: string[] = ["ETH", "BTC", "SOL", "HYPE"];
  let interval: Interval = "5m";
  let days = 90;
  let strategy = "vwap-rsi-mean-reversion";
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (a === "--") continue;
    if (a === "--verbose") {
      verbose = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined) throw new Error(`missing value for ${a}`);
    if (a === "--coin") {
      coins = next.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      i += 1;
    } else if (a === "--interval") {
      if (!isInterval(next)) throw new Error(`invalid --interval: ${next}`);
      interval = next;
      i += 1;
    } else if (a === "--days") {
      const v = Number(next);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`--days must be a positive number, got ${next}`);
      days = v;
      i += 1;
    } else if (a === "--strategy") {
      strategy = next;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }

  if (coins.length === 0) throw new Error("at least one --coin is required");
  return { coins, interval, days, strategy, verbose };
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n\n${usage()}\n`);
    process.exit(2);
  }

  const strategy = STRATEGIES[args.strategy];
  if (strategy === undefined) {
    process.stderr.write(
      `unknown strategy: ${args.strategy}\n  available: ${Object.keys(STRATEGIES).join(", ")}\n`,
    );
    process.exit(2);
  }

  process.stderr.write(
    `backtest: ${strategy.name}  coins=${args.coins.join(",")}  interval=${args.interval}  days=${args.days}\n`,
  );

  const allTrades: Trade[] = [];
  for (const coin of args.coins) {
    process.stderr.write(`\n[${coin}] fetching ${args.days}d of ${args.interval} candles...\n`);
    const candles = await fetchHistory({
      coin,
      interval: args.interval,
      days: args.days,
      onChunk: ({ chunkIndex, received, earliestMs }) => {
        if (received === 0) {
          process.stderr.write(
            `  chunk ${chunkIndex}: API returned 0 bars before ${new Date(earliestMs).toISOString()} — Hyperliquid history exhausted\n`,
          );
        } else {
          process.stderr.write(
            `  chunk ${chunkIndex}: ${received} bars  earliest=${new Date(earliestMs).toISOString()}\n`,
          );
        }
      },
    });
    if (candles.length === 0) {
      process.stderr.write(`  [${coin}] no candles returned; skipping\n`);
      continue;
    }
    const firstC = candles[0];
    const lastC = candles[candles.length - 1];
    if (firstC !== undefined && lastC !== undefined) {
      const coveredDays = (lastC.openTime - firstC.openTime) / 86_400_000;
      const shortfall = args.days - coveredDays;
      process.stderr.write(
        `  [${coin}] fetched ${candles.length} bars: ${new Date(firstC.openTime).toISOString()} → ${new Date(lastC.openTime).toISOString()} (${coveredDays.toFixed(1)} days)\n`,
      );
      if (shortfall > 1) {
        process.stderr.write(
          `  [${coin}] WARNING: requested ${args.days}d but Hyperliquid only served ${coveredDays.toFixed(1)}d. Increase the interval (15m, 1h, 1d) for longer history.\n`,
        );
      }
    }
    const trades = runBacktest({ coin, candles, strategy });
    process.stderr.write(`  [${coin}] produced ${trades.length} trades\n`);
    printPerSymbolReport(coin, trades);
    printMaeAnalysis(coin, trades);
    allTrades.push(...trades);
  }

  if (args.coins.length > 1) {
    printAggregateReport(allTrades);
    printMaeAnalysis("aggregate", allTrades);
  }
  if (args.verbose) printTradeLedger(allTrades);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
