import { bollinger } from "../analyst/indicators/bollinger.js";
import {
  BOLLINGER_DEFAULTS,
  makeBollingerMeanReversion,
} from "../strategies/bollingerMeanReversion.js";
import type { Strategy } from "../strategies/lib/runner.js";
import { vwapRsiMeanReversion } from "../strategies/vwapRsiMeanReversion.js";
import type { Candle } from "../src/types.js";

export type ParamType = "int" | "number" | "bool";

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

export interface LinePoint {
  time: number; // ms since epoch
  value: number;
}

export interface Overlay {
  id: string;
  label: string;
  color: string;
  data: LinePoint[];
}

export interface StrategyDef {
  name: string;
  label: string;
  params: ParamSpec[];
  build(raw: Record<string, unknown>): Strategy;
  /** Indicator line series to draw on the price pane for the given params. */
  overlays(candles: readonly Candle[], raw: Record<string, unknown>): Overlay[];
}

function num(raw: Record<string, unknown>, key: string, def: number): number {
  const v = Number(raw[key]);
  return Number.isFinite(v) ? v : def;
}

function bool(raw: Record<string, unknown>, key: string, def: boolean): boolean {
  const v = raw[key];
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return def;
}

function bollingerParams(raw: Record<string, unknown>): typeof BOLLINGER_DEFAULTS {
  return {
    period: Math.max(2, Math.round(num(raw, "period", BOLLINGER_DEFAULTS.period))),
    k: Math.max(0.1, num(raw, "k", BOLLINGER_DEFAULTS.k)),
    rsiPeriod: Math.max(2, Math.round(num(raw, "rsiPeriod", BOLLINGER_DEFAULTS.rsiPeriod))),
    rsiLong: num(raw, "rsiLong", BOLLINGER_DEFAULTS.rsiLong),
    rsiShort: num(raw, "rsiShort", BOLLINGER_DEFAULTS.rsiShort),
    maxBars: Math.max(1, Math.round(num(raw, "maxBars", BOLLINGER_DEFAULTS.maxBars))),
    allowShort: bool(raw, "allowShort", BOLLINGER_DEFAULTS.allowShort),
  };
}

const bollingerDef: StrategyDef = {
  name: "bollinger-mean-reversion",
  label: "Bollinger + RSI Mean Reversion",
  params: [
    { key: "period", label: "BB period", type: "int", default: BOLLINGER_DEFAULTS.period, min: 2, max: 200, step: 1 },
    { key: "k", label: "BB stddev (k)", type: "number", default: BOLLINGER_DEFAULTS.k, min: 0.5, max: 4, step: 0.1 },
    { key: "rsiPeriod", label: "RSI period", type: "int", default: BOLLINGER_DEFAULTS.rsiPeriod, min: 2, max: 100, step: 1 },
    { key: "rsiLong", label: "RSI long entry ≤", type: "number", default: BOLLINGER_DEFAULTS.rsiLong, min: 1, max: 50, step: 1 },
    { key: "rsiShort", label: "RSI short entry ≥", type: "number", default: BOLLINGER_DEFAULTS.rsiShort, min: 50, max: 99, step: 1 },
    { key: "maxBars", label: "Max bars held", type: "int", default: BOLLINGER_DEFAULTS.maxBars, min: 1, max: 500, step: 1 },
    { key: "allowShort", label: "Allow shorts", type: "bool", default: BOLLINGER_DEFAULTS.allowShort },
  ],
  build: (raw) => makeBollingerMeanReversion(bollingerParams(raw)),
  overlays: (candles, raw) => {
    const { period, k } = bollingerParams(raw);
    const closes = candles.map((c) => c.close);
    const upper: LinePoint[] = [];
    const mid: LinePoint[] = [];
    const lower: LinePoint[] = [];
    for (let i = period - 1; i < candles.length; i++) {
      const bb = bollinger(closes.slice(0, i + 1), period, k);
      const t = candles[i]?.openTime;
      if (bb === null || t === undefined) continue;
      upper.push({ time: t, value: bb.upper });
      mid.push({ time: t, value: bb.mid });
      lower.push({ time: t, value: bb.lower });
    }
    return [
      { id: "bb-upper", label: `BB upper (${period},${k})`, color: "#9ca3af", data: upper },
      { id: "bb-mid", label: `BB mid (SMA ${period})`, color: "#f59e0b", data: mid },
      { id: "bb-lower", label: `BB lower (${period},${k})`, color: "#9ca3af", data: lower },
    ];
  },
};

const vwapRsiDef: StrategyDef = {
  name: "vwap-rsi-mean-reversion",
  label: "VWAP + RSI Mean Reversion (fixed)",
  params: [],
  build: () => vwapRsiMeanReversion,
  overlays: () => [],
};

export const STRATEGIES: readonly StrategyDef[] = [bollingerDef, vwapRsiDef];

export function getStrategy(name: string): StrategyDef | undefined {
  return STRATEGIES.find((s) => s.name === name);
}
