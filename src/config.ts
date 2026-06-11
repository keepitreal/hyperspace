import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { intervalToMs } from "./cli.js";
import { scanMarketsByOpenInterest } from "./marketScan.js";
import { ALL_ALERT_KINDS, INTERVALS, type AlertKind, type Config, type Interval } from "./types.js";

export class ConfigError extends Error {}

export interface ConfigLoadLogger {
  info(msg: string): void;
}

const DEFAULTS = {
  lookback: 300,
  pivotWindow: 5,
  clusterBps: 25,
  breakBps: 10,
  retestBps: 15,
  retestBars: 20,
  maxLevels: 8,
  maxReplayBars: 50,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  volatilityThresholdPct: 1.0,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  macdSeparationPct: 0.0003,
  macdDebounceBars: 10,
  macdRequireZeroLineSide: true,
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
  rsiPeriod?: number;
  rsiOverbought?: number;
  rsiOversold?: number;
  volatilityThresholdPct?: number;
  macdFast?: number;
  macdSlow?: number;
  macdSignal?: number;
  macdSeparationPct?: number;
  macdDebounceBars?: number;
  macdRequireZeroLineSide?: boolean;
}

interface RawSymbol extends RawDefaults {
  coin?: unknown;
  interval?: unknown;
  alerts?: unknown;
}

/** Dynamic "scan all qualifying markets" mode (an alternative to `symbols`). */
interface RawScan extends RawDefaults {
  minOpenInterestUsd?: unknown;
  /** Single timeframe; superseded by `intervals` when that is present. */
  interval?: unknown;
  /** One or more timeframes; each qualifying coin is monitored on every one. */
  intervals?: unknown;
  alerts?: unknown;
}

interface RawConfigFile {
  defaults?: RawDefaults;
  stateDir?: string;
  symbols?: RawSymbol[];
  scan?: RawScan;
}

function isInterval(s: unknown): s is Interval {
  return typeof s === "string" && (INTERVALS as readonly string[]).includes(s);
}

function isAlertKind(s: unknown): s is AlertKind {
  return typeof s === "string" && (ALL_ALERT_KINDS as readonly string[]).includes(s);
}

