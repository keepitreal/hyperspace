# Backtest harness

Greenfield backtest infrastructure for strategy R&D against Hyperliquid candle
data. No local data storage — every run re-fetches from
`/info candleSnapshot`. Reuses `fetchCandles`, `computeRsi`, and `sessionVwap`
from `src/` unchanged.

## Files

```
strategies/
  lib/
    fetchHistory.ts   — paginated /info fetcher (5000-bar chunks)
    runner.ts         — Strategy interface, trade ledger, MAE/MFE tracking
    metrics.ts        — Summary stats over a Trade[]
    mae.ts            — MAE/MFE analysis + stop-loss scenario simulator
    report.ts         — Text printers (summary, MAE buckets, trade ledger)
  vwapRsiMeanReversion.ts   — first strategy
  run.ts              — CLI entrypoint
```

## How to run

```
pnpm typecheck

pnpm backtest -- --coin ETH --days 7                                # smoke
pnpm backtest -- --coin ETH,BTC,SOL,HYPE --days 17 --interval 5m    # full available 5m window
pnpm backtest -- --coin ETH --days 90 --interval 1h                 # 1h gets ~208d
pnpm backtest -- --coin ETH --verbose                               # also dump trade ledger w/ MAE/MFE
```

CLI flags: `--coin <csv>` (default `ETH,BTC,SOL,HYPE`), `--interval` (default
`5m`), `--days` (default `90`), `--strategy` (default
`vwap-rsi-mean-reversion`), `--verbose`.

## Hyperliquid history limit (important)

`/info candleSnapshot` only serves roughly the **5000 most recent bars per
interval**, regardless of `startTime`. At 5m that's ~17 days; at 1h ~208 days;
at 1d years. The harness warns when the served window is shorter than
requested. All findings below are from the available 5m window (~17 days).

## Strategy: vwap-rsi-mean-reversion

Symmetric mean reversion gated by VWAP regime.

- **Long entry**: `price < session-VWAP AND RSI(14) <= longThreshold`
- **Short entry**: `price > session-VWAP AND RSI(14) >= shortThreshold`
- **Exit**: RSI crosses back through 50 (long: `rsi >= 50`, short: `rsi <= 50`)
- **Forced exit**: first bar of a new UTC day (the same boundary where session
  VWAP resets, recorded as `TIMEOUT_DAY`)
- **Fills**: frictionless, at the signal bar's close (small look-ahead vs.
  next-bar-open — acceptable for first-pass edge detection)
- **Warmup**: 15 bars (RSI period + 1)

Thresholds are constants in `vwapRsiMeanReversion.ts`. **Currently set to
20/80** (was 25/75 originally). Easy to flip back or to make a CLI flag.

## Findings as of last session (17-day 5m window, 2026-05-10 → 2026-05-27)

### Threshold comparison (no stops)

| Bounds | Trades | Win | Total | Best stop | After stop |
|--------|------:|----:|------:|---------:|----------:|
| 75/25  | 151 | 64.9% | **−1065 bps** | 75 bps  | −346 |
| **80/20** | 69  | 59.4% | **−362 bps** | **150 bps** | **+732** |

Tighter thresholds (80/20) cut signals by ~54% and yielded the strongest
result: **80/20 entries + 150-bps stop = +732 bps aggregate** over the basket.

### Per-coin (80/20, no stops)

| Coin | Trades | Win | Total | With 150 bps stop |
|------|------:|----:|------:|------------------:|
| ETH  | 20 | 70% | **+305** | +387 |
| BTC  | 15 | 47% | −193 | −188 |
| SOL  | 17 | 53% | −505 | −58 |
| HYPE | 17 | 65% | +31 | **+591** |

Strongest subset by far: **ETH + HYPE on 80/20 + 150 bps stop = +978 bps over
17 days**. BTC/SOL look like they want the 75/25 thresholds — too few trades
at 80/20.

### MAE-driven insight

Winners' and losers' Maximum Adverse Excursion distributions separate cleanly
(aggregate, 80/20):

```
winners (n=41)  p50=42  p75=75   p90=123  p95=137  bps
losers  (n=28)  p50=124 p75=240  p90=430  p95=490  bps
```

Median loser drew down ~5× further than median winner before resolving. Stops
exploit exactly this gap. Optimal stop width scales with how extreme the entry
RSI is (75/25 → 75 bps, 80/20 → 150 bps), because extreme-RSI trades take
deeper drawdowns before reverting.

Per-coin optimum stops vary with each coin's volatility regime — argues for
ATR-relative stops rather than a fixed bps.

## What's NOT done yet (live open threads)

1. **ATR-relative stops** — implementation is the natural next move. Stop =
   k × ATR(14), where k is sweepable (e.g., 0.5, 1.0, 1.5, 2.0). Would replace
   the current implicit "hold until RSI 50 or UTC rollover" with a real risk
   ceiling that adapts per coin.

2. **Stop integration into the strategy itself.** MAE analysis is currently
   *post-hoc* — the harness simulates "what if a stop had been in place" from
   recorded MAE. To actually run with a stop, the strategy needs to check
   `candle.low`/`candle.high` against an entry-relative threshold and emit a
   `close` action when it's breached. Currently the strategy doesn't see
   running MAE because the runner doesn't pass it in.

3. **Threshold as CLI flag**, not hardcoded. e.g. `--rsi-long 20 --rsi-short
   80` plus `--stop-bps 150`. Would let us sweep without re-editing source.

4. **Longer-history validation.** 17 days is a tiny sample. Re-run at 1h
   interval for ~208 days to see if per-coin direction holds. Caveat: 1h has
   ~12× fewer signals per day, so trade count won't necessarily increase.

5. **Verify the VWAP/TradingView session anchor mismatch** — pre-existing
   issue from before the backtest work. Live bot's VWAP at `2026-05-27
   00:05:04` showed 2075.23 while user's TradingView showed ~2098.
   Hypothesis: TV's "Session" anchor is not 00:00 UTC. Not in scope for
   backtest work but worth resolving before trusting either tool for live
   signals.

6. **HYPE-on-shorts is fundamentally broken** even with stops. Worst trade
   was −952 bps. Either exclude HYPE from the short side, or accept that
   mean-reversion is just wrong on HYPE's typical price action.

## Quick spot-check workflow

When debugging a single trade or sanity-checking math:

```
pnpm backtest -- --coin SOL --days 17 --verbose 2>&1 | tee /tmp/sol.log
```

The verbose ledger now includes MAE and MFE per trade, so you can pick a
suspect trade and look up the timestamp on the Hyperliquid UI to eyeball
RSI(14) and VWAP at that bar.

## Reused from src/

- `fetchCandles({ coin, interval, lookback, now?, signal? })` — single chunk
- `computeRsi(closes, period)` — Wilder smoothing, returns null if too short
- `sessionVwap(candle, history)` — 00:00 UTC daily reset, (H+L+C)/3 typical
- `Candle`, `Interval` types
