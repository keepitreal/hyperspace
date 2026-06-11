import type { DetectedLevels } from "./levels.js";
import { bucketFor } from "./quality.js";
import type { Alert, AlertKind, Interval, Level } from "./types.js";

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
} as const;

const useColor = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;

function colorize(text: string, code: string): string {
  return useColor ? `${code}${text}${ANSI.reset}` : text;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtTs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
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

/**
 * Signed distance of the MACD line from the zero line at the crossover, shown
 * raw (matches a charting tool) and normalized as % of price (comparable across
 * markets of very different price). e.g. "+84.20 (+0.137%)".
 */
function fmtMacdZero(line: number, price: number): string {
  const raw = `${line >= 0 ? "+" : "-"}${fmtPrice(Math.abs(line))}`;
  const pctVal = price !== 0 ? (line / price) * 100 : 0;
  const pct = `${pctVal >= 0 ? "+" : "-"}${Math.abs(pctVal).toFixed(3)}%`;
  return `${raw} (${pct})`;
}

function alertColor(kind: AlertKind): string {
  switch (kind) {
    case "BREAKOUT":
      return ANSI.yellow;
    case "RETEST_START":
      return ANSI.cyan;
    case "CONFIRMED":
      return ANSI.green;
    case "INVALIDATED":
      return ANSI.red;
    case "EXPIRED":
      return ANSI.gray;
    case "RSI_OVERBOUGHT":
      return ANSI.magenta;
    case "RSI_OVERSOLD":
      return ANSI.blue;
    case "VOLATILITY_SPIKE":
      return ANSI.yellow;
    case "MACD_CROSSOVER":
      return ANSI.cyan;
  }
}

const KIND_WIDTH = 12;

function padKind(kind: AlertKind): string {
  if (kind.length >= KIND_WIDTH) return kind;
  return kind + " ".repeat(KIND_WIDTH - kind.length);
}

function fmtSignedComponent(name: string, value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${name} ${sign}${value}`;
}

function fmtConfidence(alert: Alert): string {
  if (alert.confidence === undefined) return "";
  const bucket = bucketFor(alert.confidence);
  const head = colorize(
    `confidence ${alert.confidence}/100 ${bucket}`,
    bucket === "HIGH"
      ? ANSI.green
      : bucket === "MEDIUM"
        ? ANSI.yellow
        : bucket === "LOW"
          ? ANSI.magenta
          : ANSI.red,
  );
  if (alert.confidenceBreakdown === undefined) return head;
  const parts = Object.entries(alert.confidenceBreakdown)
    .map(([k, v]) => fmtSignedComponent(k, v))
    .join(", ");
  return `${head} ${colorize(`(${parts})`, ANSI.dim)}`;
}

export function formatAlert(alert: Alert): string {
  const ts = colorize(`[${fmtTs(alert.ts)}]`, ANSI.dim);
  const kind = colorize(colorize(padKind(alert.kind), ANSI.bold), alertColor(alert.kind));
  const meta = `${alert.coin} ${alert.interval}`;
  if (alert.kind === "RSI_OVERBOUGHT" || alert.kind === "RSI_OVERSOLD") {
    const rsi = alert.rsiValue !== undefined ? alert.rsiValue.toFixed(1) : "n/a";
    const priceStr = `px ${fmtPrice(alert.price)}`;
    return [ts, kind, meta, `RSI ${rsi}`, priceStr].join("  ");
  }
  if (alert.kind === "VOLATILITY_SPIKE") {
    const pct = alert.volatilityPct !== undefined ? (alert.volatilityPct * 100).toFixed(2) : "n/a";
    const hi = alert.candleHigh !== undefined ? `H ${fmtPrice(alert.candleHigh)}` : "";
    const lo = alert.candleLow !== undefined ? `L ${fmtPrice(alert.candleLow)}` : "";
    const closeDir = alert.side === "resistance" ? "up" : "down";
    const closeStr = `close ${fmtPrice(alert.price)} (${closeDir})`;
    return [ts, kind, meta, `range ${pct}%`, hi, lo, closeStr]
      .filter((s) => s.length > 0)
      .join("  ");
  }
  if (alert.kind === "MACD_CROSSOVER") {
    const dir = alert.macdCross ?? "n/a";
    const dirStr = colorize(dir, dir === "bullish" ? ANSI.green : ANSI.red);
    const hist = alert.macdHistogram !== undefined ? `hist ${alert.macdHistogram.toFixed(4)}` : "";
    const zero = alert.macdLine !== undefined ? `zero ${fmtMacdZero(alert.macdLine, alert.price)}` : "";
    const priceStr = `px ${fmtPrice(alert.price)}`;
    return [ts, kind, meta, dirStr, hist, zero, priceStr].filter((s) => s.length > 0).join("  ");
  }
  const sideTag = colorize(alert.side, alert.side === "resistance" ? ANSI.red : ANSI.green);
  const levelStr = `${sideTag} ${fmtPrice(alert.levelPrice)}`;
  const priceStr = `px ${fmtPrice(alert.price)} (${fmtBps(alert.bpsFromLevel)})`;
  const ageStr =
    alert.kind === "CONFIRMED" || alert.kind === "EXPIRED"
      ? colorize(`age ${alert.barsSinceBreakout}b`, ANSI.dim)
      : "";
  const confidenceStr = fmtConfidence(alert);
  return [ts, kind, meta, levelStr, priceStr, ageStr, confidenceStr]
    .filter((s) => s.length > 0)
    .join("  ");
}

export function formatStatus(args: {
  ts: number;
  coin: string;
  interval: Interval;
  price: number;
  vwap?: number | null;
  levels: DetectedLevels;
}): string {
  const ts = colorize(`[${fmtTs(args.ts)}]`, ANSI.dim);
  const px = colorize(`px=${fmtPrice(args.price)}`, ANSI.bold);
  const vwap =
    args.vwap !== undefined && args.vwap !== null
      ? colorize(`vwap=${fmtPrice(args.vwap)}`, ANSI.dim)
      : "";
  const r = formatLevelList(args.levels.resistance, ANSI.red, 4);
  const s = formatLevelList(args.levels.support, ANSI.green, 4);
  const tag = colorize(`${args.coin} ${args.interval}`, ANSI.dim);
  const head = vwap.length > 0 ? `${ts} ${tag}  ${px}  ${vwap}` : `${ts} ${tag}  ${px}`;
  return `${head}  levels: R ${r} | S ${s}`;
}

function formatLevelList(levels: readonly Level[], color: string, take: number): string {
  if (levels.length === 0) return colorize("(none)", ANSI.gray);
  return levels
    .slice(0, take)
    .map((l) => colorize(`${fmtPrice(l.price)}(x${l.touches})`, color))
    .join(" ");
}

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  alert: (a: Alert) => void;
};

export function makeLogger(): Logger {
  return {
    info(msg) {
      process.stdout.write(`${msg}\n`);
    },
    warn(msg) {
      process.stdout.write(`${colorize("[warn]", ANSI.yellow)} ${msg}\n`);
    },
    error(msg) {
      process.stderr.write(`${colorize("[error]", ANSI.red)} ${msg}\n`);
    },
    alert(a) {
      process.stdout.write(`${formatAlert(a)}\n`);
    },
  };
}

