import type { HistoryEntryGroup } from "./historyPresentation";
import { displayTimerDescription } from "./timerPresentation";

/**
 * Today's blocks rows (Blocks prototype): each row's activity block is as tall as its time, so a
 * long block reads as long at a glance. 18 points plus 22 per hour, between 24 and 56 points.
 */
export const ROW_BLOCK = { minHeight: 24, maxHeight: 56, base: 18, perHour: 22, width: 34 } as const;

/** How far a row must travel before releasing it starts the block again (right) or deletes it (left). */
export const ROW_SWIPE_COMMIT = 96;

export function rowBlockHeight(seconds: number) {
  const hours = Math.max(0, seconds) / 3600;
  return Math.round(Math.min(ROW_BLOCK.maxHeight, Math.max(ROW_BLOCK.minHeight, ROW_BLOCK.base + hours * ROW_BLOCK.perHour)));
}

type RowEntry = HistoryEntryGroup["representative"]["entry"];

export function rowTitle(entry: RowEntry) {
  return displayTimerDescription(entry)?.trim() || entry.categoryName || "No activity";
}

function clock(iso: string | null, nowMs: number) {
  const date = new Date(iso ?? nowMs);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** "08:13–10:00", or "09:00–now" while the entry runs. */
export function rowTimeRange(entry: RowEntry, nowMs: number) {
  return `${clock(entry.startedAt, nowMs)}–${entry.stoppedAt ? clock(entry.stoppedAt, nowMs) : "now"}`;
}

/** The row's second line: time, how many repeats a group holds, then the activity. */
export function rowMeta(group: HistoryEntryGroup, nowMs: number) {
  const { entry } = group.representative;
  return [
    rowTimeRange(entry, nowMs),
    group.entries.length > 1 ? `${group.entries.length} entries` : null,
    entry.categoryName ?? null,
  ].filter(Boolean).join(" · ");
}

/** "4h 12m", "35m" or "0m". */
export function rowDuration(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** A row can start again only with something to start: an activity or a description. */
export function canStartAgain(entry: RowEntry) {
  return Boolean(entry.categoryId || entry.description?.trim());
}

/** Swipe Delete only for stopped time; a running entry is stopped first. */
export function canDeleteGroup(group: HistoryEntryGroup) {
  return group.entries.every(({ entry }) => Boolean(entry.stoppedAt));
}

/** "N · swipe a row", counting entries rather than grouped rows, as the prototype does. */
export function todayBlocksCaption(groups: readonly HistoryEntryGroup[]) {
  const count = groups.reduce((sum, group) => sum + group.entries.length, 0);
  return `${count} · swipe a row`;
}
