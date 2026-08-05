import {
  layoutTimeIntervals,
  type TimeIntervalLayoutMode,
  type TimeIntervalTextDensity
} from "@dayframe/shared";
import { timeEntryCategoryLabel } from "@/lib/display";
import { dateTimeLocal, formatDuration, formatTime } from "@/lib/format";

const shortBlockMinutes = 15;
const minimumClickableBlockHeight = 18;
const calendarBlockVisualGapPx = 1;
const calendarBlockLaneGapPx = 1;
const calendarBlockOuterInsetPx = 8;

export const resizeDragThresholdPx = 6;

export type TimeBlockDensity = {
  canDirectResize: boolean;
  canShowInlineAction: boolean;
  isTiny: boolean;
  isShort: boolean;
  showAnyText: boolean;
  showCombinedPrimary: boolean;
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
  mode: TimeIntervalLayoutMode;
  offsetFraction: number;
  widthFraction: number;
  zIndex: number;
  textDensity: TimeIntervalTextDensity;
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

export function calendarBlockLaneInsets({
  offsetFraction,
  widthFraction
}: Pick<TimeBlockLane, "offsetFraction" | "widthFraction">) {
  const before = offsetFraction * 100;
  const after = Math.max(0, (1 - offsetFraction - widthFraction) * 100);
  const innerInset = calendarBlockLaneGapPx / 2;

  return {
    left: before === 0 ? calendarBlockOuterInsetPx : `calc(${before}% + ${innerInset}px)`,
    right: after === 0 ? calendarBlockOuterInsetPx : `calc(${after}% + ${innerInset}px)`
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

export function minimumTimeBlockHeight(pixelsPerHour: number) {
  return Math.max(minimumClickableBlockHeight, (shortBlockMinutes / 60) * pixelsPerHour);
}

export function getTimeBlockDensity({
  durationSeconds,
  height
}: {
  durationSeconds: number;
  height: number;
}): TimeBlockDensity {
  const isTiny = height < 24;
  const isShort = height < 40;

  return {
    canDirectResize: height >= 48,
    canShowInlineAction: height >= 24,
    isTiny,
    isShort,
    showAnyText: height >= 18,
    showCombinedPrimary: height >= 18,
    showSecondary: durationSeconds > 0 && height >= 48
  };
}

export function timeBlockDensityClassNames(density: TimeBlockDensity) {
  return [
    density.isTiny ? "is-tiny" : "",
    density.isShort ? "is-short" : "",
    density.canDirectResize ? "can-direct-resize" : "",
    density.canShowInlineAction ? "can-show-inline-action" : "",
    density.showAnyText ? "" : "has-no-text"
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

export function calendarBlockFallbackLine(entry: CalendarBlockDisplayEntry) {
  return calendarBlockPrimaryParts(entry).description;
}

export function calendarBlockSecondaryLine(
  entry: Pick<CalendarBlockDisplayEntry, "startedAt" | "stoppedAt">,
  capturedNow: Date
) {
  const stoppedAt = entry.stoppedAt ?? capturedNow.toISOString();
  const durationSeconds = Math.max(0, Math.floor(
    (new Date(stoppedAt).getTime() - new Date(entry.startedAt).getTime()) / 1_000
  ));
  const dayOffset = localDayOffset(entry.startedAt, stoppedAt);
  const finish = entry.stoppedAt ? `${formatTime(stoppedAt)}${dayOffset > 0 ? ` +${dayOffset}` : ""}` : "now";
  return `${formatDuration(durationSeconds)} (${formatTime(entry.startedAt)} – ${finish})`;
}

function localDayOffset(startedAt: string, stoppedAt: string) {
  const start = dateTimeLocal(startedAt).slice(0, 10);
  const finish = dateTimeLocal(stoppedAt).slice(0, 10);
  const startDate = Date.parse(`${start}T00:00:00Z`);
  const finishDate = Date.parse(`${finish}T00:00:00Z`);
  return Math.max(0, Math.round((finishDate - startDate) / 86_400_000));
}

export function layoutTimeBlockLanes(
  blocks: ReadonlyArray<{ key: string; top: number; height: number }>
) {
  const lanes = new Map<string, TimeBlockLane>();
  for (const layout of layoutTimeIntervals(
    blocks.map((block) => ({
      id: block.key,
      startedAt: block.top,
      stoppedAt: block.top + block.height
    })),
    0,
    // Rendered minimum heights still need collision lanes even when the
    // underlying entries are sequential. These values are pixels, not time.
    { minimumOverlapMs: 0 }
  )) {
    lanes.set(layout.id, {
      laneCount: layout.laneCount,
      laneIndex: layout.laneIndex,
      mode: layout.mode,
      offsetFraction: layout.offsetFraction,
      widthFraction: layout.widthFraction,
      zIndex: layout.zIndex,
      textDensity: layout.textDensity
    });
  }
  return lanes;
}
