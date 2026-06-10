const HL_INFO_URL = "https://api.hyperliquid.xyz/info";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** POST a request to the Hyperliquid /info endpoint with retry/backoff. */
async function postInfo(body: unknown, signal?: AbortSignal): Promise<unknown> {
  const maxAttempts = 4;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(HL_INFO_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const transient = res.status === 429 || res.status >= 500;
        const err = new Error(
          `Hyperliquid /info ${res.status} ${res.statusText}: ${text.slice(0, 200)}`,
        );
        if (!transient || attempt === maxAttempts) throw err;
        lastErr = err;
      } else {
        return await res.json();
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      if (attempt === maxAttempts) break;
    }
    await sleep(Math.min(8_000, 250 * 2 ** (attempt - 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error("Hyperliquid /info: unknown error");
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export interface ScanDeps {
  /** Override the /info POST for testing. */
  post?: (body: unknown, signal?: AbortSignal) => Promise<unknown>;
}

/**
 * Enumerate perp DEX names. The `perpDexs` response is an array whose first
 * element is `null` (the main/first dex, queried with no `dex` field) and whose
 * remaining elements are `{ name, ... }` builder-deployed dexes.
 */
export async function fetchPerpDexNames(deps: ScanDeps = {}, signal?: AbortSignal): Promise<string[]> {
  const post = deps.post ?? postInfo;
  const raw = await post({ type: "perpDexs" }, signal);
  if (!Array.isArray(raw)) {
    throw new Error("Hyperliquid perpDexs: expected an array");
  }
  const names: string[] = [];
  for (const entry of raw) {
    if (entry === null) {
      names.push(""); // main dex — queried with no `dex` field
    } else if (typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string") {
      names.push((entry as { name: string }).name);
    }
  }
  return names;
}

export interface MarketOi {
  coin: string;
  notionalUsd: number;
  delisted: boolean;
}

/**
 * Fetch per-asset open interest for one dex. Returns notional USD
 * (openInterest in base units × markPx) per coin. For builder dexes the
 * universe names already carry the `dex:` prefix, so they are used verbatim.
 */
export async function fetchDexOpenInterest(
  dex: string,
  deps: ScanDeps = {},
  signal?: AbortSignal,
): Promise<MarketOi[]> {
  const post = deps.post ?? postInfo;
  const body = dex.length > 0 ? { type: "metaAndAssetCtxs", dex } : { type: "metaAndAssetCtxs" };
  const raw = await post(body, signal);
  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error(`Hyperliquid metaAndAssetCtxs(${dex || "main"}): unexpected shape`);
  }
  const meta = raw[0] as { universe?: unknown };
  const ctxs = raw[1];
  const universe = meta?.universe;
  if (!Array.isArray(universe) || !Array.isArray(ctxs)) {
    throw new Error(`Hyperliquid metaAndAssetCtxs(${dex || "main"}): missing universe/ctxs`);
  }
  const out: MarketOi[] = [];
  for (let i = 0; i < universe.length; i++) {
    const u = universe[i] as { name?: unknown; isDelisted?: unknown };
    const ctx = ctxs[i] as { openInterest?: unknown; markPx?: unknown } | undefined;
    if (typeof u?.name !== "string" || ctx === undefined) continue;
    const oi = toFiniteNumber(ctx.openInterest);
    const px = toFiniteNumber(ctx.markPx);
    const notionalUsd = oi !== null && px !== null ? oi * px : 0;
    out.push({ coin: u.name, notionalUsd, delisted: u.isDelisted === true });
  }
  return out;
}

/**
 * Scan every perp market (main dex + builder dexes) and return the coins whose
 * open interest is at least `minNotionalUsd` (openInterest × markPx), excluding
 * delisted markets. Returns a sorted, de-duplicated coin list.
 */
export async function scanMarketsByOpenInterest(
  minNotionalUsd: number,
  deps: ScanDeps = {},
  signal?: AbortSignal,
): Promise<string[]> {
  const dexes = await fetchPerpDexNames(deps, signal);
  const coins = new Set<string>();
  for (const dex of dexes) {
    const markets = await fetchDexOpenInterest(dex, deps, signal);
    for (const m of markets) {
      if (!m.delisted && m.notionalUsd >= minNotionalUsd) coins.add(m.coin);
    }
  }
  return [...coins].sort();
}
