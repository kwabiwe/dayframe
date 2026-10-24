import {
  calendarBlockLabelTier,
  CALENDAR_DENSE_LABEL,
  CALENDAR_V3_OVERLAP,
  layoutCalendarBlockColumns,
  layoutCalendarHybrid,
  type ClockFormat
} from "@dayframe/shared";
import { timeEntryCategoryLabel } from "@/lib/display";
import { dateTimeLocal, formatDuration, formatTime } from "@/lib/format";

export const calendarBlockVisualGapPx = 2;
const calendarBlockLaneGapPx = 2;
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
  /**
   * Calendar v3: where the block sits in the measured lane, in px from its left edge, and how many
   * blocks it is nested inside (drawn on top of them, indented). Absent before the lane is measured.
   */
  px?: { x: number; width: number; depth: number };
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
/**
 * Dense-day rules (owner, 24 Oct 2026): in Day view the rail is wide enough for the pattern's name
 * written level, wrapping whole words; Week view's narrow columns keep the bare bracket.
 */
export const calendarBracketDayRailPx = 44;

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

/**
 * Calendar v3 (owner, 24 Oct 2026): Apple's hybrid overlap in a lane `laneWidth` px wide
 * (`layoutCalendarHybrid`, the iPhone's rule). Starts within 20 minutes — or within one label line —
 * share equal columns; later starts nest 14 px in, on top. Each lane carries its px placement.
 */
export function layoutTimeBlockHybrid(
  blocks: ReadonlyArray<{ key: string; top: number; height: number }>,
  { laneWidth, pixelsPerHour }: { laneWidth: number; pixelsPerHour: number }
) {
  const lanes = new Map<string, TimeBlockLane>();
  const closeDistance = Math.max((CALENDAR_V3_OVERLAP.closeMinutes / 60) * pixelsPerHour, minimumTimeBlockHeight());
  for (const placement of layoutCalendarHybrid(
    blocks.map((block) => ({ id: block.key, top: block.top, bottom: block.top + block.height })),
    { laneWidth, closeDistance, gap: calendarBlockLaneGapPx }
  )) {
    lanes.set(placement.id, {
      laneCount: placement.columnCount,
      laneIndex: placement.columnIndex,
      mode: placement.columnCount > 1 || placement.depth > 0 ? "lane" : "full",
      offsetFraction: laneWidth > 0 ? placement.x / laneWidth : 0,
      widthFraction: laneWidth > 0 ? placement.width / laneWidth : 1,
      // Deeper blocks are drawn above the ones they start inside: the order never reverses (Codex r1 on
      // #583). Past 16 depths it holds at 33, where the later-starting child still paints last (DOM
      // order). Hover, selection and resizing (36) lift any block above them all; sticky day headings (40)
      // stay above every block.
      zIndex: Math.min(placement.depth * 2 + (placement.columnCount > 1 ? 1 : 0), 33),
      px: { x: placement.x, width: placement.width, depth: placement.depth }
    });
  }
  return lanes;
}

/**
 * A lane's horizontal style. With a measured placement (Calendar v3) it is exact px: the lane starts
 * right of any bracket rail and the 8 px outer inset, and every block gives up the 2 px gap on its right.
 */
export function calendarBlockLanePxInsets(px: NonNullable<TimeBlockLane["px"]>, railPx = 0) {
  return {
    left: calendarBlockOuterInsetPx + railPx + px.x,
    width: Math.max(1, px.width - calendarBlockLaneGapPx),
    right: "auto" as const
  };
}

/** The width blocks are laid out across in a day column this wide (right of the rail and the insets). */
export function calendarLaneWidth(dayBodyWidth: number, railPx = 0) {
  return Math.max(0, dayBodyWidth - railPx - calendarBlockOuterInsetPx * 2 + calendarBlockLaneGapPx);
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

/**
 * Every block is drawn at least one 16 px label line tall (location v4 C6), whatever the zoom: the
 * semantic minimum adds the 1 px visual gap the drawn shape gives up.
 */
export function minimumTimeBlockHeight() {
  // Dense-day rules (owner, 24 Oct 2026): one 18 px label line.
  return CALENDAR_DENSE_LABEL.minimumHeight + calendarBlockVisualGapPx;
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

/** Calendar v3: a block's times alone, "09:00–10:20" ("+1" past midnight; a running block ends "now"). */
export function calendarBlockTimes(entry: Pick<CalendarBlockDisplayEntry, "startedAt" | "stoppedAt">, capturedNow: Date, clock: ClockFormat) {
  const stoppedAt = entry.stoppedAt ?? capturedNow.toISOString();
  const dayOffset = localDayOffset(entry.startedAt, stoppedAt);
  const finish = entry.stoppedAt ? `${formatTime(stoppedAt, clock)}${dayOffset > 0 ? ` +${dayOffset}` : ""}` : "now";
  return `${formatTime(entry.startedAt, clock)}–${finish}`;
}

export type CalendarDetailLine = { glyph: "map-pin" | "route" | "heart-pulse" | "tag" | "clock"; text: string };

/**
 * Calendar v3 (owner, 24 Oct 2026): the icon lines under a block's title, shown while they fit, as on
 * the iPhone: the place (a pin, or a route for a trip a Move logged) or Apple Health, the tags, then
 * the times.
 */
export function calendarBlockDetailLines(
  entry: Pick<CalendarBlockDisplayEntry, "startedAt" | "stoppedAt" | "tagNames"> & {
    placeName?: string | null; source?: string | null; automaticMoveEventId?: string | null;
  },
  capturedNow: Date,
  clock: ClockFormat
): CalendarDetailLine[] {
  const lines: CalendarDetailLine[] = [];
  if ((entry.source ?? "").startsWith("health")) lines.push({ glyph: "heart-pulse", text: "From Apple Health" });
  else if (entry.placeName) lines.push({ glyph: entry.automaticMoveEventId ? "route" : "map-pin", text: entry.placeName });
  if (entry.tagNames.length) lines.push({ glyph: "tag", text: entry.tagNames.join(" · ") });
  lines.push({ glyph: "clock", text: calendarBlockTimes(entry, capturedNow, clock) });
  return lines;
}

/** The time and length line (dense-day rules): "07:05–07:40 · 35m"; a running block ends "now". */
export function calendarBlockTimesAndLength(entry: Pick<CalendarBlockDisplayEntry, "startedAt" | "stoppedAt">, capturedNow: Date, clock: ClockFormat) {
  const stoppedAt = entry.stoppedAt ?? capturedNow.toISOString();
  const dayOffset = localDayOffset(entry.startedAt, stoppedAt);
  const finish = entry.stoppedAt ? `${formatTime(stoppedAt, clock)}${dayOffset > 0 ? ` +${dayOffset}` : ""}` : "now";
  return `${formatTime(entry.startedAt, clock)}–${finish} · ${calendarBlockDurationLabel(entry, capturedNow)}`;
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
  // Dense-day rules: a block widens right into columns free for its whole drawn height; nothing on top.
  for (const column of layoutCalendarBlockColumns(
    blocks.map((block) => ({ id: block.key, top: block.top, bottom: block.top + block.height })),
    { expandRight: true }
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
