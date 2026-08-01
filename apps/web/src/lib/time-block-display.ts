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
  showTitle: boolean;
  showContext: boolean;
  showDuration: boolean;
  showTags: boolean;
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
  isSelected,
  textDensity
}: {
  density: TimeBlockDensity;
  isCompleted: boolean;
  isResizing: boolean;
  isSelected: boolean;
  textDensity: TimeIntervalTextDensity;
}) {
  return (
    isCompleted &&
    density.canShowInlineAction &&
    textDensity === "full" &&
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
    canShowInlineAction: height >= minimumClickableBlockHeight,
    isTiny,
    isShort,
    showTitle: height >= 18,
    showContext: height >= 58,
    showDuration: durationSeconds > 0 && height >= 34,
    showTags: height >= 78
  };
}

export function timeBlockDensityClassNames(density: TimeBlockDensity) {
  return [
    density.isTiny ? "is-tiny" : "",
    density.isShort ? "is-short" : "",
    density.canDirectResize ? "can-direct-resize" : "",
    density.canShowInlineAction ? "can-show-inline-action" : "",
    density.showTitle ? "" : "has-no-text"
  ];
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
import {
  layoutTimeIntervals,
  type TimeIntervalLayoutMode,
  type TimeIntervalTextDensity
} from "@dayframe/shared";
