import { fetchCandles } from "../../src/hyperliquid.js";
import type { Candle, Interval } from "../../src/types.js";

const MS_PER_DAY = 86_400_000;
const CHUNK_BARS = 5000;
const POLITE_DELAY_MS = 150;

export interface FetchHistoryArgs {
  coin: string;
  interval: Interval;
  days: number;
  signal?: AbortSignal;
  /** Override Date.now() for tests. */
  now?: number;
  /** Optional callback per chunk for progress logging. */
  onChunk?: (info: { chunkIndex: number; received: number; earliestMs: number; cursorMs: number }) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch `days` worth of candles for a coin/interval, paginating around
 * Hyperliquid's 5000-bars-per-call cap. Walks backwards from `now` in chunks,
 * dedups by openTime, and returns ascending by openTime trimmed to the
 * [startTime, endTime] window.
 */
export async function fetchHistory(args: FetchHistoryArgs): Promise<Candle[]> {
  const { coin, interval, days, signal, onChunk } = args;
  const endTime = args.now ?? Date.now();
  const startTime = endTime - days * MS_PER_DAY;

  const byOpenTime = new Map<number, Candle>();
  let cursor = endTime;
  let chunkIndex = 0;
  let lastEarliest = Number.POSITIVE_INFINITY;

  while (cursor > startTime) {
    chunkIndex += 1;
    const chunk = await fetchCandles(
      signal !== undefined
        ? { coin, interval, lookback: CHUNK_BARS, now: cursor, signal }
        : { coin, interval, lookback: CHUNK_BARS, now: cursor },
    );
    if (chunk.length === 0) {
      onChunk?.({ chunkIndex, received: 0, earliestMs: cursor, cursorMs: cursor });
      break;
    }

    let earliest = Number.POSITIVE_INFINITY;
    let added = 0;
    for (const c of chunk) {
      if (c.openTime < earliest) earliest = c.openTime;
      if (c.openTime < startTime || c.openTime > endTime) continue;
      if (byOpenTime.has(c.openTime)) continue;
      byOpenTime.set(c.openTime, c);
      added += 1;
    }

    onChunk?.({ chunkIndex, received: chunk.length, earliestMs: earliest, cursorMs: cursor });

    if (added === 0) break;
    if (earliest <= startTime) break;
    if (earliest >= lastEarliest) break;
    lastEarliest = earliest;

    cursor = earliest - 1;
    await sleep(POLITE_DELAY_MS);
  }

  return Array.from(byOpenTime.values()).sort((a, b) => a.openTime - b.openTime);
}
