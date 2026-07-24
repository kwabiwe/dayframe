const shortBlockMinutes = 15;
const minimumClickableBlockHeight = 18;

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
};

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
    canShowInlineAction: height >= 40,
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
  const sorted = [...blocks].sort(
    (left, right) =>
      left.top - right.top ||
      left.top + left.height - (right.top + right.height) ||
      left.key.localeCompare(right.key)
  );
  let group: Array<{ key: string; laneIndex: number }> = [];
  let groupBottom = Number.NEGATIVE_INFINITY;
  let laneEnds: number[] = [];

  function finishGroup() {
    const laneCount = Math.max(1, laneEnds.length);
    for (const item of group) {
      lanes.set(item.key, { laneCount, laneIndex: item.laneIndex });
    }
    group = [];
    groupBottom = Number.NEGATIVE_INFINITY;
    laneEnds = [];
  }

  for (const block of sorted) {
    if (group.length > 0 && block.top >= groupBottom) finishGroup();

    const bottom = block.top + block.height;
    let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= block.top);
    if (laneIndex < 0) {
      laneIndex = laneEnds.length;
      laneEnds.push(bottom);
    } else {
      laneEnds[laneIndex] = bottom;
    }
    group.push({ key: block.key, laneIndex });
    groupBottom = Math.max(groupBottom, bottom);
  }

  finishGroup();
  return lanes;
}
