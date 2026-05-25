# hyperspace

A small read-only TypeScript CLI that polls [Hyperliquid](https://hyperliquid.xyz) candle data, auto-detects support and resistance levels from swing pivots, and runs a breakout-and-retest state machine against them. Alerts are printed to the console.

This tool does **not** place trades. It does not sign anything. It only reads from the public `/info` endpoint.

## Requirements

- Node.js >= 20 (for native `fetch`)
- `pnpm` (configured via the `packageManager` field; `corepack enable` will pick it up)

## Install

```bash
pnpm install
```

## Run

```bash
pnpm start --coin BTC --interval 15m --lookback 300
```

The process polls in a loop until you `Ctrl+C` it.

## Flags

| Flag | Default | Description |
| --- | --- | --- |
| `--coin` | _required_ | Hyperliquid coin symbol, e.g. `BTC`, `ETH`, `SOL`. |
| `--interval` | `15m` | One of: `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `8h`, `12h`, `1d`, `3d`, `1w`, `1M`. |
| `--lookback` | `300` | Number of recent candles to keep in the rolling window. |
| `--poll-ms` | `intervalMs / 3` (cap 60s) | How often to refresh data. |
| `--pivot-window` | `5` | Bars on each side required for a swing-pivot high/low. |
| `--cluster-bps` | `25` | Tolerance (basis points) for merging nearby pivots into a single level. `25` = 0.25%. |
| `--break-bps` | `10` | How far past a level a close must travel to count as a breakout. |
| `--retest-bps` | `15` | Tolerance for price returning to the level. |
| `--retest-bars` | `20` | Maximum bars after a breakout before the setup expires. |
| `--max-levels` | `8` | Top-K levels to keep per side, ranked by touch count then recency. |
| `--state-file` | _off_ | Path to a JSON state file. When set, in-flight setups (BROKEN/RETESTING) survive restarts. |
| `--max-replay-bars` | `50` | Cap on replay after a long outage. If the persisted cursor is older than this many bars, fast-forward instead of replaying. |

## Notifications

The CLI always prints alerts to the console. To also push them to your phone,
configure a remote notifier via environment variables.

### Telegram

Free, real push notifications, ~10 minutes of setup.

1. Open Telegram and message [@BotFather](https://t.me/BotFather), run `/newbot`,
   follow the prompts. Save the bot token it returns.
2. Send any message to your new bot once so it can DM you back.
3. Hit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser. Find
   `"chat":{"id": <NUMBER>, ...}` in the JSON - that's your chat ID.
4. Export both values in the shell that runs the CLI (or copy `.env.example`
   to `.env` and fill it in - but make sure your runtime loads it):

   ```bash
   export TELEGRAM_BOT_TOKEN=123456:abcdef...
   export TELEGRAM_CHAT_ID=987654321
   pnpm start --coin BTC --interval 15m --lookback 300
   ```

On startup you should see a line like
`notifier: telegram enabled (chat ***4321, kinds=BREAKOUT,RETEST_START,CONFIRMED)`.

To verify your bot/chat configuration is live before relying on it, run:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... pnpm check:telegram
```

That sends one synthetic `CONFIRMED` alert through the Telegram driver. With
real credentials you should see the message in Telegram. With bogus
credentials the script logs a single configuration error and exits cleanly.

### Environment variables

| Var | Required for | Description |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram | Bot token from `@BotFather`. |
| `TELEGRAM_CHAT_ID` | Telegram | Numeric chat ID for the recipient. |
| `HYPERSPACE_ALERT_KINDS` | optional | Comma-separated kinds sent to remote notifiers. Default: `BREAKOUT,RETEST_START,CONFIRMED`. Console is unaffected and always shows everything. Valid kinds: `BREAKOUT, RETEST_START, CONFIRMED, INVALIDATED, EXPIRED`. |

Notifier failures (network errors, rate limits, bad config) are logged but do
**not** crash the poll loop or interfere with other notifiers. If Telegram
returns a permanent configuration error (`401`, `403`, `400`, `404`) the
process logs it once and stops retrying that channel until restart.

## What an alert looks like

```
[2026-05-23 21:09:14] BTC 15m  px=68421.30  levels: R 68900(x4) 69500(x3) | S 67800(x5) 67100(x3)
[2026-05-23 21:09:14] BREAKOUT     BTC 15m  resistance 68900  close 69015 (+0.17%)
[2026-05-23 21:24:01] RETEST_START BTC 15m  resistance 68900  px 68941
[2026-05-23 21:39:00] CONFIRMED    BTC 15m  resistance 68900  close 69180  setup age 2 bars
```

`CONFIRMED` is the headline event - that is the breakout-and-retest the tool is monitoring for. The other events are progress markers along the way.

## How it works

1. **Fetch.** Each poll posts `{ type: "candleSnapshot", req: { coin, interval, startTime, endTime } }` to `https://api.hyperliquid.xyz/info` and parses string OHLCV values to numbers.
2. **Levels.** Swing pivot highs/lows are detected over the closed window, then nearby pivots are clustered within `--cluster-bps` to form a small set of resistance/support levels.
3. **Setups.** Each level runs a state machine: `IDLE -> BROKEN -> RETESTING -> CONFIRMED` (or `INVALIDATED` / `EXPIRED`). State transitions emit alerts.
4. **Loop.** Breakouts are evaluated only on closed candles to avoid repaint; retest proximity is checked against the in-progress candle for promptness; confirmation requires a closed candle.

## State persistence

By default the tool runs entirely in-memory: every restart starts with no
prior knowledge, and any in-flight `BROKEN` or `RETESTING` setups are lost.
The priming fix means restarts won't fire spurious alerts for already-broken
levels, but they *will* lose track of pending retests.

Pass `--state-file <path>` to persist the tracker's state across restarts:

```bash
pnpm start --coin BTC --interval 15m --lookback 300 --state-file ./state.json
```

What this gives you:

- In-flight setups (BROKEN, RETESTING, cooldowns) survive restarts.
- The "last processed candle" cursor is remembered so candles already
  evaluated aren't re-evaluated (and already-sent alerts aren't re-fired).
- Saves are atomic (`tmp` + `rename`).
- Saves happen after each poll that advanced the cursor, and once on
  graceful shutdown (SIGINT/SIGTERM).

What it does **not** do (v1):

- Per-alert deduplication on hard crashes. The window is small, but if the
  process is `SIGKILL`-ed mid-poll between sending an alert and saving
  state, that alert may re-fire on restart.
- Cross-coin sharing: a state file is for one `(coin, interval)` pair. If
  you change either flag, the file is detected as mismatched and a fresh
  start is logged.
- Long-outage replay: if the persisted cursor is older than
  `--max-replay-bars` (default 50), the cursor is fast-forwarded so you
  don't get a flood of alerts when starting back up after hours offline.

## Out of scope (v1)

- Multi-coin / multi-interval per process.
- Persistence across restarts (state is in-memory only).
- WebSocket subscriptions.
- Anything that writes - no order placement, no signed endpoints.
