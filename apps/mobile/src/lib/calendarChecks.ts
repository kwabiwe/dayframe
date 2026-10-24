import { listCheckOverlaps, type ListCheck } from "@dayframe/shared";

/**
 * The latest day, today or before, whose Calendar › List shows a "?" by the List's own rule (location v4
 * step 14): where the evening reminder opens. Every loaded suggestion counts, however old (Codex r3 on #573);
 * future-only or untimed suggestions have no such day: null then.
 */
export function latestCheckDay(checks: readonly ListCheck[], today: Date, options: { dayKey: (date: Date) => string }): string | null {
  const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nextDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  const todayStart = dayStart(today);
  let latest: Date | null = null;
  for (const check of checks) {
    if (!check.startedAt) continue;
    const startMs = Date.parse(check.startedAt);
    if (!Number.isFinite(startMs)) continue;
    const endMs = check.stoppedAt ? Date.parse(check.stoppedAt) : startMs + 1;
    // The last day it reaches, no later than today; then confirm by the List's rule.
    let day = dayStart(new Date(Math.max(startMs, endMs - 1)));
    if (day.getTime() > todayStart.getTime()) day = todayStart;
    if (!listCheckOverlaps(check, day.getTime(), nextDay(day).getTime())) continue;
    if (!latest || day.getTime() > latest.getTime()) latest = day;
  }
  return latest ? options.dayKey(latest) : null;
}
