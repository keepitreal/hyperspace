import { getAnalysis } from "./client.js";
import { loadDotEnv } from "./env.js";
import { buildSnapshot } from "./snapshot.js";
import { sendAnalysisToTelegram } from "./telegram.js";

loadDotEnv();

interface ParsedArgs {
  coins: string[];
  sendTelegram: boolean;
  showSnapshot: boolean;
}

function usage(): string {
  return [
    "Usage: tsx analyst/run.ts [--coin <CSV>] [--no-telegram] [--show-snapshot]",
    "",
    "  --coin            comma-separated symbols (default: ETH)",
    "  --no-telegram     do NOT send to Telegram (stdout only)",
    "  --show-snapshot   also print the raw JSON snapshot fed to Claude",
    "",
    "Env: ANTHROPIC_API_KEY required.",
    "     TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID required when telegram is enabled.",
  ].join("\n");
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let coins: string[] = ["ETH"];
  let sendTelegram = true;
  let showSnapshot = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") continue;
    if (a === "--help" || a === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    if (a === "--no-telegram") {
      sendTelegram = false;
      continue;
    }
    if (a === "--show-snapshot") {
      showSnapshot = true;
      continue;
    }
    const next = argv[i + 1];
    if (a === "--coin") {
      if (next === undefined) throw new Error("--coin requires a value");
      coins = next.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  if (coins.length === 0) throw new Error("at least one --coin is required");
  return { coins, sendTelegram, showSnapshot };
}

async function runForCoin(
  coin: string,
  opts: { sendTelegram: boolean; showSnapshot: boolean },
): Promise<void> {
  process.stderr.write(`\n[${coin}] fetching multi-timeframe candles...\n`);
  const snapshot = await buildSnapshot({ coin });

  if (opts.showSnapshot) {
    process.stdout.write(`\n--- snapshot for ${coin} ---\n`);
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  }

  process.stderr.write(`[${coin}] calling Claude...\n`);
  const result = await getAnalysis(snapshot);
  process.stderr.write(
    `[${coin}] response received (model=${result.model}, in=${result.inputTokens}, out=${result.outputTokens})\n`,
  );

  process.stdout.write(`\n=== ${coin} ===\n`);
  process.stdout.write(`${result.text}\n`);

  if (opts.sendTelegram) {
    process.stderr.write(`[${coin}] sending to Telegram...\n`);
    await sendAnalysisToTelegram({
      coin,
      analysisMarkdown: result.text,
      generatedAt: snapshot.generatedAt,
    });
    process.stderr.write(`[${coin}] telegram sent\n`);
  }
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${msg}\n\n${usage()}\n`);
    process.exit(2);
  }

  for (const coin of args.coins) {
    try {
      await runForCoin(coin, {
        sendTelegram: args.sendTelegram,
        showSnapshot: args.showSnapshot,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.stack ?? e.message : String(e);
      process.stderr.write(`[${coin}] ERROR: ${msg}\n`);
    }
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`${msg}\n`);
  process.exit(1);
});
