import {
  CALENDAR_BLOCK_LABEL,
  calendarBlockLabelTier,
  layoutCalendarBlockColumns,
  type ClockFormat
} from "@dayframe/shared";
import { timeEntryCategoryLabel } from "@/lib/display";
import { dateTimeLocal, formatDuration, formatTime } from "@/lib/format";

const calendarBlockVisualGapPx = 1;
const calendarBlockLaneGapPx = 1;
const calendarBlockOuterInsetPx = 8;

export const resizeDragThresholdPx = 6;

export type TimeBlockDensity = {
  canDirectResize: boolean;
  canShowInlineAction: boolean;
  /** Under 22 px: the title line uses the smaller label size. */
  isTiny: boolean;
  /** Under 34 px: one line, "Title 11m". */
  isShort: boolean;
  /** From 34 px: a detail line ("Activity · 10:45–12:30") under the title. */
  showSecondary: boolean;
};

type CalendarBlockDisplayEntry = {
  categoryName?: string | null;
  description?: string | null;
  startedAt: string;
  stoppedAt: string | null;
  tagNames: string[];
};

export type CalendarBlockPrimaryParts = {
  description: string;
  category: string | null;
  firstTag: string | null;
  hiddenTagCount: number;
};

export type TimeBlockLane = {
  laneCount: number;
  laneIndex: number;
  mode: "full" | "lane";
  offsetFraction: number;
  widthFraction: number;
  zIndex: number;
};

export function calendarBlockVisualGeometry({
  top,
  height,
  continuesIntoNextDay = false
}: {
  top: number;
  height: number;
  continuesIntoNextDay?: boolean;
}) {
  const visualGap = continuesIntoNextDay
    ? 0
    : Math.min(calendarBlockVisualGapPx, Math.max(0, height - 1));

  return {
    top,
    height: Math.max(1, height - visualGap),
    visualGap
  };
}

/**
 * A day that draws a named pattern's bracket (location v3 PR 14b) keeps a rail this wide on the
 * left of its column for the bracket and its name: all of that day's blocks, lanes included, share
 * the space right of it, so the bracket never lies under a block.
 */
export const calendarBracketRailPx = 12;

export function calendarBlockLaneInsets({
  offsetFraction,
  widthFraction
}: Pick<TimeBlockLane, "offsetFraction" | "widthFraction">, railPx = 0) {
  const before = offsetFraction * 100;
  const after = Math.max(0, (1 - offsetFraction - widthFraction) * 100);
  const innerInset = calendarBlockLaneGapPx / 2;
  // With a rail, a lane's share is of the column right of it.
  const share = (percent: number) => railPx
    ? `(100% - ${railPx}px) * ${percent / 100}`
    : `${percent}%`;

  return {
    left: before === 0
      ? calendarBlockOuterInsetPx + railPx
      : `calc(${railPx ? `${railPx}px + ` : ""}${share(before)} + ${innerInset}px)`,
    right: after === 0 ? calendarBlockOuterInsetPx : `calc(${share(after)} + ${innerInset}px)`
  };
}

export function canShowTimeBlockInlineAction({
  density,
  isCompleted,
  isResizing,
  isSelected
}: {
  density: TimeBlockDensity;
  isCompleted: boolean;
  isResizing: boolean;
  isSelected: boolean;
}) {
  return (
    isCompleted &&
    density.canShowInlineAction &&
    !isResizing &&
    !isSelected
  );
}

/** Every block is drawn at least one label line tall (location v4 C6), whatever the zoom. */
export function minimumTimeBlockHeight() {
  return CALENDAR_BLOCK_LABEL.webMinimumHeight;
}

/** What a block shows at its drawn height: always its title line, a detail line from 34 px. */
export function getTimeBlockDensity({
  durationSeconds,
  height
}: {
  durationSeconds: number;
  height: number;
}): TimeBlockDensity {
  const tier = calendarBlockLabelTier({ height, width: Number.POSITIVE_INFINITY });

  return {
    canDirectResize: height >= 48,
    canShowInlineAction: height >= 24,
    isTiny: tier.compactText,
    isShort: tier.lines === 1,
    showSecondary: durationSeconds > 0 && tier.lines === 2
  };
}

export function timeBlockDensityClassNames(density: TimeBlockDensity) {
  return [
    density.isTiny ? "is-tiny" : "",
    density.isShort ? "is-short" : "",
    density.canDirectResize ? "can-direct-resize" : "",
    density.canShowInlineAction ? "can-show-inline-action" : ""
  ];
}

