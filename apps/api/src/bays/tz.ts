/**
 * Shop-local day boundaries.
 *
 * Bookings are the first thing in this codebase where the date boundary is
 * load-bearing: "today's bookings" must mean the shop's today. The API runs on
 * Railway in UTC, so `new Date().setHours(0,0,0,0)` — what the reports code
 * does — lands 7 hours off for a Thai shop. Timestamps are stored as proper UTC
 * instants; only the day *windowing* needs the offset.
 */
export const SHOP_TZ_OFFSET_MINUTES = 420; // Asia/Bangkok, UTC+7, no DST

const DAY_MS = 24 * 60 * 60 * 1000;

/** True for a well-formed YYYY-MM-DD that is also a real calendar date. */
export function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * The UTC instants bounding a shop-local day, as a half-open [start, end).
 * `dayRangeUtc('2026-07-28')` → 2026-07-27T17:00Z .. 2026-07-28T17:00Z.
 */
export function dayRangeUtc(date: string): { start: Date; end: Date } {
  const midnightUtc = new Date(`${date}T00:00:00.000Z`).getTime();
  const start = new Date(midnightUtc - SHOP_TZ_OFFSET_MINUTES * 60_000);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** The shop-local calendar date of an instant, as YYYY-MM-DD. */
export function shopDateString(instant: Date): string {
  return new Date(instant.getTime() + SHOP_TZ_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The shop-local wall-clock time of an instant, as HH:MM — for error messages
 * that name a time back to staff. `toLocaleTimeString` would use the server's
 * timezone, which is UTC on Railway, and quote a time 7 hours off.
 */
export function shopTimeString(instant: Date): string {
  return new Date(instant.getTime() + SHOP_TZ_OFFSET_MINUTES * 60_000)
    .toISOString()
    .slice(11, 16);
}