function pickAlertKinds(
  override: unknown,
  label: string,
): readonly AlertKind[] | undefined {
  if (override === undefined) return undefined;
  if (!Array.isArray(override)) {
    throw new ConfigError(`${label} must be an array of alert kinds`);
  }
  const out: AlertKind[] = [];
  for (let i = 0; i < override.length; i++) {
    const k = override[i];
    if (!isAlertKind(k)) {
      throw new ConfigError(
        `${label}[${i}] is not a valid alert kind (got ${JSON.stringify(k)}); must be one of ${ALL_ALERT_KINDS.join(", ")}`,
      );
    }
    out.push(k);
  }
  return out;
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

function pickNonNegativeInt(
  override: unknown,
  fallback: number,
  label: string,
): number {
  if (override === undefined) return fallback;
  if (typeof override !== "number" || !Number.isInteger(override) || override < 0) {
    throw new ConfigError(`${label} must be a non-negative integer (got ${JSON.stringify(override)})`);
  }
  return override;
}

function pickBoolean(override: unknown, fallback: boolean, label: string): boolean {
  if (override === undefined) return fallback;
  if (typeof override !== "boolean") {
    throw new ConfigError(`${label} must be a boolean (got ${JSON.stringify(override)})`);
  }
  return override;
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

  const pollMsFallback = merged.pollMs > 0 ? merged.pollMs : defaultPollMs(interval);
  const pollMs = pickPositiveInt(sym.pollMs, pollMsFallback, label("pollMs"));

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
    rsiPeriod: pickPositiveInt(sym.rsiPeriod, merged.rsiPeriod, label("rsiPeriod")),
    rsiOverbought: pickNonNegativeNumber(
      sym.rsiOverbought,
      merged.rsiOverbought,
      label("rsiOverbought"),
    ),
    rsiOversold: pickNonNegativeNumber(
      sym.rsiOversold,
      merged.rsiOversold,
      label("rsiOversold"),
    ),
    volatilityThresholdPct: pickNonNegativeNumber(
      sym.volatilityThresholdPct,
      merged.volatilityThresholdPct,
      label("volatilityThresholdPct"),
    ),
    macdFast: pickPositiveInt(sym.macdFast, merged.macdFast, label("macdFast")),
    macdSlow: pickPositiveInt(sym.macdSlow, merged.macdSlow, label("macdSlow")),
    macdSignal: pickPositiveInt(sym.macdSignal, merged.macdSignal, label("macdSignal")),
    macdSeparationPct: pickNonNegativeNumber(
      sym.macdSeparationPct,
      merged.macdSeparationPct,
      label("macdSeparationPct"),
    ),
    macdDebounceBars: pickNonNegativeInt(
      sym.macdDebounceBars,
      merged.macdDebounceBars,
      label("macdDebounceBars"),
    ),
    macdRequireZeroLineSide: pickBoolean(
      sym.macdRequireZeroLineSide,
      merged.macdRequireZeroLineSide,
      label("macdRequireZeroLineSide"),
    ),
  };
  if (config.macdFast >= config.macdSlow) {
    throw new ConfigError(
      `${label("macdFast")} (${config.macdFast}) must be less than ${label("macdSlow")} (${config.macdSlow})`,
    );
  }
  if (config.rsiOversold >= config.rsiOverbought) {
    throw new ConfigError(
      `${label("rsiOversold")} (${config.rsiOversold}) must be less than ${label("rsiOverbought")} (${config.rsiOverbought})`,
    );
  }
  if (config.volatilityThresholdPct <= 0) {
    throw new ConfigError(
      `${label("volatilityThresholdPct")} must be > 0 (got ${config.volatilityThresholdPct})`,
    );
  }
  const alerts = pickAlertKinds(sym.alerts, label("alerts"));
  if (alerts !== undefined) {
    if (alerts.length === 0) {
      throw new ConfigError(`${label("alerts")} must contain at least one kind when present`);
    }
    config.alerts = alerts;
  }
  if (stateDir !== undefined) {
    config.stateFile = stateFilePath(stateDir, coin, interval);
  }
  return config;
}

function mergeDefaults(raw: RawDefaults | undefined): Required<RawDefaults> {
  return {
    lookback: pickPositiveInt(raw?.lookback, DEFAULTS.lookback, "defaults.lookback"),
    // 0 = no global override; per-symbol pollMs or interval-derived default applies.
    pollMs:
      raw?.pollMs !== undefined ? requirePositiveInt(raw.pollMs, "defaults.pollMs") : 0,
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
    rsiPeriod: pickPositiveInt(raw?.rsiPeriod, DEFAULTS.rsiPeriod, "defaults.rsiPeriod"),
    rsiOverbought: pickNonNegativeNumber(
      raw?.rsiOverbought,
      DEFAULTS.rsiOverbought,
      "defaults.rsiOverbought",
    ),
    rsiOversold: pickNonNegativeNumber(
      raw?.rsiOversold,
      DEFAULTS.rsiOversold,
      "defaults.rsiOversold",
    ),
    volatilityThresholdPct: pickNonNegativeNumber(
      raw?.volatilityThresholdPct,
      DEFAULTS.volatilityThresholdPct,
      "defaults.volatilityThresholdPct",
    ),
    macdFast: pickPositiveInt(raw?.macdFast, DEFAULTS.macdFast, "defaults.macdFast"),
    macdSlow: pickPositiveInt(raw?.macdSlow, DEFAULTS.macdSlow, "defaults.macdSlow"),
    macdSignal: pickPositiveInt(raw?.macdSignal, DEFAULTS.macdSignal, "defaults.macdSignal"),
    macdSeparationPct: pickNonNegativeNumber(
      raw?.macdSeparationPct,
      DEFAULTS.macdSeparationPct,
      "defaults.macdSeparationPct",
    ),
    macdDebounceBars: pickNonNegativeInt(
      raw?.macdDebounceBars,
      DEFAULTS.macdDebounceBars,
      "defaults.macdDebounceBars",
    ),
    macdRequireZeroLineSide: pickBoolean(
      raw?.macdRequireZeroLineSide,
      DEFAULTS.macdRequireZeroLineSide,
      "defaults.macdRequireZeroLineSide",
    ),
  };
}

