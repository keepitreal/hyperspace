import { bucketFor } from "../quality.js";
import type { Alert } from "../types.js";
import type { Notifier, NotifyLogger } from "./index.js";

const TELEGRAM_API_BASE = "https://api.telegram.org";

export interface TelegramOptions {
  token: string;
  chatId: string;
  log: NotifyLogger;
  /** Override fetch for testing. */
  fetchImpl?: typeof fetch;
}

interface TelegramErrorBody {
  ok: false;
  error_code: number;
  description: string;
  parameters?: { retry_after?: number };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  return price.toPrecision(5);
}

function fmtBps(bps: number): string {
  const sign = bps >= 0 ? "+" : "";
  return `${sign}${(bps / 100).toFixed(2)}%`;
}

function fmtBreakdownEntry(name: string, value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${name} ${sign}${value}`;
}

export function formatTelegramMessage(alert: Alert): string {
  const coin = escapeHtml(alert.coin);
  const interval = escapeHtml(alert.interval);
  const headline = `<b>${escapeHtml(alert.kind)}</b>  ${coin} ${interval}`;
  const lines: string[] = [headline];
  if (alert.kind === "RSI_OVERBOUGHT" || alert.kind === "RSI_OVERSOLD") {
    const rsi = alert.rsiValue !== undefined ? alert.rsiValue.toFixed(1) : "n/a";
    lines.push(`RSI <b>${rsi}</b>`);
    lines.push(`px ${fmtPrice(alert.price)}`);
    return lines.join("\n");
  }
  if (alert.kind === "VOLATILITY_SPIKE") {
    const pctRaw = alert.volatilityPct;
    const pctStr = pctRaw !== undefined ? `${(pctRaw * 100).toFixed(2)}%` : "n/a";
    lines.push(`range <b>${escapeHtml(pctStr)}</b>`);
    const hi = alert.candleHigh !== undefined ? `H ${fmtPrice(alert.candleHigh)}` : "";
    const lo = alert.candleLow !== undefined ? `L ${fmtPrice(alert.candleLow)}` : "";
    if (hi.length > 0 || lo.length > 0) {
      lines.push([hi, lo].filter((s) => s.length > 0).join("  "));
    }
    const closeDir = alert.side === "resistance" ? "up" : "down";
    lines.push(`close ${fmtPrice(alert.price)} (${escapeHtml(closeDir)})`);
    return lines.join("\n");
  }
  const side = escapeHtml(alert.side);
  lines.push(`${side} <b>${fmtPrice(alert.levelPrice)}</b>`);
  lines.push(`px ${fmtPrice(alert.price)} (${fmtBps(alert.bpsFromLevel)})`);
  if (alert.confidence !== undefined) {
    const bucket = bucketFor(alert.confidence);
    lines.push(`confidence <b>${alert.confidence}/100</b> ${bucket}`);
    if (alert.confidenceBreakdown !== undefined) {
      const parts = Object.entries(alert.confidenceBreakdown)
        .map(([k, v]) => fmtBreakdownEntry(k, v))
        .join(", ");
      lines.push(`<i>${escapeHtml(parts)}</i>`);
    }
  }
  if (alert.kind === "CONFIRMED" || alert.kind === "EXPIRED") {
    lines.push(`<i>${alert.barsSinceBreakout} bars since breakout</i>`);
  }
  return lines.join("\n");
}

export class TelegramNotifier implements Notifier {
  readonly name = "telegram";
  private readonly token: string;
  private readonly chatId: string;
  private readonly log: NotifyLogger;
  private readonly fetchImpl: typeof fetch;
  private warnedConfigError = false;

  constructor(opts: TelegramOptions) {
    this.token = opts.token;
    this.chatId = opts.chatId;
    this.log = opts.log;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async send(alert: Alert): Promise<void> {
    const text = formatTelegramMessage(alert);
    const body = {
      chat_id: this.chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      disable_notification: false,
    };
    const url = `${TELEGRAM_API_BASE}/bot${this.token}/sendMessage`;

    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (e) {
        if (attempt === maxAttempts) {
          const msg = e instanceof Error ? e.message : String(e);
          this.log.error(`telegram: network error after ${attempt} attempts: ${msg}`);
          return;
        }
        await sleep(this.backoffMs(attempt));
        continue;
      }

      if (res.ok) return;

      const errBody = await res.json().catch(() => null) as TelegramErrorBody | null;
      const status = res.status;
      const description = errBody?.description ?? `HTTP ${status}`;

      if (status === 401 || status === 403 || status === 400 || status === 404) {
        if (!this.warnedConfigError) {
          this.log.error(
            `telegram: configuration error (${status}): ${description}. Will not retry until restart.`,
          );
          this.warnedConfigError = true;
        }
        return;
      }

      if (status === 429) {
        const retryAfter = errBody?.parameters?.retry_after;
        const waitMs =
          retryAfter !== undefined && retryAfter > 0
            ? Math.min(60_000, retryAfter * 1000)
            : this.backoffMs(attempt);
        if (attempt === maxAttempts) {
          this.log.warn(
            `telegram: rate-limited (429) after ${attempt} attempts: ${description}. Dropping alert.`,
          );
          return;
        }
        await sleep(waitMs);
        continue;
      }

      if (status >= 500 && status < 600) {
        if (attempt === maxAttempts) {
          this.log.warn(
            `telegram: upstream error ${status} after ${attempt} attempts: ${description}. Dropping alert.`,
          );
          return;
        }
        await sleep(this.backoffMs(attempt));
        continue;
      }

      this.log.error(`telegram: unexpected status ${status}: ${description}`);
      return;
    }
  }

  private backoffMs(attempt: number): number {
    return Math.min(8_000, 250 * 2 ** (attempt - 1));
  }
}
