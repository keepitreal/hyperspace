import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { intervalToMs } from "./cli.js";
import { INTERVALS, type Config, type Interval } from "./types.js";

export class ConfigError extends Error {}

const DEFAULTS = {
  lookback: 300,
  pivotWindow: 5,
  clusterBps: 25,
  breakBps: 10,
  retestBps: 15,
  retestBars: 20,
  maxLevels: 8,
  maxReplayBars: 50,
} as const;

interface RawDefaults {
  lookback?: number;
  pollMs?: number;
  pivotWindow?: number;
  clusterBps?: number;
  breakBps?: number;
  retestBps?: number;
  retestBars?: number;
  maxLevels?: number;
  maxReplayBars?: number;
}

interface RawSymbol extends RawDefaults {
  coin?: unknown;
  interval?: unknown;
}

interface RawConfigFile {
  defaults?: RawDefaults;
  stateDir?: string;
  symbols?: RawSymbol[];
}

function isInterval(s: unknown): s is Interval {
  return typeof s === "string" && (INTERVALS as readonly string[]).includes(s);
}

function requirePositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${label} must be a positive integer (got ${JSON.stringify(value)})`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ConfigError(
      `${label} must be a non-negative number (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function pickPositiveInt(
  override: unknown,
  fallback: number,
  label: string,
): number {
  if (override === undefined) return fallback;
  return requirePositiveInt(override, label);
}

function pickNonNegativeNumber(
  override: unknown,
  fallback: number,
  label: string,
): number {
  if (override === undefined) return fallback;
  return requireNonNegativeNumber(override, label);
}

function defaultPollMs(interval: Interval): number {
  return Math.min(60_000, Math.max(1_000, Math.floor(intervalToMs(interval) / 3)));
}

function stateFilePath(stateDir: string, coin: string, interval: Interval): string {
  return join(stateDir, `state-${coin.toLowerCase()}-${interval}.json`);
}

function buildConfig(
  sym: RawSymbol,
  merged: Required<RawDefaults>,
  stateDir: string | undefined,
  idx: number,
): Config {
  if (typeof sym.coin !== "string" || sym.coin.length === 0) {
    throw new ConfigError(`symbols[${idx}].coin must be a non-empty string`);
  }
  if (!isInterval(sym.interval)) {
    throw new ConfigError(
      `symbols[${idx}].interval must be one of: ${INTERVALS.join(", ")} (got ${JSON.stringify(sym.interval)})`,
    );
  }
  const coin = sym.coin;
  const interval: Interval = sym.interval;
  const label = (k: string): string => `symbols[${idx}].${k}`;

  const lookback = pickPositiveInt(sym.lookback, merged.lookback, label("lookback"));
  if (lookback > 5000) {
    throw new ConfigError(`${label("lookback")} must be <= 5000 (Hyperliquid limit)`);
  }
  const pivotWindow = pickPositiveInt(sym.pivotWindow, merged.pivotWindow, label("pivotWindow"));
  if (lookback < pivotWindow * 2 + 5) {
    throw new ConfigError(
      `${label("lookback")} (${lookback}) is too small for pivotWindow (${pivotWindow}); need >= ${pivotWindow * 2 + 5}`,
    );
  }

  const pollMs = pickPositiveInt(sym.pollMs, defaultPollMs(interval), label("pollMs"));

  const config: Config = {
    coin,
    interval,
    lookback,
    pollMs,
    pivotWindow,
    clusterBps: pickNonNegativeNumber(sym.clusterBps, merged.clusterBps, label("clusterBps")),
    breakBps: pickNonNegativeNumber(sym.breakBps, merged.breakBps, label("breakBps")),
    retestBps: pickNonNegativeNumber(sym.retestBps, merged.retestBps, label("retestBps")),
    retestBars: pickPositiveInt(sym.retestBars, merged.retestBars, label("retestBars")),
    maxLevels: pickPositiveInt(sym.maxLevels, merged.maxLevels, label("maxLevels")),
    maxReplayBars: pickPositiveInt(
      sym.maxReplayBars,
      merged.maxReplayBars,
      label("maxReplayBars"),
    ),
  };
  if (stateDir !== undefined) {
    config.stateFile = stateFilePath(stateDir, coin, interval);
  }
  return config;
}

function mergeDefaults(raw: RawDefaults | undefined): Required<RawDefaults> {
  return {
    lookback: pickPositiveInt(raw?.lookback, DEFAULTS.lookback, "defaults.lookback"),
    // pollMs default is interval-dependent, computed per-symbol; placeholder here.
    pollMs: 0,
    pivotWindow: pickPositiveInt(raw?.pivotWindow, DEFAULTS.pivotWindow, "defaults.pivotWindow"),
    clusterBps: pickNonNegativeNumber(raw?.clusterBps, DEFAULTS.clusterBps, "defaults.clusterBps"),
    breakBps: pickNonNegativeNumber(raw?.breakBps, DEFAULTS.breakBps, "defaults.breakBps"),
    retestBps: pickNonNegativeNumber(raw?.retestBps, DEFAULTS.retestBps, "defaults.retestBps"),
    retestBars: pickPositiveInt(raw?.retestBars, DEFAULTS.retestBars, "defaults.retestBars"),
    maxLevels: pickPositiveInt(raw?.maxLevels, DEFAULTS.maxLevels, "defaults.maxLevels"),
    maxReplayBars: pickPositiveInt(
      raw?.maxReplayBars,
      DEFAULTS.maxReplayBars,
      "defaults.maxReplayBars",
    ),
  };
}

export async function loadSymbolsConfig(path: string): Promise<Config[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ConfigError(`Cannot read config file at ${path}: ${msg}`);
  }

  let parsed: RawConfigFile;
  try {
    parsed = JSON.parse(raw) as RawConfigFile;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ConfigError(`Config file at ${path} is not valid JSON: ${msg}`);
  }

  if (!Array.isArray(parsed.symbols) || parsed.symbols.length === 0) {
    throw new ConfigError(`Config file at ${path} must have a non-empty "symbols" array`);
  }

  const merged = mergeDefaults(parsed.defaults);
  const stateDir =
    typeof parsed.stateDir === "string" && parsed.stateDir.length > 0
      ? parsed.stateDir
      : undefined;

  const configs: Config[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < parsed.symbols.length; i++) {
    const sym = parsed.symbols[i]!;
    const config = buildConfig(sym, merged, stateDir, i);
    const key = `${config.coin}:${config.interval}`;
    if (seen.has(key)) {
      throw new ConfigError(`Duplicate symbol ${key} in config (entries cannot repeat)`);
    }
    seen.add(key);
    configs.push(config);
  }
  return configs;
}
