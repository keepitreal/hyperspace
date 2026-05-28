import type { CoinSnapshot } from "./snapshot.js";

export const SYSTEM_PROMPT = `You are a senior technical analyst for crypto perpetuals trading. You analyze a snapshot of indicators across multiple timeframes (1d / 4h / 1h / 15m) and produce a sober, evidence-based read on the market. You are not a hype machine — your job is to call ranges as ranges, weak setups as weak, and only flag high-conviction directional setups when the technicals genuinely align.

You will receive structured JSON containing, per timeframe:
  - Current price, recent OHLCV bars
  - Trend: EMA(20/50/200), MACD, ADX + DI±, Ichimoku
  - Momentum: RSI(14), Stochastic(14,3,3)
  - Volatility: ATR(14), Bollinger Bands (with %b and bandwidth)
  - Volume: OBV (with prev for direction), MFI(14), volumeRatio vs 20-bar mean
  - Anchors: session VWAP (intraday TFs only), detected S/R levels, Donchian(20)
Plus, derived once: daily SMA(200) and Classic pivot points from the prior daily candle.

Your output MUST be markdown with EXACTLY these sections, in this order:

## Regime
One line. Pick: Trending Up / Trending Down / Ranging / Volatile / Transitioning. Cite the 1–2 indicators that drove the call (e.g., "ADX 32 on 4h with +DI > −DI; price above all EMAs").

## Multi-Timeframe Alignment
2–4 bullets. For each TF, state directional read (bullish / bearish / neutral) and the one or two signals supporting it. Call out conflicts explicitly (e.g., "1d bullish but 1h bearish — pullback within uptrend").

## Bias and Conviction
Format: \`**BIAS:** BULLISH | BEARISH | NEUTRAL · **CONVICTION:** HIGH | MED | LOW\`. One short paragraph justifying the call from the alignment above. Conviction HIGH requires at least three TFs agreeing AND at least one trend-strength indicator (ADX > 25) confirming. MED if two TFs agree. LOW or NEUTRAL otherwise.

## Key Levels
Bullet list. The 3–6 most actionable levels right now, each with a price and one-line reason ("4h Kijun at 2102, also coincides with R1 pivot"). Prefer levels with confluence across indicators or TFs.

## Setup
If bias is directional and conviction is MED or HIGH, propose ONE entry: \`Long/Short at <price>, stop <price>, targets <price>[, <price>]\`. Justify in one sentence. If conviction is LOW or NEUTRAL, write "No setup — stand aside until [specific condition]." Do not invent a setup to fill the section.

## Invalidation
1–3 bullets. What price action or indicator turn would flip the read? Be specific ("4h close below 2050 voids the long thesis").

Rules:
- Don't restate every indicator value. Reference only those that drive a conclusion.
- Distinguish between intraday noise (15m) and structural moves (1d/4h).
- If data is missing for an indicator (null), say so explicitly only if it matters; otherwise ignore.
- Never recommend leverage, sizing, or specific dollar amounts. You only call direction, levels, and invalidation.
- Do NOT use any markdown other than the section headers, bullets, bold, and inline code for prices.`;

