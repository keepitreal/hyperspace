import { intervalToMs } from "./cli.js";
import type { Candle, Interval } from "./types.js";

const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

interface RawCandle {
  t: number;
  T: number;
  s: string;
  i: string;
  o: string | number;
  c: string | number;
  h: string | number;
  l: string | number;
  v: string | number;
  n: number;
}

function parseNumber(v: unknown, field: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  throw new Error(`Hyperliquid candle: field "${field}" is not a finite number (got ${JSON.stringify(v)})`);
}

function toCandle(raw: RawCandle): Candle {
  return {
    openTime: raw.t,
    closeTime: raw.T,
    open: parseNumber(raw.o, "o"),
    high: parseNumber(raw.h, "h"),
    low: parseNumber(raw.l, "l"),
    close: parseNumber(raw.c, "c"),
    volume: parseNumber(raw.v, "v"),
    trades: raw.n,
  };
}

function isRawCandle(x: unknown): x is RawCandle {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.t === "number" &&
    typeof r.T === "number" &&
    (typeof r.o === "string" || typeof r.o === "number") &&
    (typeof r.h === "string" || typeof r.h === "number") &&
    (typeof r.l === "string" || typeof r.l === "number") &&
    (typeof r.c === "string" || typeof r.c === "number") &&
    (typeof r.v === "string" || typeof r.v === "number") &&
    typeof r.n === "number"
  );
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface FetchCandlesArgs {
  coin: string;
  interval: Interval;
  lookback: number;
  /** override "now" for tests (ms since epoch) */
  now?: number;
  /** AbortSignal to cancel an in-flight request */
  signal?: AbortSignal;
}

export async function fetchCandles(args: FetchCandlesArgs): Promise<Candle[]> {
  const { coin, interval, lookback, signal } = args;
  const now = args.now ?? Date.now();
  const intervalMs = intervalToMs(interval);
  const startTime = now - intervalMs * (lookback + 2);
  const endTime = now;

  const body = {
    type: "candleSnapshot",
    req: { coin, interval, startTime, endTime },
  } as const;

  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(HL_INFO_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const transient = res.status === 429 || res.status >= 500;
        const err = new Error(
          `Hyperliquid /info ${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
        );
        if (!transient || attempt === maxAttempts) throw err;
        lastErr = err;
      } else {
        const json: unknown = await res.json();
        if (!Array.isArray(json)) {
          throw new Error(`Hyperliquid /info returned non-array body: ${JSON.stringify(json).slice(0, 200)}`);
        }
        const candles: Candle[] = [];
        for (const row of json) {
          if (!isRawCandle(row)) {
            throw new Error(`Hyperliquid /info returned malformed candle: ${JSON.stringify(row).slice(0, 200)}`);
          }
          candles.push(toCandle(row));
        }
        candles.sort((a, b) => a.openTime - b.openTime);
        return candles;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      if (attempt === maxAttempts) break;
    }
    const backoff = Math.min(8_000, 250 * 2 ** (attempt - 1));
    await sleep(backoff);
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Hyperliquid /info: unknown error");
}

export interface SplitCandles {
  /** all fully-closed candles */
  closed: Candle[];
  /** the most recent candle, only if it is still in progress (closeTime > now) */
  inProgress: Candle | null;
}

/**
 * Split the response into closed candles and the optional in-progress final candle.
 * Hyperliquid returns the live candle as the last element while it is still forming.
 */
export function splitClosed(candles: Candle[], now: number = Date.now()): SplitCandles {
  if (candles.length === 0) return { closed: [], inProgress: null };
  const last = candles[candles.length - 1];
  if (last !== undefined && last.closeTime > now) {
    return { closed: candles.slice(0, -1), inProgress: last };
  }
  return { closed: candles, inProgress: null };
}
