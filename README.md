# hyperspace

A read-only TypeScript toolkit for analyzing [Hyperliquid](https://hyperliquid.xyz) perp markets. Three independent components share the same indicator library and data layer:

- **Live monitor** (`pnpm start`) — polls candle data, auto-detects support/resistance, runs a breakout/retest state machine, plus RSI and body-volatility alerts. Persists state, ships notifications to Telegram.
- **Backtest harness** (`pnpm backtest`) — pulls history from Hyperliquid (no local storage), runs strategies against it, prints summary metrics with MAE analysis for stop-placement insight. See [`strategies/README.md`](strategies/README.md).
- **Market analyst** (`pnpm analyst`) — computes 15 indicators across 4 timeframes for a coin, hands the snapshot to Claude Opus, prints a structured technical read to stdout and Telegram.

This project **does not place trades**. No signing, no order endpoints — every component reads from the public `/info` endpoint.

## Requirements

- Node.js >= 20 (native `fetch` and `node:test` are required)
- `pnpm` (configured via `packageManager`; `corepack enable` will pick it up)

## Install

```bash
pnpm install
```

## Environment

Either `export` the values in your shell or copy `.env.example` to `.env` and fill them in. The analyst CLI auto-loads `.env` from the project root; the live monitor and backtest expect shell env vars (Railway sets these directly).

| Var | Required for | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram alerts | Bot token from `@BotFather`. |
| `TELEGRAM_CHAT_ID` | Telegram alerts | Numeric chat ID for the recipient. |
| `ANTHROPIC_API_KEY` | `pnpm analyst` | API key from `console.anthropic.com`. Claude Max plans do **not** grant API access — pay-as-you-go billing required. |
| `HYPERSPACE_ALERT_KINDS` | optional | Comma-separated kinds sent to Telegram. Default: `BREAKOUT,RETEST_START,CONFIRMED,RSI_OVERBOUGHT,RSI_OVERSOLD,VOLATILITY_SPIKE`. Console output is always unfiltered. |
| `HYPERSPACE_DEBUG` | optional | Set `=1` to print per-bar indicator features in the status line. |

---

## Live monitor

```bash
pnpm start --coin BTC --interval 15m --lookback 300
```

Or, for multi-symbol / multi-interval monitoring, point at a JSON config:

```bash
pnpm start --config symbols.json
```

### symbols.json schema

```jsonc
{
  "stateDir": "/data",
  "defaults": {
    "lookback": 300,
    "pollMs": 5000,
    "pivotWindow": 5,
    "clusterBps": 25,
    "breakBps": 10,
    "retestBps": 15,
    "retestBars": 20,
    "maxLevels": 8,
    "maxReplayBars": 50,
    "volatilityThresholdPct": 0.5
  },
  "symbols": [
    {
      "coin": "ETH",
      "interval": "5m",
      "alerts": ["BREAKOUT", "RETEST_START", "CONFIRMED", "INVALIDATED", "EXPIRED", "RSI_OVERBOUGHT", "RSI_OVERSOLD", "VOLATILITY_SPIKE"]
    },
    {
      "coin": "ETH",
      "interval": "30m",
      "pollMs": 60000,
      "alerts": ["VOLATILITY_SPIKE"]
    }
  ]
}
```

Each `symbols[]` entry runs its own poll loop. The same coin can appear multiple times at different intervals — each entry has its own state file (`state-<coin>-<interval>.json` inside `stateDir`). All fields in `defaults` can be overridden per entry. The optional `alerts` array restricts which kinds that monitor emits; omit it to emit every kind the trackers produce.

### Alert kinds

| Kind | Trigger |
| --- | --- |
| `BREAKOUT` | A closed candle clears a level by ≥ `breakBps` from a primed setup. Carries a 0–100 confidence score. |
| `RETEST_START` | After a breakout, price wicks back to within `retestBps` of the broken level. |
| `CONFIRMED` | A closed candle re-breaks the level from the retest side. The headline event. |
| `INVALIDATED` | A closed candle prints back on the wrong side of the broken level. |
| `EXPIRED` | `retestBars` pass without a retest. |
| `RSI_OVERBOUGHT` / `RSI_OVERSOLD` | Wilder RSI(14) ≥ `rsiOverbought` or ≤ `rsiOversold` on a closed candle. |
| `VOLATILITY_SPIKE` | A closed candle's full range `(high − low) / open` ≥ `volatilityThresholdPct%`. Wicks included. `side` reflects close direction: `resistance` if close ≥ open, `support` otherwise. |

### Single-symbol CLI flags

| Flag | Default | Description |
| --- | --- | --- |
| `--coin` | _required_ | Hyperliquid coin symbol (`BTC`, `ETH`, `SOL`, etc.). |
| `--interval` | `15m` | One of: `1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 8h, 12h, 1d, 3d, 1w, 1M`. |
| `--lookback` | `300` | Recent candles to keep in the rolling window (max 5000). |
| `--poll-ms` | `intervalMs/3`, capped 60s | Refresh cadence in ms. |
| `--pivot-window` | `5` | Bars on each side required for a swing-pivot high/low. |
| `--cluster-bps` | `25` | Tolerance for merging nearby pivots into one level. |
| `--break-bps` | `10` | Close-buffer past a level to count as a breakout. |
| `--retest-bps` | `15` | Tolerance for price returning to the level. |
| `--retest-bars` | `20` | Maximum bars after a breakout before the setup expires. |
| `--max-levels` | `8` | Top-K levels per side, ranked by touch count then recency. |
| `--rsi-period` | `14` | Wilder RSI period. |
| `--rsi-overbought` | `70` | Fires `RSI_OVERBOUGHT` at or above this value. |
| `--rsi-oversold` | `30` | Fires `RSI_OVERSOLD` at or below this value. |
| `--volatility-threshold-pct` | `1.0` | Fires `VOLATILITY_SPIKE` when `|close-open|/open ≥` this %. |
| `--alerts` | _emit all_ | CSV inclusion list of alert kinds for this monitor. |
| `--state-file` | _off_ | Persist tracker state to this JSON path. |
| `--max-replay-bars` | `50` | Cap on candles to replay after an outage longer than the cursor. |

### What an alert looks like

```
[2026-05-29 20:39:59]  RETEST_START  ETH 5m   resistance 2016.49  px 2018.70 (+0.11%)
[2026-05-29 20:44:59]  CONFIRMED     ETH 5m   resistance 2016.49  px 2019.90 (+0.17%)  age 1b
[2026-05-29 20:54:59]  BREAKOUT      ETH 5m   support 2021.70     px 2017.10 (-0.23%)  confidence 57/100 MEDIUM (close +24, volume 0, atr +15, wick 0, level 0, time +10, vwap +8)
[2026-05-29 21:30:00]  VOLATILITY_SPIKE  ETH 30m  range 1.78%  H 2058.75  L 2022.60  close 2042.50 (up)
[2026-05-30 08:15:00]  RSI_OVERSOLD  ETH 5m   RSI 28.4   px 1987.20
```

### Breakout confidence scoring

`BREAKOUT` alerts include a 0–100 score from `quality.ts`:

- **close** (0–25): position of close within the bar, biased toward the breakout side.
- **volume** (0–25): bar volume vs SMA(20). Threshold buckets at 1.0×, 1.5×, 2.0×.
- **atr** (0–15): how many ATR multiples the close cleared the level by.
- **wick** (−15 to 0): penalty for a rejecting wick larger than the body.
- **level** (0–15): rewards repeatedly-tested levels (touch count).
- **time** (0–10): UTC-hour bucket — US/EU overlap > London > Asia > weekend.
- **vwap** (−8, 0, +8): bonus for closing on the trend-correct side of session VWAP, penalty for counter-trend.

Buckets: `HIGH ≥ 75`, `MEDIUM ≥ 50`, `LOW ≥ 25`, `VERY_LOW < 25`.

### State persistence

When `stateDir` is set in `symbols.json` (or `--state-file` is passed in single-symbol mode), each monitor writes a JSON state file containing:

- In-flight setups (`BROKEN`, `RETESTING`, cooldowns) — so retests survive restarts.
- Three cursors: the SetupTracker, RsiTracker, and VolatilityTracker last-processed candle openTimes — so already-evaluated bars aren't re-emitted.

Saves are atomic (`tmp` + `rename`) and happen after each poll that advances any cursor, plus once on graceful shutdown (SIGINT/SIGTERM).

On startup, if the persisted cursor is older than `maxReplayBars` × intervalMs, the cursor fast-forwards to that boundary — preventing a flood of replayed alerts after a long outage. Within the replay window, alerts do fire as the state machine catches up.

### How breakout/retest detection works

1. **Fetch.** Each poll posts `candleSnapshot` to `api.hyperliquid.xyz/info`.
2. **Levels.** Swing pivots are detected over the closed window, then nearby pivots are clustered within `clusterBps` to form a small set of support/resistance levels with touch counts.
3. **State machine.** Each level runs through `IDLE → BROKEN → RETESTING → CONFIRMED` (or `INVALIDATED` / `EXPIRED`), driven by closed candles. A `primed` flag prevents firing a fake breakout on a level we discovered already broken.
4. **Cooldown.** Terminal states hold for `retestBars` more bars before resetting to `IDLE`, so the same level doesn't retrigger instantly.

Only `BREAKOUT` and `CONFIRMED` require closed candles. The in-progress bar is peeked at solely to promote `BROKEN → RETESTING` early — never to fire a state transition.

### Telegram setup

1. Message [@BotFather](https://t.me/BotFather), run `/newbot`, save the token.
2. Send any message to your new bot once so it can DM you.
3. Hit `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser. Look for `"chat":{"id": <NUMBER>}` — that's your chat ID.
4. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (env vars or `.env`).

To verify delivery without waiting for a real alert:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... pnpm check:telegram
```

This sends four synthetic alerts (CONFIRMED, BREAKOUT with confidence, RSI_OVERBOUGHT, VOLATILITY_SPIKE) through the real Telegram driver. If credentials are bogus, the script logs one error and exits 0.

Notifier failures (network, rate limit, bad config) are logged but never crash the poll loop. Permanent config errors (401/403/400/404) stop retrying that channel until restart.

---

## Backtest harness

```bash
pnpm backtest -- --coin ETH --days 90 --interval 1h
pnpm backtest -- --coin ETH,BTC,SOL,HYPE --days 17 --interval 5m --verbose
```

Pulls history paginated from Hyperliquid (no local storage), runs a strategy, and prints:

- Per-symbol + aggregate summary: trade count, win rate, mean/median bps, total return, best/worst, average bars held, exit-reason counts.
- **MAE analysis**: distribution of maximum adverse excursion split by winners vs losers, plus a stop-loss scenario sweep showing simulated P&L impact at 50/75/100/150/200/300 bps.
- Optional `--verbose` trade ledger with MAE/MFE per trade.

Currently includes one strategy: **vwap-rsi-mean-reversion**. See [`strategies/README.md`](strategies/README.md) for the spec, findings to date, and architectural notes.

**History limit.** Hyperliquid's `candleSnapshot` only serves ~5000 most recent bars per interval — about 17 days at 5m, 52 days at 15m, 208 days at 1h, years at 1d. The harness warns when requested coverage exceeds what's available.

---

## Market analyst

```bash
pnpm analyst -- --coin ETH
pnpm analyst -- --coin ETH,BTC,SOL,HYPE --no-telegram
pnpm analyst -- --coin ETH --show-snapshot
```

For each coin: fetches 1d / 4h / 1h / 15m candles, computes 15 technical indicators per timeframe, builds a structured snapshot, and asks Claude Opus for a sober multi-timeframe read. Output goes to stdout (markdown) and optionally Telegram (HTML-converted, chunked).

### Indicators included

- **Trend**: EMA(20/50/200), MACD(12,26,9), ADX(14) + DI±, Ichimoku Cloud, daily SMA(200) anchor
- **Momentum**: RSI(14), Stochastic(14,3,3), MFI(14)
- **Volatility**: ATR(14), Bollinger Bands(20,2) with %b + bandwidth
- **Volume**: OBV, volumeRatio vs SMA(20)
- **Structure**: session VWAP, detected S/R levels, Donchian Channels(20), Classic daily pivot points

All indicator math has unit-test coverage; see `analyst/indicators/*.test.ts`.

### Output structure

Claude is instructed to return six sections in a fixed format: **Regime**, **Multi-Timeframe Alignment**, **Bias and Conviction**, **Key Levels**, **Setup**, **Invalidation**. Conviction is graded HIGH / MED / LOW based on cross-TF alignment and trend-strength confirmation (ADX > 25).

### Cost

Roughly **$0.60–1.00 per coin per query** at Claude Opus pricing (~30–50k input tokens + ~2–4k output). A full ETH/BTC/SOL/HYPE basket run is ~$2.40–4.00. On-demand only; there's no background scheduler.

---

## Tests

```bash
pnpm test
```

Runs all unit tests via Node's built-in test runner (`tsx --test`):

- `analyst/indicators/*.test.ts` — 51 tests covering SMA, EMA, MACD, Bollinger, Donchian, Stochastic, MFI, OBV, Pivots, ADX, Ichimoku.
- `analyst/env.test.ts` — `.env` loader edge cases.
- `src/volatilityTracker.test.ts` — body-volatility tracker (threshold boundary, signed direction, dump/hydrate, first-hydrate skip).

```bash
pnpm typecheck
```

Strict TypeScript with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`.

---

## Deployment

The live monitor is built to run on Railway via the `railway.json` Nixpacks config. State persists to a mounted volume at `/data` (set in `symbols.json` as `stateDir`). Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as Railway environment variables. The backtest and analyst CLIs are intended for local use, not deployment.

## Out of scope (explicitly)

- Order placement, signing, anything on the trading endpoints.
- WebSocket subscriptions (HTTP polling is sufficient at the cadences this tool runs).
- Per-alert deduplication on hard crashes — the window is small, but a SIGKILL between sending an alert and saving state can re-fire it on restart.
- Cross-coin state sharing — each `(coin, interval)` pair has its own state file.
