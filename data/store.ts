import Database from "better-sqlite3";
import type { Candle, Interval } from "../src/types.js";

/**
 * Local candle cache backed by SQLite (better-sqlite3, synchronous).
 *
 * One table keyed (symbol, interval, openTime) so writes are idempotent: a
 * re-run of the backfill overwrites in place rather than duplicating. Reads are
 * range-scanned on the primary key, which is fast enough that backtests don't
 * need any in-memory caching layer on top.
 */

interface CandleRow {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

export interface SeriesInfo {
  symbol: string;
  interval: string;
  count: number;
  firstOpenTime: number;
  lastOpenTime: number;
}

export interface CandleStore {
  /** Insert or replace a batch of candles for one (symbol, interval). Returns count written. */
  upsert(symbol: string, interval: Interval, candles: readonly Candle[]): number;
  /** Range query [from, to] (inclusive, ms). Omit bounds for the full series. Ascending. */
  query(symbol: string, interval: Interval, from?: number, to?: number): Candle[];
  /** Latest openTime stored for a series, or null if empty. Used for incremental fetch. */
  lastOpenTime(symbol: string, interval: Interval): number | null;
  /** One row per (symbol, interval) with counts + coverage. */
  listSeries(): SeriesInfo[];
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS candles (
  symbol    TEXT    NOT NULL,
  interval  TEXT    NOT NULL,
  openTime  INTEGER NOT NULL,
  closeTime INTEGER NOT NULL,
  open      REAL    NOT NULL,
  high      REAL    NOT NULL,
  low       REAL    NOT NULL,
  close     REAL    NOT NULL,
  volume    REAL    NOT NULL,
  trades    INTEGER NOT NULL,
  PRIMARY KEY (symbol, interval, openTime)
) WITHOUT ROWID;
`;

export function openStore(path = "data/market.db"): CandleStore {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO candles
       (symbol, interval, openTime, closeTime, open, high, low, close, volume, trades)
     VALUES (@symbol, @interval, @openTime, @closeTime, @open, @high, @low, @close, @volume, @trades)`,
  );

  const upsertMany = db.transaction(
    (symbol: string, interval: string, candles: readonly Candle[]): number => {
      for (const c of candles) {
        insertStmt.run({ symbol, interval, ...c });
      }
      return candles.length;
    },
  );

  return {
    upsert(symbol, interval, candles) {
      if (candles.length === 0) return 0;
      return upsertMany(symbol, interval, candles);
    },

    query(symbol, interval, from, to) {
      const lo = from ?? Number.MIN_SAFE_INTEGER;
      const hi = to ?? Number.MAX_SAFE_INTEGER;
      const rows = db
        .prepare(
          `SELECT openTime, closeTime, open, high, low, close, volume, trades
             FROM candles
            WHERE symbol = ? AND interval = ? AND openTime BETWEEN ? AND ?
            ORDER BY openTime ASC`,
        )
        .all(symbol, interval, lo, hi) as CandleRow[];
      return rows;
    },

    lastOpenTime(symbol, interval) {
      const row = db
        .prepare(
          `SELECT MAX(openTime) AS m FROM candles WHERE symbol = ? AND interval = ?`,
        )
        .get(symbol, interval) as { m: number | null } | undefined;
      return row?.m ?? null;
    },

    listSeries() {
      const rows = db
        .prepare(
          `SELECT symbol, interval,
                  COUNT(*)      AS count,
                  MIN(openTime) AS firstOpenTime,
                  MAX(openTime) AS lastOpenTime
             FROM candles
            GROUP BY symbol, interval
            ORDER BY symbol, interval`,
        )
        .all() as SeriesInfo[];
      return rows;
    },

    close() {
      db.close();
    },
  };
}
