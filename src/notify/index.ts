import type { Alert, AlertKind } from "../types.js";
import { ConsoleNotifier } from "./console.js";
import { TelegramNotifier } from "./telegram.js";

export interface Notifier {
  readonly name: string;
  send(alert: Alert): Promise<void>;
}

export interface NotifyLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const DEFAULT_REMOTE_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>([
  "BREAKOUT",
  "RETEST_START",
  "CONFIRMED",
  "RSI_OVERBOUGHT",
  "RSI_OVERSOLD",
]);

const ALL_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>([
  "BREAKOUT",
  "RETEST_START",
  "CONFIRMED",
  "INVALIDATED",
  "EXPIRED",
  "RSI_OVERBOUGHT",
  "RSI_OVERSOLD",
]);

function parseKinds(raw: string | undefined, log: NotifyLogger): ReadonlySet<AlertKind> {
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_REMOTE_KINDS;
  const out = new Set<AlertKind>();
  for (const tok of raw.split(",")) {
    const k = tok.trim().toUpperCase();
    if (k.length === 0) continue;
    if (ALL_KINDS.has(k as AlertKind)) {
      out.add(k as AlertKind);
    } else {
      log.warn(`HYPERSPACE_ALERT_KINDS: ignoring unknown kind "${tok.trim()}"`);
    }
  }
  if (out.size === 0) {
    log.warn("HYPERSPACE_ALERT_KINDS resolved to empty set; falling back to defaults");
    return DEFAULT_REMOTE_KINDS;
  }
  return out;
}

/** Wraps a notifier with an alert-kind allowlist. */
class FilteredNotifier implements Notifier {
  readonly name: string;
  constructor(
    private readonly inner: Notifier,
    private readonly kinds: ReadonlySet<AlertKind>,
  ) {
    this.name = `${inner.name}[filtered]`;
  }
  async send(alert: Alert): Promise<void> {
    if (!this.kinds.has(alert.kind)) return;
    await this.inner.send(alert);
  }
}

/** Broadcasts to all child notifiers; one driver's failure does not affect siblings. */
class MultiNotifier implements Notifier {
  readonly name = "multi";
  constructor(
    private readonly children: readonly Notifier[],
    private readonly log: NotifyLogger,
  ) {}
  async send(alert: Alert): Promise<void> {
    if (this.children.length === 0) return;
    const results = await Promise.allSettled(this.children.map((c) => c.send(alert)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r === undefined || r.status !== "rejected") continue;
      const child = this.children[i];
      const childName = child !== undefined ? child.name : "<unknown>";
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      this.log.error(`notifier "${childName}" failed: ${msg}`);
    }
  }
  describe(): string {
    return this.children.map((c) => c.name).join(", ");
  }
}

export interface NotifyDeps {
  log: NotifyLogger;
  env?: NodeJS.ProcessEnv;
}

/**
 * Build a notifier from environment variables. Console is always included
 * and unfiltered. Telegram is opt-in via TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 * and respects HYPERSPACE_ALERT_KINDS (default: BREAKOUT, RETEST_START, CONFIRMED).
 */
export function buildNotifier(deps: NotifyDeps): MultiNotifier {
  const env = deps.env ?? process.env;
  const log = deps.log;

  const drivers: Notifier[] = [new ConsoleNotifier(log)];

  const tgToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const tgChatId = env.TELEGRAM_CHAT_ID?.trim();
  if (tgToken !== undefined && tgToken.length > 0 && tgChatId !== undefined && tgChatId.length > 0) {
    const remoteKinds = parseKinds(env.HYPERSPACE_ALERT_KINDS, log);
    const tg = new TelegramNotifier({ token: tgToken, chatId: tgChatId, log });
    drivers.push(new FilteredNotifier(tg, remoteKinds));
    log.info(
      `notifier: telegram enabled (chat ${maskChatId(tgChatId)}, kinds=${[...remoteKinds].join(",")})`,
    );
  } else if (tgToken !== undefined || tgChatId !== undefined) {
    log.warn(
      "notifier: telegram partially configured; need both TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID",
    );
  }

  return new MultiNotifier(drivers, log);
}

function maskChatId(chatId: string): string {
  if (chatId.length <= 4) return "***";
  return `***${chatId.slice(-4)}`;
}
