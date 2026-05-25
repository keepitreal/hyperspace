import { INTERVALS, type Config, type Interval } from "./types.js";

export class CliError extends Error {}
export class CliHelpRequested extends Error {
  constructor() {
    super("help requested");
    this.name = "CliHelpRequested";
  }
}

export function intervalToMs(interval: Interval): number {
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const map: Record<Interval, number> = {
    "1m": 1 * minute,
    "3m": 3 * minute,
    "5m": 5 * minute,
    "15m": 15 * minute,
    "30m": 30 * minute,
    "1h": 1 * hour,
    "2h": 2 * hour,
    "4h": 4 * hour,
    "8h": 8 * hour,
    "12h": 12 * hour,
    "1d": 1 * day,
    "3d": 3 * day,
    "1w": 7 * day,
    "1M": 30 * day,
  };
  return map[interval];
}

interface RawArgs {
  [key: string]: string | true;
}

function tokenize(argv: readonly string[]): RawArgs {
  const out: RawArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    if (!tok.startsWith("--")) {
      throw new CliError(`Unexpected positional argument: ${tok}`);
    }
    const eq = tok.indexOf("=");
    if (eq !== -1) {
      const key = tok.slice(2, eq);
      const value = tok.slice(eq + 1);
      out[key] = value;
      continue;
    }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function requireString(args: RawArgs, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new CliError(`Missing required flag --${key}`);
  }
  return v;
}

function optionalString(args: RawArgs, key: string): string | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    throw new CliError(`Flag --${key} requires a value`);
  }
  return v;
}

function parsePositiveInt(raw: string, key: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new CliError(`Flag --${key} must be a positive integer (got "${raw}")`);
  }
  return n;
}

function parseNonNegativeNumber(raw: string, key: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new CliError(`Flag --${key} must be a non-negative number (got "${raw}")`);
  }
  return n;
}

function isInterval(s: string): s is Interval {
  return (INTERVALS as readonly string[]).includes(s);
}

const KNOWN_FLAGS = new Set([
  "coin",
  "interval",
  "lookback",
  "poll-ms",
  "pivot-window",
  "cluster-bps",
  "break-bps",
  "retest-bps",
  "retest-bars",
  "max-levels",
  "state-file",
  "max-replay-bars",
  "help",
  "h",
]);

export function parseArgs(argv: readonly string[]): Config {
  const args = tokenize(argv);

  for (const k of Object.keys(args)) {
    if (!KNOWN_FLAGS.has(k)) {
      throw new CliError(`Unknown flag --${k}`);
    }
  }

  if (args.help === true || args.h === true) {
    throw new CliHelpRequested();
  }

  const coin = requireString(args, "coin");

  const intervalRaw = optionalString(args, "interval") ?? "15m";
  if (!isInterval(intervalRaw)) {
    throw new CliError(
      `Invalid --interval "${intervalRaw}". Must be one of: ${INTERVALS.join(", ")}`,
    );
  }
  const interval: Interval = intervalRaw;

  const lookback = parsePositiveInt(optionalString(args, "lookback") ?? "300", "lookback");
  if (lookback > 5000) {
    throw new CliError("Hyperliquid serves at most 5000 candles per request; pick --lookback <= 5000");
  }

  const intervalMs = intervalToMs(interval);
  const defaultPollMs = Math.min(60_000, Math.max(1_000, Math.floor(intervalMs / 3)));
  const pollMsRaw = optionalString(args, "poll-ms");
  const pollMs = pollMsRaw === undefined ? defaultPollMs : parsePositiveInt(pollMsRaw, "poll-ms");

  const pivotWindow = parsePositiveInt(
    optionalString(args, "pivot-window") ?? "5",
    "pivot-window",
  );
  const clusterBps = parseNonNegativeNumber(
    optionalString(args, "cluster-bps") ?? "25",
    "cluster-bps",
  );
  const breakBps = parseNonNegativeNumber(
    optionalString(args, "break-bps") ?? "10",
    "break-bps",
  );
  const retestBps = parseNonNegativeNumber(
    optionalString(args, "retest-bps") ?? "15",
    "retest-bps",
  );
  const retestBars = parsePositiveInt(
    optionalString(args, "retest-bars") ?? "20",
    "retest-bars",
  );
  const maxLevels = parsePositiveInt(
    optionalString(args, "max-levels") ?? "8",
    "max-levels",
  );
  const maxReplayBars = parsePositiveInt(
    optionalString(args, "max-replay-bars") ?? "50",
    "max-replay-bars",
  );

  const stateFile = optionalString(args, "state-file");
  if (stateFile !== undefined && stateFile.length === 0) {
    throw new CliError("--state-file requires a non-empty path");
  }

  if (lookback < pivotWindow * 2 + 5) {
    throw new CliError(
      `--lookback (${lookback}) is too small for --pivot-window (${pivotWindow}); need at least ${pivotWindow * 2 + 5}`,
    );
  }

  const config: Config = {
    coin,
    interval,
    lookback,
    pollMs,
    pivotWindow,
    clusterBps,
    breakBps,
    retestBps,
    retestBars,
    maxLevels,
    maxReplayBars,
  };
  if (stateFile !== undefined) config.stateFile = stateFile;
  return config;
}

export function usage(): string {
  return [
    "Usage: pnpm start --coin <SYMBOL> [--interval 15m] [--lookback 300] [options]",
    "",
    "Required:",
    "  --coin <SYMBOL>          Hyperliquid coin (e.g. BTC, ETH, SOL)",
    "",
    "Common:",
    `  --interval <i>           One of ${INTERVALS.join(", ")} (default 15m)`,
    "  --lookback <n>           Candles to keep in window (default 300, max 5000)",
    "  --poll-ms <ms>           Refresh cadence (default intervalMs/3, capped 60s)",
    "",
    "Detection tuning:",
    "  --pivot-window <n>       Bars on each side for swing pivots (default 5)",
    "  --cluster-bps <bps>      Cluster nearby pivots within X bps (default 25)",
    "  --break-bps <bps>        Close-buffer past level to trigger breakout (default 10)",
    "  --retest-bps <bps>       Tolerance for price returning to level (default 15)",
    "  --retest-bars <n>        Bars after breakout before setup expires (default 20)",
    "  --max-levels <n>         Top-K levels per side (default 8)",
    "",
    "Persistence:",
    "  --state-file <path>      Persist tracker state to this JSON file (default off)",
    "  --max-replay-bars <n>    Skip ahead if persisted cursor is older than N bars (default 50)",
  ].join("\n");
}
