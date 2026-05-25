import { promises as fs } from "node:fs";
import { dirname } from "node:path";
import type { Interval, Setup, SetupState } from "./types.js";

const FILE_VERSION = 1 as const;

export interface PersistedState {
  version: typeof FILE_VERSION;
  coin: string;
  interval: Interval;
  lastProcessedOpenTs: number;
  setups: Setup[];
  /** wall-clock ms when the file was written, for diagnostics */
  savedAt: number;
}

export interface PersistLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export class JsonStateStore {
  constructor(
    private readonly filepath: string,
    private readonly log: PersistLogger,
  ) {}

  async load(opts: { coin: string; interval: Interval }): Promise<PersistedState | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filepath, "utf8");
    } catch (e) {
      if (isNotFound(e)) return null;
      this.log.warn(`state: failed to read ${this.filepath}: ${describe(e)}`);
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      this.log.warn(`state: ${this.filepath} is not valid JSON; starting fresh: ${describe(e)}`);
      return null;
    }

    const validated = validatePersisted(parsed);
    if (validated === null) {
      this.log.warn(`state: ${this.filepath} has unexpected shape; starting fresh`);
      return null;
    }

    if (validated.coin !== opts.coin || validated.interval !== opts.interval) {
      this.log.warn(
        `state: ${this.filepath} is for ${validated.coin} ${validated.interval}, current run is ${opts.coin} ${opts.interval}; starting fresh`,
      );
      return null;
    }

    return validated;
  }

  async save(state: Omit<PersistedState, "version" | "savedAt">): Promise<void> {
    const full: PersistedState = {
      version: FILE_VERSION,
      savedAt: Date.now(),
      ...state,
    };
    const json = JSON.stringify(full, null, 2);
    const dir = dirname(this.filepath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (e) {
      this.log.error(`state: failed to ensure directory ${dir}: ${describe(e)}`);
      return;
    }

    const tmp = `${this.filepath}.tmp`;
    try {
      await fs.writeFile(tmp, json, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tmp, this.filepath);
    } catch (e) {
      this.log.error(`state: failed to write ${this.filepath}: ${describe(e)}`);
      await fs.unlink(tmp).catch(() => {});
    }
  }
}

function isNotFound(e: unknown): boolean {
  return (
    e !== null &&
    typeof e === "object" &&
    "code" in e &&
    (e as { code: unknown }).code === "ENOENT"
  );
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function validatePersisted(x: unknown): PersistedState | null {
  if (typeof x !== "object" || x === null) return null;
  const obj = x as Record<string, unknown>;
  if (obj["version"] !== FILE_VERSION) return null;
  if (typeof obj["coin"] !== "string") return null;
  if (typeof obj["interval"] !== "string") return null;
  if (typeof obj["lastProcessedOpenTs"] !== "number") return null;
  if (!Array.isArray(obj["setups"])) return null;
  const savedAt = obj["savedAt"];
  if (typeof savedAt !== "number") return null;

  const setups: Setup[] = [];
  for (const s of obj["setups"]) {
    const v = validateSetup(s);
    if (v === null) return null;
    setups.push(v);
  }

  return {
    version: FILE_VERSION,
    coin: obj["coin"],
    interval: obj["interval"] as Interval,
    lastProcessedOpenTs: obj["lastProcessedOpenTs"],
    setups,
    savedAt,
  };
}

function validateSetup(x: unknown): Setup | null {
  if (typeof x !== "object" || x === null) return null;
  const obj = x as Record<string, unknown>;
  const level = obj["level"];
  if (typeof level !== "object" || level === null) return null;
  const lvl = level as Record<string, unknown>;
  if (lvl["side"] !== "support" && lvl["side"] !== "resistance") return null;
  if (typeof lvl["price"] !== "number") return null;
  if (typeof lvl["touches"] !== "number") return null;
  if (typeof lvl["lastTouchTs"] !== "number") return null;

  const stateOk =
    obj["state"] === "IDLE" ||
    obj["state"] === "BROKEN" ||
    obj["state"] === "RETESTING" ||
    obj["state"] === "CONFIRMED" ||
    obj["state"] === "INVALIDATED" ||
    obj["state"] === "EXPIRED";
  if (!stateOk) return null;
  if (typeof obj["primed"] !== "boolean") return null;
  if (!isNullableNumber(obj["breakoutTs"])) return null;
  if (!isNullableNumber(obj["breakoutClose"])) return null;
  if (typeof obj["barsSinceBreakout"] !== "number") return null;
  if (!isNullableNumber(obj["retestStartTs"])) return null;
  if (typeof obj["cooldownBars"] !== "number") return null;

  return {
    level: {
      side: lvl["side"],
      price: lvl["price"],
      touches: lvl["touches"],
      lastTouchTs: lvl["lastTouchTs"],
    },
    state: obj["state"] as SetupState,
    primed: obj["primed"],
    breakoutTs: obj["breakoutTs"] as number | null,
    breakoutClose: obj["breakoutClose"] as number | null,
    barsSinceBreakout: obj["barsSinceBreakout"],
    retestStartTs: obj["retestStartTs"] as number | null,
    cooldownBars: obj["cooldownBars"],
  };
}

function isNullableNumber(x: unknown): boolean {
  return x === null || typeof x === "number";
}