function compact(snapshot: CoinSnapshot): string {
  // Round numerics for prompt brevity. Two decimals for prices > 1, four for sub-1 coins.
  const rounder = snapshot.currentPrice >= 1 ? 2 : 6;
  const roundN = (n: number | null | undefined): number | null => {
    if (n === null || n === undefined || !Number.isFinite(n)) return null;
    return Number(n.toFixed(rounder));
  };
  const roundPct = (n: number | null | undefined): number | null => {
    if (n === null || n === undefined || !Number.isFinite(n)) return null;
    return Number(n.toFixed(2));
  };

  const tfPayload = Object.entries(snapshot.timeframes).map(([interval, tf]) => ({
    interval,
    bars: tf.barCount,
    range: `${tf.startTime} → ${tf.endTime}`,
    price: roundN(tf.currentPrice),
    ema20: roundN(tf.ema20),
    ema50: roundN(tf.ema50),
    ema200: roundN(tf.ema200),
    macd: tf.macd === null
      ? null
      : {
          line: roundN(tf.macd.line),
          signal: roundN(tf.macd.signal),
          histogram: roundN(tf.macd.histogram),
        },
    adx: tf.adx === null
      ? null
      : {
          adx: roundPct(tf.adx.adx),
          plusDI: roundPct(tf.adx.plusDI),
          minusDI: roundPct(tf.adx.minusDI),
        },
    ichimoku: tf.ichimoku === null
      ? null
      : {
          tenkan: roundN(tf.ichimoku.tenkan),
          kijun: roundN(tf.ichimoku.kijun),
          senkouA: roundN(tf.ichimoku.senkouA),
          senkouB: roundN(tf.ichimoku.senkouB),
          senkouAFuture: roundN(tf.ichimoku.senkouAFuture),
          senkouBFuture: roundN(tf.ichimoku.senkouBFuture),
          priceAboveCloud: tf.ichimoku.priceAboveCloud,
          priceBelowCloud: tf.ichimoku.priceBelowCloud,
          cloudBullish: tf.ichimoku.cloudBullish,
          chikouAbovePast: tf.ichimoku.chikouAbovePast,
        },
    rsi: roundPct(tf.rsi),
    stochastic: tf.stochastic === null
      ? null
      : { k: roundPct(tf.stochastic.k), d: roundPct(tf.stochastic.d) },
    atr: roundN(tf.atr),
    bollinger: tf.bollinger === null
      ? null
      : {
          upper: roundN(tf.bollinger.upper),
          mid: roundN(tf.bollinger.mid),
          lower: roundN(tf.bollinger.lower),
          percentB: roundPct(tf.bollinger.percentB),
          bandwidthPct: roundPct(tf.bollinger.bandwidth * 100),
        },
    obv: tf.obv === null ? null : { value: Math.round(tf.obv.value), prev: Math.round(tf.obv.prev) },
    mfi: roundPct(tf.mfi),
    volumeRatio: tf.volumeRatio === null ? null : Number(tf.volumeRatio.toFixed(2)),
    vwap: roundN(tf.vwap),
    donchian: tf.donchian === null
      ? null
      : {
          upper: roundN(tf.donchian.upper),
          mid: roundN(tf.donchian.mid),
          lower: roundN(tf.donchian.lower),
          position: roundPct(tf.donchian.position),
        },
    levels: {
      resistance: tf.levels.resistance.map((l) => ({
        price: roundN(l.price),
        touches: l.touches,
      })),
      support: tf.levels.support.map((l) => ({
        price: roundN(l.price),
        touches: l.touches,
      })),
    },
    recentCandles: tf.recentCandles.map((c) => ({
      t: c.t,
      o: roundN(c.o),
      h: roundN(c.h),
      l: roundN(c.l),
      c: roundN(c.c),
      v: Math.round(c.v),
    })),
  }));

  return JSON.stringify(
    {
      coin: snapshot.coin,
      generatedAt: snapshot.generatedAt,
      currentPrice: roundN(snapshot.currentPrice),
      change24hPct: roundPct(snapshot.change24hPct),
      sma200Daily: roundN(snapshot.sma200Daily),
      pivots: snapshot.pivots === null
        ? null
        : {
            p: roundN(snapshot.pivots.p),
            r1: roundN(snapshot.pivots.r1),
            r2: roundN(snapshot.pivots.r2),
            r3: roundN(snapshot.pivots.r3),
            s1: roundN(snapshot.pivots.s1),
            s2: roundN(snapshot.pivots.s2),
            s3: roundN(snapshot.pivots.s3),
          },
      timeframes: tfPayload,
    },
    null,
    2,
  );
}

export function buildUserPrompt(snapshot: CoinSnapshot): string {
  return `Analyze ${snapshot.coin} based on the following multi-timeframe technical snapshot. Follow the section structure exactly.

\`\`\`json
${compact(snapshot)}
\`\`\``;
}
