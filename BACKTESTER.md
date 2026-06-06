# Visual Backtester

A local web app for visually backtesting mean-reversion strategies on equity data,
reusing this repo's indicators and backtest engine. SPY is loaded by default with
~2 years of history at 1h / 4h / 1d / 1w.

## Architecture

```
Browser (web/, Vite + React + lightweight-charts)
   │  /api/* (proxied in dev to :8787)
API server (server/, Hono)
   ├─ GET  /api/series       what's cached
   ├─ GET  /api/strategies   strategies + tunable param schema
   ├─ GET  /api/candles      raw candles for a (symbol, interval)
   └─ POST /api/backtest     candles + indicator overlays + trades + equity + stats
        ├─ runBacktest         ← strategies/lib/runner.ts   (reused)
        ├─ summarize / MAE     ← strategies/lib/metrics.ts, mae.ts (reused)
        ├─ equityCurve         ← strategies/lib/equity.ts
        └─ indicators          ← analyst/indicators/* (reused)
Data layer (data/)
   ├─ providers/polygon.ts   Massive/Polygon aggregates → Candle[] (paginated, paced)
   ├─ resample.ts            5m → 1h/4h/1d/1w, RTH-only, 09:30 ET anchored
   └─ store.ts               SQLite cache, keyed (symbol, interval, openTime)
```

The base series is **5-minute SPY bars**; 1h/4h/1d/1w are derived by RTH-only
resampling so every bar is anchored to the 09:30 ET open and pre/post-market
noise is excluded.

## Setup

1. Get a free API key at <https://massive.com/dashboard/keys> (Polygon.io is now
   Massive — same API/keys). Add it to `.env`:

   ```
   MASSIVE_API_KEY=your_key_here
   ```

2. Backfill the cache (one-time; paced to the free tier's 5 req/min, ~2 min):

   ```
   pnpm backfill --symbol SPY --years 2
   ```

   Re-running is incremental (resumes from the last stored bar). Use `--full` to
   refetch everything, `--rpm 100` on a paid tier to go faster.

3. Run the API and the web app in two terminals:

   ```
   pnpm serve      # http://localhost:8787  (API)
   pnpm web        # http://localhost:5173  (UI)
   ```

   Open <http://localhost:5173>. Pick a symbol/interval/strategy, tune params,
   hit **Run backtest**. The chart shows candles, the Bollinger bands, and
   entry/exit markers; the equity curve and stats update alongside.

## Strategies

- **Bollinger + RSI mean reversion** (tunable): long when price closes below the
  lower band with RSI ≤ threshold; short when above the upper band with RSI ≥
  threshold; exit on a return to the mean (SMA) or after N bars.
- **VWAP + RSI mean reversion**: the existing `strategies/vwapRsiMeanReversion.ts`.

Add a strategy by registering it in `server/strategies.ts` (a `build()` factory
plus a `params` schema and optional chart `overlays()`).

## Adding more symbols

`pnpm backfill --symbol QQQ --years 2` caches another ticker; it shows up in the
symbol dropdown automatically.
