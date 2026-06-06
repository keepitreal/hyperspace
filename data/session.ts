/**
 * US cash-session (RTH) helpers in America/New_York wall-clock, DST-correct via
 * Intl. Shared by the resampler and any session-aware analysis.
 *
 * Regular RTH is 09:30–16:00 ET. Early-close half-days end 13:00 ET, but the
 * resampler is data-driven: it filters base bars to [09:30, 16:00) and lets the
 * absence of post-13:00 data on half-days (and all data on full holidays) handle
 * itself, so no holiday calendar is needed here.
 */

export const RTH_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
export const RTH_CLOSE_MIN = 16 * 60; // 16:00 ET

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Map a UTC ms timestamp to its ET calendar date and minutes-since-ET-midnight. */
export function etParts(ms: number): { date: string; minOfDay: number } {
  const parts = ET_FMT.formatToParts(ms);
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "00";
  let hh = get("hour");
  if (hh === "24") hh = "00"; // Node's hour12:false emits "24" at midnight
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const minOfDay = Number(hh) * 60 + Number(get("minute"));
  return { date, minOfDay };
}

/** True when a bar's ET minute-of-day falls inside the regular session. */
export function isRth(minOfDay: number): boolean {
  return minOfDay >= RTH_OPEN_MIN && minOfDay < RTH_CLOSE_MIN;
}

/** ISO-8601 week key ("YYYY-Www") for an ET calendar date string. */
export function isoWeekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this ISO week
  const isoYear = d.getUTCFullYear();
  const firstThu = new Date(Date.UTC(isoYear, 0, 4));
  const firstDow = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - firstDow + 3);
  const week = 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
