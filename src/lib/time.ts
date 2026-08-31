/** Epoch milliseconds — the only time representation stored locally (see db/schema.ts). */
export function now(): number {
  return Date.now();
}

export const DAY_MS = 86_400_000;

export function daysAgo(days: number): number {
  return Date.now() - days * DAY_MS;
}

/** Start of the current day in local time — the boundary the daily crawl cap uses (§7.3). */
export function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
