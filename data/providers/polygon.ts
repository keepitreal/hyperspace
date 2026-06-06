import type { Candle } from "../../src/types.js";
import type { BarsProvider, FetchBarsArgs } from "./types.js";

// Polygon.io rebranded to Massive (2025-10-30). Same API, keys, and data; the
// new base is api.massive.com, with api.polygon.io kept alive in parallel for an
// extended period. Override via MASSIVE_BASE_URL if either host changes.
const DEFAULT_BASE = "https://api.massive.com";
const PAGE_LIMIT = 50_000; // max results per aggregates page
const MAX_ATTEMPTS = 6;
// A 429 is a per-minute quota, not a transient blip; wait out most of a window.
const RATE_LIMIT_WAIT_MS = 15_000;

interface PolygonBar {
  t: number; // window start, ms since epoch (UTC)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n?: number; // number of transactions
  vw?: number; // volume-weighted average price
}

interface PolygonAggsResponse {
  ticker?: string;
  status?: string;
  resultsCount?: number;
  results?: PolygonBar[];
  next_url?: string;
  error?: string;
  message?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function isPolygonBar(x: unknown): x is PolygonBar {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.t === "number" &&
    typeof r.o === "number" &&
    typeof r.h === "number" &&
    typeof r.l === "number" &&
    typeof r.c === "number" &&
    typeof r.v === "number"
  );
}

function timespanMs(multiplier: number, timespan: FetchBarsArgs["timespan"]): number {
  const minute = 60_000;
  const base =
    timespan === "minute"
      ? minute
      : timespan === "hour"
        ? 60 * minute
        : timespan === "day"
          ? 24 * 60 * minute
          : 7 * 24 * 60 * minute; // week
  return base * multiplier;
}

function toCandle(b: PolygonBar, barMs: number): Candle {
  return {
    openTime: b.t,
    closeTime: b.t + barMs,
    open: b.o,
    high: b.h,
    low: b.l,
    close: b.c,
    volume: b.v,
    trades: typeof b.n === "number" ? b.n : 0,
  };
}

/** GET a Polygon URL with bounded retry on 429 / 5xx, returning parsed JSON. */
async function getJson(
  url: string,
  signal: AbortSignal | undefined,
): Promise<PolygonAggsResponse> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, signal !== undefined ? { signal } : {});
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const transient = res.status === 429 || res.status >= 500;
        const err = new Error(
          `Polygon ${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
        );
        if (!transient || attempt === MAX_ATTEMPTS) throw err;
        lastErr = err;
        // 429 = per-minute quota: wait a long, fixed window. 5xx = exp backoff.
        const wait =
          res.status === 429
            ? RATE_LIMIT_WAIT_MS
            : Math.min(16_000, 500 * 2 ** (attempt - 1));
        await sleep(wait);
        continue;
      } else {
        const json: unknown = await res.json();
        if (typeof json !== "object" || json === null) {
          throw new Error(`Polygon returned non-object body: ${JSON.stringify(json).slice(0, 200)}`);
        }
        return json as PolygonAggsResponse;
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      if (attempt === MAX_ATTEMPTS) break;
    }
    const backoff = Math.min(16_000, 500 * 2 ** (attempt - 1));
    await sleep(backoff);
  }
  throw lastErr instanceof Error ? lastErr : new Error("Polygon: unknown error");
}

export interface PolygonProviderOptions {
  apiKey: string;
  /** Adjust for splits/dividends. Default true. */
  adjusted?: boolean;
  /** API base URL. Default https://api.massive.com (formerly api.polygon.io). */
  baseUrl?: string;
  /**
   * Client-side request pacing. The free tier allows 5 req/min, so we space
   * paginated page fetches accordingly to avoid 429s. Default 5; raise on a
   * paid tier for faster backfills.
   */
  requestsPerMinute?: number;
}

/**
 * Polygon.io aggregates provider. Pulls bars from the
 * /v2/aggs/ticker/{symbol}/range/{multiplier}/{timespan}/{from}/{to} endpoint,
 * following next_url pagination until the window is covered, and normalizes to
 * `Candle[]`. Bars are returned ascending by openTime, deduped, and include
 * extended-hours bars as Polygon serves them (the resampler filters to RTH).
 */
export function polygonProvider(opts: PolygonProviderOptions): BarsProvider {
  const adjusted = opts.adjusted ?? true;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const rpm = opts.requestsPerMinute ?? 5;
  const pacingMs = rpm > 0 ? Math.ceil(60_000 / rpm) : 0;
  if (opts.apiKey.length === 0) {
    throw new Error("polygonProvider: apiKey is empty");
  }

  return {
    name: "polygon",
    async fetchBars(args: FetchBarsArgs): Promise<Candle[]> {
      const { symbol, multiplier, timespan, from, to, signal, onPage } = args;
      const barMs = timespanMs(multiplier, timespan);

      const first =
        `${baseUrl}/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
        `/range/${multiplier}/${timespan}/${from}/${to}` +
        `?adjusted=${adjusted}&sort=asc&limit=${PAGE_LIMIT}`;

      const byOpenTime = new Map<number, Candle>();
      let url: string | null = first;
      let page = 0;

      while (url !== null) {
        page += 1;
        // next_url carries every query param except the key; first URL needs it appended too.
        const sep = url.includes("?") ? "&" : "?";
        const json: PolygonAggsResponse = await getJson(
          `${url}${sep}apiKey=${encodeURIComponent(opts.apiKey)}`,
          signal,
        );

        if (json.status === "ERROR") {
          throw new Error(`Polygon error: ${json.error ?? json.message ?? "unknown"}`);
        }

        const rows = json.results ?? [];
        let earliest = Number.POSITIVE_INFINITY;
        let latest = Number.NEGATIVE_INFINITY;
        let added = 0;
        for (const row of rows) {
          if (!isPolygonBar(row)) {
            throw new Error(`Polygon malformed bar: ${JSON.stringify(row).slice(0, 200)}`);
          }
          if (row.t < from || row.t > to) continue;
          if (row.t < earliest) earliest = row.t;
          if (row.t > latest) latest = row.t;
          if (byOpenTime.has(row.t)) continue;
          byOpenTime.set(row.t, toCandle(row, barMs));
          added += 1;
        }

        onPage?.({
          page,
          received: rows.length,
          total: byOpenTime.size,
          earliestMs: earliest === Number.POSITIVE_INFINITY ? from : earliest,
          latestMs: latest === Number.NEGATIVE_INFINITY ? from : latest,
        });

        const nextUrl = json.next_url;
        if (typeof nextUrl !== "string" || nextUrl.length === 0) break;
        if (added === 0) break; // safety: no progress
        url = nextUrl;
        if (pacingMs > 0) await sleep(pacingMs);
      }

      return Array.from(byOpenTime.values()).sort((a, b) => a.openTime - b.openTime);
    },
  };
}
