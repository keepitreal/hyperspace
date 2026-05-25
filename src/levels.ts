import type { Candle, Level, LevelSide } from "./types.js";

export interface DetectLevelsOptions {
  pivotWindow: number;
  clusterBps: number;
  maxLevels: number;
}

interface Pivot {
  index: number;
  ts: number;
  price: number;
  volume: number;
}

/**
 * Find swing-pivot highs over closed candles.
 *
 * A bar at index i (window-clear from both edges) is a swing high iff
 * its high is >= every other high in [i-N, i+N], strictly greater than
 * at least one neighbour on each side. The strict-on-each-side rule
 * avoids treating long flat plateaus as a pivot at every index.
 */
function findSwingHighs(candles: readonly Candle[], window: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = window; i < candles.length - window; i++) {
    const c = candles[i];
    if (c === undefined) continue;
    let isPivot = true;
    let strictLeft = false;
    let strictRight = false;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      const other = candles[j];
      if (other === undefined) continue;
      if (other.high > c.high) {
        isPivot = false;
        break;
      }
      if (other.high < c.high) {
        if (j < i) strictLeft = true;
        else strictRight = true;
      }
    }
    if (isPivot && strictLeft && strictRight) {
      out.push({ index: i, ts: c.openTime, price: c.high, volume: c.volume });
    }
  }
  return out;
}

function findSwingLows(candles: readonly Candle[], window: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = window; i < candles.length - window; i++) {
    const c = candles[i];
    if (c === undefined) continue;
    let isPivot = true;
    let strictLeft = false;
    let strictRight = false;
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue;
      const other = candles[j];
      if (other === undefined) continue;
      if (other.low < c.low) {
        isPivot = false;
        break;
      }
      if (other.low > c.low) {
        if (j < i) strictLeft = true;
        else strictRight = true;
      }
    }
    if (isPivot && strictLeft && strictRight) {
      out.push({ index: i, ts: c.openTime, price: c.low, volume: c.volume });
    }
  }
  return out;
}

/**
 * Cluster pivots whose prices are within `clusterBps` basis points of
 * each other. Greedy single-link clustering on price-sorted pivots.
 */
function clusterPivots(pivots: Pivot[], side: LevelSide, clusterBps: number): Level[] {
  if (pivots.length === 0) return [];
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const tolFraction = clusterBps / 10_000;

  const clusters: Pivot[][] = [];
  let current: Pivot[] = [];
  for (const p of sorted) {
    if (current.length === 0) {
      current.push(p);
      continue;
    }
    const last = current[current.length - 1];
    if (last === undefined) {
      current.push(p);
      continue;
    }
    if ((p.price - last.price) / last.price <= tolFraction) {
      current.push(p);
    } else {
      clusters.push(current);
      current = [p];
    }
  }
  if (current.length > 0) clusters.push(current);

  return clusters.map<Level>((members) => {
    let weightSum = 0;
    let weightedPrice = 0;
    let lastTs = 0;
    for (const m of members) {
      const w = m.volume > 0 ? m.volume : 1;
      weightSum += w;
      weightedPrice += w * m.price;
      if (m.ts > lastTs) lastTs = m.ts;
    }
    const price = weightSum > 0 ? weightedPrice / weightSum : members[0]!.price;
    return {
      side,
      price,
      touches: members.length,
      lastTouchTs: lastTs,
    };
  });
}

/** Rank by touches desc, then recency desc. */
function rankLevels(levels: Level[], maxLevels: number): Level[] {
  return [...levels]
    .sort((a, b) => {
      if (b.touches !== a.touches) return b.touches - a.touches;
      return b.lastTouchTs - a.lastTouchTs;
    })
    .slice(0, maxLevels);
}

export interface DetectedLevels {
  resistance: Level[];
  support: Level[];
}

export function detectLevels(
  closedCandles: readonly Candle[],
  opts: DetectLevelsOptions,
): DetectedLevels {
  const { pivotWindow, clusterBps, maxLevels } = opts;
  if (closedCandles.length < pivotWindow * 2 + 1) {
    return { resistance: [], support: [] };
  }
  const highs = findSwingHighs(closedCandles, pivotWindow);
  const lows = findSwingLows(closedCandles, pivotWindow);
  const resistance = rankLevels(clusterPivots(highs, "resistance", clusterBps), maxLevels);
  const support = rankLevels(clusterPivots(lows, "support", clusterBps), maxLevels);
  return { resistance, support };
}

/** Stable identity key for matching levels across polls. Rounded to 1 bp. */
export function levelKey(level: Level): string {
  const rounded = Math.round(level.price * 10_000) / 10_000;
  return `${level.side}:${rounded}`;
}
