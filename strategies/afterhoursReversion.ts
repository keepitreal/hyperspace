import { INTERVALS, type Interval } from "../src/types.js";
import type { Candle } from "../src/types.js";
import { fetchHistory } from "./lib/fetchHistory.js";

/**
 * After-hours reversion test for an equity-tracking perp (e.g. xyz:SP500).
 *
 * Hypothesis: price moves during the US after-hours window but returns to the
 * prior cash-session close before the next open — i.e. the overnight *gap*
 * (close -> next open) is small even when the intra-night *excursion* (how far
 * price travelled from the close) is large.
 *
 * The perp trades 24/7, so "close" and "open" are defined against the US cash
 * session in America/New_York: 16:00 close, 09:30 open. We read the perp's
 * price at those wall-clock moments. DST is handled via Intl; full NYSE
 * holidays (perp still trades, but there is no cash session) are skipped and
 * early-close half-days use a 13:00 close — neither is inferable from price
 * alone, so they live in the calendar tables below. Extend for future years.
 */

// Full-day NYSE closures: no cash session, so no observation anchored here.
const HOLIDAYS = new Set<string>([
  "2026-01-01", // New Year's Day
  "2026-01-19", // MLK Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-07-03", // Independence Day (observed; Jul 4 is a Saturday)
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving
  "2026-12-25", // Christmas
]);

// Early closes: cash session ends 13:00 ET instead of 16:00 ET.
const HALF_DAYS = new Set<string>([
  "2026-11-27", // day after Thanksgiving
  "2026-12-24", // Christmas Eve
]);

const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const REGULAR_CLOSE_MIN = 16 * 60; // 16:00 ET
const HALF_DAY_CLOSE_MIN = 13 * 60; // 13:00 ET

const INTERVAL_MIN: Record<Interval, number> = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "2h": 120,
  "4h": 240,
  "8h": 480,
  "12h": 720,
  "1d": 1440,
  "3d": 4320,
  "1w": 10080,
  "1M": 43200,
};

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Map a UTC ms timestamp to its ET calendar date and minutes-since-ET-midnight. */
function etParts(ms: number): { date: string; minOfDay: number } {
  const parts = ET_FMT.formatToParts(ms);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  let hh = get("hour");
  if (hh === "24") hh = "00"; // Node's hour12:false emits "24" at midnight
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const minOfDay = Number(hh) * 60 + Number(get("minute"));
  return { date, minOfDay };
}

/** Day of week (0=Sun..6=Sat) for an ET calendar date string. */
function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

interface Annotated {
  c: Candle;
  date: string;
  minOfDay: number;
}

/** Pick the candle whose close lands at `closeMin` (open at closeMin - interval). */
function pickCloseCandle(cands: readonly Annotated[], closeMin: number, intervalMin: number): Candle | null {
  const targetOpen = closeMin - intervalMin;
  let best: Annotated | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const a of cands) {
    const d = Math.abs(a.minOfDay - targetOpen);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best !== null && bestDist <= intervalMin ? best.c : null;
}

