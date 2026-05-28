const TELEGRAM_API_BASE = "https://api.telegram.org";
const MAX_MESSAGE_LEN = 4000;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Minimal markdown → Telegram HTML. Handles ## headers, **bold**, `code`,
 * and bullets. Anything not understood is preserved as escaped text.
 */
export function markdownToTelegramHtml(md: string): string {
  const escaped = escapeHtml(md);
  return escaped
    .replace(/^## (.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/^- /gm, "• ");
}

/**
 * Split text into chunks no larger than `MAX_MESSAGE_LEN`. Prefers boundaries
 * at "\n\n" (paragraph), then "\n", then a hard slice.
 */
export function chunk(text: string, max = MAX_MESSAGE_LEN): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

export interface SendTelegramArgs {
  coin: string;
  analysisMarkdown: string;
  generatedAt: string;
  /** Inject for tests. */
  fetchImpl?: typeof fetch;
}

export async function sendAnalysisToTelegram(args: SendTelegramArgs): Promise<void> {
  const token = process.env["TELEGRAM_BOT_TOKEN"]?.trim();
  const chatId = process.env["TELEGRAM_CHAT_ID"]?.trim();
  if (token === undefined || token.length === 0 || chatId === undefined || chatId.length === 0) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set to send to Telegram",
    );
  }

  const ts = args.generatedAt.replace("T", " ").slice(0, 16);
  const header = `<b>${escapeHtml(args.coin)} analysis</b> · ${escapeHtml(ts)} UTC\n\n`;
  const body = markdownToTelegramHtml(args.analysisMarkdown);
  const full = header + body;

  const fetchImpl = args.fetchImpl ?? fetch;
  const url = `${TELEGRAM_API_BASE}/bot${token}/sendMessage`;
  const parts = chunk(full);

  for (const part of parts) {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: part,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Telegram API ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
    }
  }
}
