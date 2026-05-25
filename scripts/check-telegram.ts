/**
 * Quick smoke test: send a single fake alert through the Telegram driver
 * and verify it (a) does not throw on bogus credentials, (b) logs the
 * configuration error once. Run with:
 *
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=... tsx scripts/check-telegram.ts
 *
 * If you pass real credentials you should see a real Telegram message;
 * if you pass bogus ones you should see a single error log line and
 * the script should exit 0.
 */
import { TelegramNotifier } from "../src/notify/telegram.js";
import type { Alert } from "../src/types.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
if (token === undefined || chatId === undefined) {
  process.stderr.write("Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID before running.\n");
  process.exit(1);
}

const log = {
  info: (m: string) => process.stdout.write(`[info] ${m}\n`),
  warn: (m: string) => process.stdout.write(`[warn] ${m}\n`),
  error: (m: string) => process.stderr.write(`[error] ${m}\n`),
};

const notifier = new TelegramNotifier({ token, chatId, log });

const fakeAlert: Alert = {
  kind: "CONFIRMED",
  ts: Date.now(),
  coin: "BTC",
  interval: "15m",
  side: "resistance",
  levelPrice: 70000,
  price: 70123.45,
  bpsFromLevel: 17.6,
  barsSinceBreakout: 2,
};

log.info("sending fake CONFIRMED alert via Telegram driver...");
await notifier.send(fakeAlert);
log.info("send completed without throwing");