/** Pick the candle whose open lands at `openMin` (09:30). */
function pickOpenCandle(cands: readonly Annotated[], openMin: number, intervalMin: number): Candle | null {
  let best: Annotated | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const a of cands) {
    const d = Math.abs(a.minOfDay - openMin);
    if (d < bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best !== null && bestDist <= intervalMin ? best.c : null;
}

interface Observation {
  fromDate: string;
  toDate: string;
  close: number;
  open: number;
  ahHigh: number | null;
  ahLow: number | null;
  ahBars: number;
  /** signed (open - close) / close */
  gap: number;
  /** max(|ahHigh - close|, |close - ahLow|) / close; null when no AH bars */
  excursion: number | null;
  /** 1 - |gap| / excursion; 1 = full reversion, 0 = move persisted; null when excursion is 0/undefined */
  reversion: number | null;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid] ?? NaN;
  return ((s[mid - 1] ?? NaN) + (s[mid] ?? NaN)) / 2;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  const kk = Math.min(k, n - k);
  let r = 1;
  for (let i = 0; i < kk; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/** Two-sided exact binomial sign test against p=0.5. */
function signTestP(up: number, down: number): number {
  const n = up + down;
  if (n === 0) return NaN;
  const k = Math.min(up, down);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += comb(n, i);
  return Math.min(1, 2 * tail * Math.pow(0.5, n));
}

function pct(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return "n/a";
  const sign = n > 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(digits)}%`;
}

function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return "n/a";
  return p.toFixed(2);
}

interface ParsedArgs {
  coin: string;
  interval: Interval;
  days: number;
  /** "returned to close" threshold as a fraction (default 0.001 = 0.1%) */
  threshold: number;
}

function isInterval(s: string): s is Interval {
  return (INTERVALS as readonly string[]).includes(s);
}

function usage(): string {
  return [
    "Usage: tsx strategies/afterhoursReversion.ts [--coin <sym>] [--interval <i>] [--days <n>] [--threshold <pct>]",
    "",
    "  --coin       symbol (default: xyz:SP500)",
    "  --interval   Hyperliquid interval; must align to 09:30/16:00 ET (default: 5m; 5m/15m/30m recommended)",
    "  --days       lookback window in days (default: 20)",
    "  --threshold  'returned to close' band in percent (default: 0.1)",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let coin = "xyz:SP500";
  let interval: Interval = "5m";
  let days = 20;
  let threshold = 0.001;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (a === "--") continue;
    const next = argv[i + 1];
    if (next === undefined) throw new Error(`missing value for ${a}`);
    if (a === "--coin") {
      coin = next;
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
    } else if (a === "--threshold") {
      const v = Number(next);
      if (!Number.isFinite(v) || v < 0) throw new Error(`--threshold must be a non-negative number, got ${next}`);
      threshold = v / 100;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return { coin, interval, days, threshold };
}

function buildObservations(candles: readonly Candle[], intervalMin: number): Observation[] {
  // Ascending by openTime; annotate with ET date + minute-of-day.
  const annotated: Annotated[] = candles
    .map((c) => {
      const { date, minOfDay } = etParts(c.openTime);
      return { c, date, minOfDay };
    })
    .sort((a, b) => a.c.openTime - b.c.openTime);

  const byDate = new Map<string, Annotated[]>();
  for (const a of annotated) {
    const arr = byDate.get(a.date);
    if (arr === undefined) byDate.set(a.date, [a]);
    else arr.push(a);
  }

  // Session dates: ET weekdays that are not full-day holidays.
  const sessionDates = [...byDate.keys()]
    .filter((d) => {
      const wd = weekdayOf(d);
      return wd >= 1 && wd <= 5 && !HOLIDAYS.has(d);
    })
    .sort();

  const obs: Observation[] = [];
  for (let i = 0; i + 1 < sessionDates.length; i++) {
    const fromDate = sessionDates[i];
    const toDate = sessionDates[i + 1];
    if (fromDate === undefined || toDate === undefined) continue;
    const fromCands = byDate.get(fromDate);
    const toCands = byDate.get(toDate);
    if (fromCands === undefined || toCands === undefined) continue;

    const closeMin = HALF_DAYS.has(fromDate) ? HALF_DAY_CLOSE_MIN : REGULAR_CLOSE_MIN;
    const closeCandle = pickCloseCandle(fromCands, closeMin, intervalMin);
    const openCandle = pickOpenCandle(toCands, OPEN_MIN, intervalMin);
    if (closeCandle === null || openCandle === null) continue;

    const close = closeCandle.close;
    const open = openCandle.open;

    // After-hours bars: strictly between the close bar and the open bar.
    let ahHigh = Number.NEGATIVE_INFINITY;
    let ahLow = Number.POSITIVE_INFINITY;
    let ahBars = 0;
    for (const a of annotated) {
      if (a.c.openTime <= closeCandle.openTime) continue;
      if (a.c.openTime >= openCandle.openTime) break;
      ahBars += 1;
      if (a.c.high > ahHigh) ahHigh = a.c.high;
      if (a.c.low < ahLow) ahLow = a.c.low;
    }

    const gap = (open - close) / close;
    let excursion: number | null = null;
    let reversion: number | null = null;
    if (ahBars > 0 && close > 0) {
      excursion = Math.max(ahHigh - close, close - ahLow) / close;
      reversion = excursion > 0 ? 1 - Math.abs(gap) / excursion : null;
    }

    obs.push({
      fromDate,
      toDate,
      close,
      open,
      ahHigh: ahBars > 0 ? ahHigh : null,
      ahLow: ahBars > 0 ? ahLow : null,
      ahBars,
      gap,
      excursion,
      reversion,
    });
  }
  return obs;
}

function printReport(args: ParsedArgs, obs: readonly Observation[]): void {
  const out = (s: string): void => void process.stdout.write(s);

  out(`\n== after-hours reversion: ${args.coin} (${args.interval}) ==\n`);
  if (obs.length === 0) {
    out("  no overnight observations could be built (insufficient history or interval misaligned)\n");
    return;
  }

  out(
    "from        ->  to          close      ah_low     ah_high    excursion   open       gap         reversion   bars\n",
  );
  for (const o of obs) {
    const line = [
      o.fromDate,
      "->",
      o.toDate.padEnd(11),
      fmtPrice(o.close).padStart(9),
      (o.ahLow !== null ? fmtPrice(o.ahLow) : "n/a").padStart(10),
      (o.ahHigh !== null ? fmtPrice(o.ahHigh) : "n/a").padStart(10),
      (o.excursion !== null ? pct(o.excursion) : "n/a").padStart(10),
      fmtPrice(o.open).padStart(10),
      pct(o.gap).padStart(11),
      (o.reversion !== null ? o.reversion.toFixed(2) : "n/a").padStart(11),
      String(o.ahBars).padStart(5),
    ].join("  ");
    out(`${line}\n`);
  }

  const gaps = obs.map((o) => o.gap);
  const absGaps = gaps.map((g) => Math.abs(g));
  const excursions = obs.filter((o) => o.excursion !== null).map((o) => o.excursion as number);
  const reversions = obs.filter((o) => o.reversion !== null).map((o) => o.reversion as number);
  const returned = obs.filter((o) => Math.abs(o.gap) <= args.threshold).length;
  const up = gaps.filter((g) => g > 0).length;
  const down = gaps.filter((g) => g < 0).length;

  out(`\n== summary (n=${obs.length}) ==\n`);
  out(`  overnight gap |open-close|:  median=${pct(median(absGaps))}  mean=${pct(mean(absGaps))}\n`);
  out(`  after-hours excursion:       median=${pct(median(excursions))}  mean=${pct(mean(excursions))}\n`);
  out(
    `  reversion fraction r:        median=${median(reversions).toFixed(2)}  mean=${mean(reversions).toFixed(2)}  (1=fully reverted, 0=move persisted)\n`,
  );
  out(
    `  returned within ±${(args.threshold * 100).toFixed(2)}%:      ${returned}/${obs.length} (${((returned / obs.length) * 100).toFixed(0)}%)\n`,
  );
  out(
    `  signed gap (drift):          median=${pct(median(gaps))}  mean=${pct(mean(gaps))}  up=${up} down=${down}  sign-test p≈${signTestP(up, down).toFixed(3)}\n`,
  );

  const medExc = median(excursions);
  const medGap = median(absGaps);
  const medRev = median(reversions);
  out(`\n== verdict ==\n`);
  if (Number.isFinite(medExc) && Number.isFinite(medGap) && medExc > 2 * medGap && medRev > 0.7) {
    out("  SUPPORTS hypothesis: after-hours excursions are large but largely revert by the open.\n");
  } else if (Number.isFinite(medRev) && medRev < 0.3) {
    out("  REJECTS hypothesis: overnight moves persist into the open (little reversion).\n");
  } else {
    out("  MIXED/INCONCLUSIVE: reversion is partial — neither clearly supported nor rejected.\n");
  }
  out(
    `  NOTE: n=${obs.length} is small (one observation per session); treat this as directional, not a significance test.\n`,
  );
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n\n${usage()}\n`);
    process.exit(2);
    return;
  }

  const intervalMin = INTERVAL_MIN[args.interval];
  if (intervalMin > 30) {
    process.stderr.write(
      `WARNING: --interval ${args.interval} does not align to the 09:30 open; use 5m/15m/30m for accurate boundaries.\n`,
    );
  }

  process.stderr.write(
    `after-hours reversion: ${args.coin}  interval=${args.interval}  days=${args.days}\nfetching candles...\n`,
  );
  const candles = await fetchHistory({
    coin: args.coin,
    interval: args.interval,
    days: args.days,
    onChunk: ({ chunkIndex, received, earliestMs }) => {
      process.stderr.write(
        received === 0
          ? `  chunk ${chunkIndex}: 0 bars before ${new Date(earliestMs).toISOString()} — history exhausted\n`
          : `  chunk ${chunkIndex}: ${received} bars  earliest=${new Date(earliestMs).toISOString()}\n`,
      );
    },
  });

  if (candles.length === 0) {
    process.stderr.write("no candles returned; nothing to analyze\n");
    process.exit(1);
    return;
  }
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (first !== undefined && last !== undefined) {
    process.stderr.write(
      `fetched ${candles.length} bars: ${new Date(first.openTime).toISOString()} → ${new Date(last.openTime).toISOString()}\n`,
    );
  }

  const obs = buildObservations(candles, intervalMin);
  printReport(args, obs);
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
