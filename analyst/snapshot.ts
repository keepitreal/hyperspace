import { fetchCandles, splitClosed } from "../src/hyperliquid.js";
import { detectLevels, type DetectedLevels } from "../src/levels.js";
import { atr, volumeRatio } from "../src/quality.js";
import { computeRsi } from "../src/rsi.js";
import type { Candle, Interval } from "../src/types.js";
import { sessionVwap } from "../src/vwap.js";
import { adx, type AdxResult } from "./indicators/adx.js";
import { bollinger, type BollingerResult } from "./indicators/bollinger.js";
import { donchian, type DonchianResult } from "./indicators/donchian.js";
import { ema } from "./indicators/ema.js";
import { ichimoku, type IchimokuResult } from "./indicators/ichimoku.js";
import { macd, type MacdResult } from "./indicators/macd.js";
import { mfi } from "./indicators/mfi.js";
import { obv, type ObvResult } from "./indicators/obv.js";
import { pivots, type PivotResult } from "./indicators/pivots.js";
import { sma } from "./indicators/sma.js";
import { stochastic, type StochasticResult } from "./indicators/stochastic.js";

const TIMEFRAMES: readonly Interval[] = ["1d", "4h", "1h", "15m"];
const BARS_PER_TF = 250;
const RECENT_CANDLES_INCLUDED = 20;

export interface RecentCandle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface TimeframeSnapshot {
  interval: Interval;
  barCount: number;
  startTime: string;
  endTime: string;
  currentPrice: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  macd: MacdResult | null;
  adx: AdxResult | null;
  ichimoku: IchimokuResult | null;
  rsi: number | null;
  stochastic: StochasticResult | null;
  atr: number | null;
  bollinger: BollingerResult | null;
  obv: ObvResult | null;
  mfi: number | null;
  volumeRatio: number | null;
  vwap: number | null;
  donchian: DonchianResult | null;
  levels: DetectedLevels;
  recentCandles: RecentCandle[];
}

export interface CoinSnapshot {
  coin: string;
  generatedAt: string;
  currentPrice: number;
  change24hPct: number | null;
  timeframes: Record<Interval, TimeframeSnapshot>;
  pivots: PivotResult | null;
  sma200Daily: number | null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function recentCandles(candles: readonly Candle[], count: number): RecentCandle[] {
  return candles.slice(-count).map((c) => ({
    t: iso(c.openTime),
    o: c.open,
    h: c.high,
    l: c.low,
    c: c.close,
    v: c.volume,
  }));
}

function computeTimeframe(
  interval: Interval,
  closed: readonly Candle[],
): TimeframeSnapshot {
  const last = closed[closed.length - 1]!;
  const closes = closed.map((c) => c.close);
  const history = closed.slice(0, -1);

  return {
    interval,
    barCount: closed.length,
    startTime: iso(closed[0]!.openTime),
    endTime: iso(last.openTime),
    currentPrice: last.close,
    ema20: ema(closes, 20),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    macd: macd(closes, 12, 26, 9),
    adx: adx(closed, 14),
    ichimoku: ichimoku(closed),
    rsi: computeRsi(closes, 14),
    stochastic: stochastic(closed, 14, 3, 3),
    atr: atr(last, history),
    bollinger: bollinger(closes, 20, 2),
    obv: obv(closed),
    mfi: mfi(closed, 14),
    volumeRatio: volumeRatio(last, history),
    vwap: interval === "1d" ? null : sessionVwap(last, history),
    donchian: donchian(closed, 20),
    levels: detectLevels(closed, { pivotWindow: 5, clusterBps: 25, maxLevels: 6 }),
    recentCandles: recentCandles(closed, RECENT_CANDLES_INCLUDED),
  };
}

export interface BuildSnapshotArgs {
  coin: string;
  signal?: AbortSignal;
}

/**
 * Build a multi-timeframe indicator snapshot for one coin. Fetches 1d, 4h,
 * 1h, 15m candles from Hyperliquid (no caching), runs all configured
 * indicators per TF, and returns a structured object ready for prompt
 * formatting.
 */
export async function buildSnapshot(args: BuildSnapshotArgs): Promise<CoinSnapshot> {
  const { coin, signal } = args;

  const fetchOpts = (interval: Interval): Parameters<typeof fetchCandles>[0] =>
    signal !== undefined
      ? { coin, interval, lookback: BARS_PER_TF, signal }
      : { coin, interval, lookback: BARS_PER_TF };

  const fetches = TIMEFRAMES.map((tf) => fetchCandles(fetchOpts(tf)));
  const results = await Promise.all(fetches);

  const timeframes: Partial<Record<Interval, TimeframeSnapshot>> = {};
  for (let i = 0; i < TIMEFRAMES.length; i++) {
    const interval = TIMEFRAMES[i]!;
    const all = results[i]!;
    const { closed } = splitClosed(all);
    if (closed.length === 0) {
      throw new Error(`no closed candles returned for ${coin} ${interval}`);
    }
    timeframes[interval] = computeTimeframe(interval, closed);
  }

  const daily = timeframes["1d"]!;
  const sma200Daily = sma(
    results[0]!.map((c) => c.close),
    200,
  );

  // Prior daily candle for pivot points
  const dailyAll = splitClosed(results[0]!).closed;
  const priorDay = dailyAll.length >= 2 ? dailyAll[dailyAll.length - 2] : null;
  const pivotResult = priorDay !== null && priorDay !== undefined ? pivots(priorDay) : null;

  // 24h change derived from 15m TF (96 bars back ≈ 24h)
  const fifteenAll = splitClosed(results[3]!).closed;
  let change24hPct: number | null = null;
  if (fifteenAll.length >= 97) {
    const now = fifteenAll[fifteenAll.length - 1]!.close;
    const ago = fifteenAll[fifteenAll.length - 97]!.close;
    if (ago > 0) change24hPct = ((now - ago) / ago) * 100;
  }

  return {
    coin,
    generatedAt: iso(Date.now()),
    currentPrice: daily.currentPrice,
    change24hPct,
    timeframes: timeframes as Record<Interval, TimeframeSnapshot>,
    pivots: pivotResult,
    sma200Daily,
  };
}
