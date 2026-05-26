import { CliError, CliHelpRequested, intervalToMs, parseArgs, usage } from "./cli.js";
import { ConfigError, loadSymbolsConfig } from "./config.js";
import { fetchCandles, splitClosed } from "./hyperliquid.js";
import { detectLevels } from "./levels.js";
import { formatStatus, makeLogger } from "./log.js";
import { buildNotifier, type Notifier } from "./notify/index.js";
import { JsonStateStore } from "./persist.js";
import { debugFeatures } from "./quality.js";
import { SetupTracker } from "./setups.js";
import type { Candle, Config, SetupState } from "./types.js";

const DEBUG = process.env.HYPERSPACE_DEBUG === "1";

function fmtNum(n: number | null, digits = 2): string {
  return n === null ? "n/a" : n.toFixed(digits);
}

function debugLine(closed: readonly Candle[], tracker: SetupTracker): string | null {
  if (closed.length === 0) return null;
  const last = closed[closed.length - 1]!;
  const history = closed.slice(0, -1);
  const f = debugFeatures(last, history);
  const counts: Record<SetupState, number> = {
    IDLE: 0,
    BROKEN: 0,
    RETESTING: 0,
    CONFIRMED: 0,
    INVALIDATED: 0,
    EXPIRED: 0,
  };
  let primed = 0;
  for (const s of tracker.snapshot()) {
    counts[s.state] += 1;
    if (s.state === "IDLE" && s.primed) primed += 1;
  }
  return (
    `[debug] setups: ${counts.IDLE}I(${primed}p) ${counts.BROKEN}B ${counts.RETESTING}R` +
    `  candle close=${fmtNum(last.close, 2)}` +
    `  vol-ratio=${fmtNum(f.volumeRatio)}  atr=${fmtNum(f.atr)}` +
    `  close-pos=${f.closePos.toFixed(2)}` +
    `  upper-wick=${fmtNum(f.upperWickRatio)}  lower-wick=${fmtNum(f.lowerWickRatio)}` +
    `  time=${f.timeLabel}`
  );
}

const log = makeLogger();

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortError());
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new AbortError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

