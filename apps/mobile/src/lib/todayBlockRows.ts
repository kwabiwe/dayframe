import { formatClockTime, formatDuration, type ClockFormat } from "@dayframe/shared";
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

/** A block's display name everywhere it is listed: its description, else its activity. */
export function rowTitle(entry: Pick<RowEntry, "description" | "categoryName">) {
  return displayTimerDescription(entry)?.trim() || entry.categoryName || "No activity";
}

function clock(iso: string | null, nowMs: number, clockFormat: ClockFormat) {
  const date = new Date(iso ?? nowMs);
  if (Number.isNaN(date.getTime())) return "--:--";
  return formatClockTime(date, clockFormat);
}

/** "08:13–10:00" ("8:13 AM–10:00 AM"), or "09:00–now" while the entry runs. */
export function rowTimeRange(entry: RowEntry, nowMs: number, clockFormat: ClockFormat) {
  return `${clock(entry.startedAt, nowMs, clockFormat)}–${entry.stoppedAt ? clock(entry.stoppedAt, nowMs, clockFormat) : "now"}`;
}

/**
 * The activity for the meta line, or null when the row's title already is the activity (a block
 * without a description), so "Exercise" is not repeated under "Exercise" (UIA-041).
 */
function metaActivity(entry: RowEntry) {
  if (!entry.categoryName) return null;
  return displayTimerDescription(entry)?.trim() ? entry.categoryName : null;
}

/** A row's title: a named pattern's name (location v3 PR 14), else its block's display name. */
export function groupTitle(group: HistoryEntryGroup) {
  return group.name ?? rowTitle(group.representative.entry);
}

/** A named pattern's whole time: its first part's start to its last part's end. */
function namedSpan(group: HistoryEntryGroup, nowMs: number, clockFormat: ClockFormat, separator: string) {
  const starts = group.entries.map(({ entry }) => entry.startedAt).sort();
  const stops = group.entries.map(({ entry }) => entry.stoppedAt ?? "").sort();
  return `${clock(starts[0] ?? null, nowMs, clockFormat)}${separator}${clock(stops.at(-1) || null, nowMs, clockFormat)}`;
}

/** The row's second line: time, how many repeats a group holds, then the activity. */
export function rowMeta(group: HistoryEntryGroup, nowMs: number, clockFormat: ClockFormat) {
  const { entry } = group.representative;
  if (group.name) return `${namedSpan(group, nowMs, clockFormat, "–")} · ${group.entries.length} parts`;
  return [
    rowTimeRange(entry, nowMs, clockFormat),
    group.entries.length > 1 ? `${group.entries.length} blocks` : null,
    metaActivity(entry),
  ].filter(Boolean).join(" · ");
}

/**
 * What VoiceOver reads for a row: the visible title and meta, with times read "09:00 to 10:00" and
 * the place and tags that the row does not show, so rows that look alike still sound different.
 */
export function rowSpokenLabel(group: HistoryEntryGroup, nowMs: number, clockFormat: ClockFormat, { omitCount = false } = {}) {
  const { entry } = group.representative;
  if (group.name) {
    return [
      group.name,
      namedSpan(group, nowMs, clockFormat, " to "),
      omitCount ? null : `${group.entries.length} parts`,
      // Oldest first, as the trip happened.
      [...group.entries].reverse().map(({ entry: part }) => rowTitle(part)).join(", then "),
    ].filter(Boolean).join(", ");
  }
  const tags = entry.tagNames ?? entry.tags?.map((tag) => tag.name) ?? [];
  return [
    rowTitle(entry),
    `${clock(entry.startedAt, nowMs, clockFormat)} to ${entry.stoppedAt ? clock(entry.stoppedAt, nowMs, clockFormat) : "now"}`,
    group.entries.length > 1 && !omitCount ? `${group.entries.length} blocks` : null,
    metaActivity(entry),
    entry.placeName ? `at ${entry.placeName}` : null,
    tags.length ? `tags: ${tags.join(", ")}` : null,
  ].filter(Boolean).join(", ");
}

/**
 * "4h 12m", "35m" or "<1m" (the shared `formatDuration`). A recorded block always took some time,
 * so anything under a minute, including a block stopped in the same second, reads "<1m" (UIA-041).
 */
export function rowDuration(seconds: number) {
  if (Number.isFinite(seconds) && seconds >= 0 && seconds < 60) return "<1m";
  return formatDuration(seconds);
}

/** A row can start again only with something to start: an activity or a description. */
export function canStartAgain(entry: RowEntry) {
  return Boolean(entry.categoryId || displayTimerDescription(entry)?.trim());
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