export function calendarBlockPrimaryParts(entry: CalendarBlockDisplayEntry): CalendarBlockPrimaryParts {
  const description = entry.description?.trim();
  const category = timeEntryCategoryLabel(entry);
  const [firstTag, ...hiddenTags] = entry.tagNames;
  return {
    description: description || category,
    category: description ? category : null,
    firstTag: firstTag ?? null,
    hiddenTagCount: hiddenTags.length
  };
}

export function calendarBlockPrimaryLine(entry: CalendarBlockDisplayEntry) {
  const { category, description, firstTag, hiddenTagCount } = calendarBlockPrimaryParts(entry);
  const parts = [description, category].filter(Boolean);
  if (firstTag) parts.push(`#${firstTag}${hiddenTagCount ? ` +${hiddenTagCount}` : ""}`);
  return parts.join(" · ");
}

export function calendarBlockSecondaryLine(
  entry: Pick<CalendarBlockDisplayEntry, "startedAt" | "stoppedAt">,
  capturedNow: Date,
  clock: ClockFormat
) {
  const stoppedAt = entry.stoppedAt ?? capturedNow.toISOString();
  const durationSeconds = Math.max(0, Math.floor(
    (new Date(stoppedAt).getTime() - new Date(entry.startedAt).getTime()) / 1_000
  ));
  const dayOffset = localDayOffset(entry.startedAt, stoppedAt);
  const finish = entry.stoppedAt ? `${formatTime(stoppedAt, clock)}${dayOffset > 0 ? ` +${dayOffset}` : ""}` : "now";
  return `${formatDuration(durationSeconds)} (${formatTime(entry.startedAt, clock)} – ${finish})`;
}

/** The whole entry's length (a running one up to now), as its label prints it: "11m", "1h 45m". */
export function calendarBlockDurationLabel(
  entry: Pick<CalendarBlockDisplayEntry, "startedAt" | "stoppedAt">,
  capturedNow: Date
) {
  const stoppedAt = entry.stoppedAt ?? capturedNow.toISOString();
  return formatDuration(Math.max(0, Math.floor(
    (new Date(stoppedAt).getTime() - new Date(entry.startedAt).getTime()) / 1_000
  )));
}

/**
 * The detail line from 34 px (location v4 C6): "Deep work · 10:45–12:30". A block titled by its
 * activity (no description) shows the times alone; a running one ends "now".
 */
export function calendarBlockDetailLine(
  entry: CalendarBlockDisplayEntry,
  capturedNow: Date,
  clock: ClockFormat
) {
  const { category } = calendarBlockPrimaryParts(entry);
  const stoppedAt = entry.stoppedAt ?? capturedNow.toISOString();
  const dayOffset = localDayOffset(entry.startedAt, stoppedAt);
  const finish = entry.stoppedAt ? `${formatTime(stoppedAt, clock)}${dayOffset > 0 ? ` +${dayOffset}` : ""}` : "now";
  const times = `${formatTime(entry.startedAt, clock)}–${finish}`;
  return category ? `${category} · ${times}` : times;
}

function localDayOffset(startedAt: string, stoppedAt: string) {
  const start = dateTimeLocal(startedAt).slice(0, 10);
  const finish = dateTimeLocal(stoppedAt).slice(0, 10);
  const startDate = Date.parse(`${start}T00:00:00Z`);
  const finishDate = Date.parse(`${finish}T00:00:00Z`);
  return Math.max(0, Math.round((finishDate - startDate) / 86_400_000));
}

/**
 * Side-by-side columns over the blocks' drawn extents (location v4 C6): a short block's one-line
 * minimum that reaches into the next block puts the two side by side, as in Apple Calendar. No
 * inset overlay and no text-less lanes: every column keeps its title.
 */
export function layoutTimeBlockLanes(
  blocks: ReadonlyArray<{ key: string; top: number; height: number }>
) {
  const lanes = new Map<string, TimeBlockLane>();
  for (const column of layoutCalendarBlockColumns(
    blocks.map((block) => ({ id: block.key, top: block.top, bottom: block.top + block.height }))
  )) {
    lanes.set(column.id, {
      laneCount: column.columnCount,
      laneIndex: column.columnIndex,
      mode: column.columnCount > 1 ? "lane" : "full",
      offsetFraction: column.offsetFraction,
      widthFraction: column.widthFraction,
      zIndex: column.zIndex
    });
  }
  return lanes;
}
