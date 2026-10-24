import { listCheckOverlaps, type ListCheck } from "@dayframe/shared";

/**
 * The latest day, from today back, whose Calendar › List shows a "?" by the List's own rule (location v4
 * step 14): where the evening reminder opens. Future-only suggestions have no such day; null then.
 */
export function latestCheckDay(
  checks: readonly ListCheck[],
  today: Date,
  options: { daysBack?: number; dayKey: (date: Date) => string }
): string | null {
  const daysBack = options.daysBack ?? 60;
  const timed = checks.filter((check) => check.startedAt);
  if (!timed.length) return null;
  for (let back = 0; back <= daysBack; back += 1) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back + 1);
    if (timed.some((check) => listCheckOverlaps(check, start.getTime(), end.getTime()))) return options.dayKey(start);
  }
  return null;
}