function isAbort(err: unknown): boolean {
  if (err instanceof AbortError) return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

function lastClose(closed: readonly Candle[], inProgress: Candle | null): number | null {
  if (inProgress !== null) return inProgress.close;
  if (closed.length === 0) return null;
  const last = closed[closed.length - 1];
  return last !== undefined ? last.close : null;
}

async function run(
  config: Config,
  signal: AbortSignal,
  notifier: Notifier,
): Promise<void> {
  const tracker = new SetupTracker({
    breakBps: config.breakBps,
    retestBps: config.retestBps,
    retestBars: config.retestBars,
  });

  const store =
    config.stateFile !== undefined ? new JsonStateStore(config.stateFile, log) : null;
  const intervalMs = intervalToMs(config.interval);

  if (store !== null) {
    const loaded = await store.load({ coin: config.coin, interval: config.interval });
    if (loaded !== null) {
      const ageMs = Date.now() - loaded.savedAt;
      const clampOpenTsTo = Date.now() - intervalMs * config.maxReplayBars;
      const { clamped } = tracker.hydrate(
        { lastProcessedOpenTs: loaded.lastProcessedOpenTs, setups: loaded.setups },
        { clampOpenTsTo },
      );
      const ageMinutes = Math.round(ageMs / 60_000);
      log.info(
        `state: hydrated ${loaded.setups.length} setups from ${config.stateFile} (saved ${ageMinutes}m ago${clamped ? `, clamped to last ${config.maxReplayBars} bars` : ""})`,
      );
    } else {
      log.info(`state: starting fresh (no usable file at ${config.stateFile})`);
    }
  }

  log.info(
    `monitoring ${config.coin} ${config.interval}  lookback=${config.lookback} poll=${config.pollMs}ms`,
  );
  log.info(
    `  pivots=${config.pivotWindow}  cluster=${config.clusterBps}bps  break=${config.breakBps}bps  retest=${config.retestBps}bps  retestBars=${config.retestBars}  maxLevels=${config.maxLevels}`,
  );

  let lastStatusClosedHash = "";
  let consecutiveErrors = 0;
  let lastSavedCursor = tracker.getLastProcessedOpenTs();

  const persistIfChanged = async (): Promise<void> => {
    if (store === null) return;
    const cursor = tracker.getLastProcessedOpenTs();
    if (cursor === lastSavedCursor) return;
    const dumped = tracker.dump();
    await store.save({
      coin: config.coin,
      interval: config.interval,
      lastProcessedOpenTs: dumped.lastProcessedOpenTs,
      setups: dumped.setups,
    });
    lastSavedCursor = cursor;
  };

  while (!signal.aborted) {
    try {
      const candles = await fetchCandles({
        coin: config.coin,
        interval: config.interval,
        lookback: config.lookback,
        signal,
      });
      const { closed, inProgress } = splitClosed(candles);
      const levels = detectLevels(closed, {
        pivotWindow: config.pivotWindow,
        clusterBps: config.clusterBps,
        maxLevels: config.maxLevels,
      });
      tracker.update({
        levels,
        closedCandles: closed,
        inProgress,
        coin: config.coin,
        interval: config.interval,
      });

      for (const alert of tracker.drainAlerts()) {
        await notifier.send(alert);
      }

      await persistIfChanged();

      const lastClosedCandle = closed[closed.length - 1];
      const closedHash = lastClosedCandle !== undefined ? String(lastClosedCandle.openTime) : "";
      const px = lastClose(closed, inProgress);

      if (closedHash !== lastStatusClosedHash && px !== null) {
        log.info(
          formatStatus({
            ts: Date.now(),
            coin: config.coin,
            interval: config.interval,
            price: px,
            levels,
          }),
        );
        if (DEBUG) {
          const dbg = debugLine(closed, tracker);
          if (dbg !== null) log.info(dbg);
        }
        lastStatusClosedHash = closedHash;
      }

      consecutiveErrors = 0;
    } catch (err) {
      if (isAbort(err)) break;
      consecutiveErrors += 1;
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`poll failed (${consecutiveErrors}): ${msg}`);
      const backoff = Math.min(30_000, config.pollMs * Math.min(8, consecutiveErrors));
      try {
        await sleep(backoff, signal);
      } catch (e) {
        if (isAbort(e)) break;
        throw e;
      }
      continue;
    }

    try {
      await sleep(config.pollMs, signal);
    } catch (e) {
      if (isAbort(e)) break;
      throw e;
    }
  }

  if (store !== null) {
    try {
      await persistIfChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`state: final save failed: ${msg}`);
    }
  }
}

async function resolveConfigs(): Promise<Config[]> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.kind === "single") return [parsed.config];
  try {
    const configs = await loadSymbolsConfig(parsed.configPath);
    log.info(`config: loaded ${configs.length} symbols from ${parsed.configPath}`);
    return configs;
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }
}

async function main(): Promise<void> {
  let configs: Config[];
  try {
    configs = await resolveConfigs();
  } catch (e) {
    if (e instanceof CliHelpRequested) {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (e instanceof CliError) {
      process.stderr.write(`${e.message}\n\n${usage()}\n`);
      process.exit(2);
    }
    throw e;
  }

  const notifier = buildNotifier({ log });

  const controller = new AbortController();
  let shuttingDown = false;
  const onSignal = (sig: NodeJS.Signals): void => {
    if (shuttingDown) {
      process.stderr.write(`\nreceived ${sig} again, exiting now\n`);
      process.exit(130);
    }
    shuttingDown = true;
    process.stderr.write(`\nreceived ${sig}, shutting down...\n`);
    controller.abort();
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await Promise.all(configs.map((c) => run(c, controller.signal, notifier)));
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
