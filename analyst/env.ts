import { readFileSync } from "node:fs";

/**
 * Tiny .env loader. Reads KEY=value pairs from `path` (default `.env`) and
 * sets them on process.env unless already defined. Strips surrounding single
 * or double quotes around values. Silent if the file does not exist.
 */
export function loadDotEnv(path = ".env"): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key.length === 0) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