/**
 * Resolve the timeframe(s) a scan should monitor: `intervals` (a non-empty array
 * of valid intervals) takes precedence; otherwise the single `interval`.
 */
export function resolveScanIntervals(scan: {
  interval?: unknown;
  intervals?: unknown;
}): Interval[] {
  if (scan.intervals !== undefined) {
    if (!Array.isArray(scan.intervals) || scan.intervals.length === 0) {
      throw new ConfigError("scan.intervals must be a non-empty array of intervals");
    }
    const out: Interval[] = [];
    for (let i = 0; i < scan.intervals.length; i++) {
      const v = scan.intervals[i];
      if (!isInterval(v)) {
        throw new ConfigError(
          `scan.intervals[${i}] must be one of: ${INTERVALS.join(", ")} (got ${JSON.stringify(v)})`,
        );
      }
      out.push(v);
    }
    return out;
  }
  if (!isInterval(scan.interval)) {
    throw new ConfigError(
      `scan.interval must be one of: ${INTERVALS.join(", ")} (got ${JSON.stringify(scan.interval)})`,
    );
  }
  return [scan.interval];
}

async function buildScanConfigs(
  scan: RawScan,
  merged: Required<RawDefaults>,
  stateDir: string | undefined,
  log: ConfigLoadLogger,
): Promise<Config[]> {
  const intervals = resolveScanIntervals(scan);
  const minOi = requireNonNegativeNumber(scan.minOpenInterestUsd, "scan.minOpenInterestUsd");
  // Validate the alert allowlist up front; default to MACD-only when omitted.
  const alerts = pickAlertKinds(scan.alerts, "scan.alerts") ?? ["MACD_CROSSOVER"];

  log.info(`scan: querying Hyperliquid open interest (>= $${minOi.toLocaleString()})...`);
  const coins = await scanMarketsByOpenInterest(minOi);
  log.info(`scan: ${coins.length} markets qualified on ${intervals.join(", ")}`);
  if (coins.length === 0) {
    throw new ConfigError(
      `scan: no markets met the $${minOi.toLocaleString()} open-interest threshold`,
    );
  }

  const configs: Config[] = [];
  let idx = 0;
  for (const coin of coins) {
    for (const interval of intervals) {
      // Reuse the per-symbol builder so all validation/defaults apply uniformly.
      // Spread the scan-level tunables (lookback, pollMs, macd*, …) and override
      // the per-coin identity + alert allowlist.
      const sym = {
        ...scan,
        coin,
        interval,
        alerts,
      } as RawSymbol;
      configs.push(buildConfig(sym, merged, stateDir, idx));
      idx += 1;
    }
  }
  return configs;
}

export async function loadSymbolsConfig(
  path: string,
  log: ConfigLoadLogger = { info: () => {} },
): Promise<Config[]> {
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

  const merged = mergeDefaults(parsed.defaults);
  const stateDir =
    typeof parsed.stateDir === "string" && parsed.stateDir.length > 0
      ? parsed.stateDir
      : undefined;

  // Dynamic scan mode takes precedence over an explicit symbols list.
  if (parsed.scan !== undefined) {
    return buildScanConfigs(parsed.scan, merged, stateDir, log);
  }

  if (!Array.isArray(parsed.symbols) || parsed.symbols.length === 0) {
    throw new ConfigError(
      `Config file at ${path} must have a non-empty "symbols" array or a "scan" block`,
    );
  }

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
