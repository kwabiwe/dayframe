export type TimeIntervalInput = {
  id: string;
  startedAt: Date | string | number;
  stoppedAt: Date | string | number | null;
};

export type TimeRangeInput = {
  start: Date | string | number;
  end: Date | string | number;
};

export type IntervalWindow = {
  startMs: number;
  endMs: number;
  seconds: number;
};

export type TimeIntervalAnalysisEntry = {
  id: string;
  startMs: number;
  endMs: number;
  loggedSeconds: number;
  uniqueOverlapSeconds: number;
  overlapSeconds: number;
  overlapCount: number;
  overlappingEntryIds: string[];
  overlapWindows: IntervalWindow[];
  firstOverlapStartMs: number | null;
  lastOverlapEndMs: number | null;
  maxConcurrency: number;
};

export type TimeIntervalAnalysis = {
  entries: TimeIntervalAnalysisEntry[];
  invalidEntryIds: string[];
  totalLoggedSeconds: number;
  timeCoveredSeconds: number;
  additionalOverlappingActivitySeconds: number;
  loggedSeconds: number;
  coveredSeconds: number;
  additionalOverlapSeconds: number;
  concurrentCoverageSeconds: number;
  maxConcurrency: number;
  hasOverlap: boolean;
};

export type TimeIntervalLayoutMode = "full" | "insetOverlay" | "lane" | "compactLane";
export type TimeIntervalTextDensity = "full" | "title" | "none";

export type TimeIntervalLayout = {
  id: string;
  groupId: string;
  mode: TimeIntervalLayoutMode;
  laneIndex: number;
  laneCount: number;
  offsetFraction: number;
  widthFraction: number;
  zIndex: number;
  textDensity: TimeIntervalTextDensity;
};

type NormalizedInterval = {
  id: string;
  startMs: number;
  endMs: number;
};

export const TIME_OVERLAP_LAYOUT_CONSTANTS = {
  containedOverlayMaximumRatio: 0.6,
  insetOffsetFraction: 0.18
} as const;

export const MINIMUM_MEANINGFUL_OVERLAP_MS = 60_000;
export const MINIMUM_MEANINGFUL_OVERLAP_SECONDS =
  MINIMUM_MEANINGFUL_OVERLAP_MS / 1000;

export function analyzeTimeIntervals(
  input: ReadonlyArray<TimeIntervalInput>,
  {
    range,
    now = new Date()
  }: {
    range?: TimeRangeInput;
    now?: Date | string | number;
  } = {}
): TimeIntervalAnalysis {
  const nowMs = toTimestamp(now);
  const rangeStart = range ? toTimestamp(range.start) : Number.NEGATIVE_INFINITY;
  const rangeEnd = range ? toTimestamp(range.end) : Number.POSITIVE_INFINITY;
  const validRange = rangeStart < rangeEnd;
  const invalidEntryIds: string[] = [];
  const seenIds = new Set<string>();
  const intervals: NormalizedInterval[] = [];

  for (const candidate of [...input].sort(compareRawIntervals)) {
    const startMs = toTimestamp(candidate.startedAt);
    const rawEndMs = candidate.stoppedAt === null ? nowMs : toTimestamp(candidate.stoppedAt);
    const endMs = Math.min(rawEndMs, rangeEnd);
    const clippedStartMs = Math.max(startMs, rangeStart);
    if (
      !candidate.id ||
      seenIds.has(candidate.id) ||
      !validRange ||
      !Number.isFinite(startMs) ||
      !Number.isFinite(rawEndMs) ||
      rawEndMs <= startMs ||
      endMs <= clippedStartMs
    ) {
      invalidEntryIds.push(candidate.id);
      continue;
    }
    seenIds.add(candidate.id);
    intervals.push({ id: candidate.id, startMs: clippedStartMs, endMs });
  }

  intervals.sort(compareIntervals);
  const meaningfulPairs = meaningfulOverlapPairs(intervals);

  const analyzedEntries = intervals.map((interval) => {
    const overlappingEntryIds: string[] = [];
    const intersections: Array<{ startMs: number; endMs: number }> = [];
    const entryPoints: Array<{ at: number; delta: number }> = [
      { at: interval.startMs, delta: 1 },
      { at: interval.endMs, delta: -1 }
    ];

    for (const other of intervals) {
      if (other.id === interval.id) continue;
      if (!meaningfulPairs.has(pairKey(interval.id, other.id))) continue;
      const startMs = Math.max(interval.startMs, other.startMs);
      const endMs = Math.min(interval.endMs, other.endMs);
      overlappingEntryIds.push(other.id);
      intersections.push({ startMs, endMs });
      entryPoints.push(
        { at: other.startMs, delta: 1 },
        { at: other.endMs, delta: -1 }
      );
    }

    const overlapWindows = mergeWindows(intersections);
    const clippedEntryPoints = entryPoints
      .map((point) => ({
        at: Math.max(interval.startMs, Math.min(interval.endMs, point.at)),
        delta: point.delta
      }))
      .sort((left, right) => left.at - right.at || left.delta - right.delta);
    let entryActive = 0;
    let entryMaxConcurrency = 0;
    for (const point of clippedEntryPoints) {
      entryActive += point.delta;
      entryMaxConcurrency = Math.max(entryMaxConcurrency, entryActive);
    }

    const uniqueOverlapSeconds = seconds(
      overlapWindows.reduce((total, window) => total + window.endMs - window.startMs, 0)
    );
    return {
      id: interval.id,
      startMs: interval.startMs,
      endMs: interval.endMs,
      loggedSeconds: seconds(interval.endMs - interval.startMs),
      uniqueOverlapSeconds,
      overlapSeconds: uniqueOverlapSeconds,
      overlapCount: overlappingEntryIds.length,
      overlappingEntryIds: overlappingEntryIds.sort(),
      overlapWindows: overlapWindows.map((window) => ({
        ...window,
        seconds: seconds(window.endMs - window.startMs)
      })),
      firstOverlapStartMs: overlapWindows[0]?.startMs ?? null,
      lastOverlapEndMs: overlapWindows.at(-1)?.endMs ?? null,
      maxConcurrency: entryMaxConcurrency
    };
  }).sort((left, right) => left.id.localeCompare(right.id));

  const loggedMs = intervals.reduce(
    (total, interval) => total + interval.endMs - interval.startMs,
    0
  );
  const meaningfulMetrics = meaningfulOverlapMetrics(
    intervals,
    meaningfulPairs
  );
  const totalLoggedSeconds = seconds(loggedMs);
  const additionalOverlappingActivitySeconds = seconds(
    meaningfulMetrics.additionalMs
  );
  const timeCoveredSeconds = Math.max(
    0,
    totalLoggedSeconds - additionalOverlappingActivitySeconds
  );

  return {
    entries: analyzedEntries,
    invalidEntryIds: invalidEntryIds.sort(),
    totalLoggedSeconds,
    timeCoveredSeconds,
    additionalOverlappingActivitySeconds,
    // Compatibility aliases for existing timeline/bootstrap consumers.
    loggedSeconds: totalLoggedSeconds,
    coveredSeconds: timeCoveredSeconds,
    additionalOverlapSeconds: additionalOverlappingActivitySeconds,
    concurrentCoverageSeconds: seconds(meaningfulMetrics.concurrentMs),
    maxConcurrency: meaningfulMetrics.maxConcurrency,
    hasOverlap: additionalOverlappingActivitySeconds > 0
  };
}

export function layoutTimeIntervals(
  input: ReadonlyArray<Pick<TimeIntervalInput, "id" | "startedAt" | "stoppedAt">>,
  now: Date | string | number = new Date(),
  {
    minimumOverlapMs = MINIMUM_MEANINGFUL_OVERLAP_MS
  }: {
    minimumOverlapMs?: number;
  } = {}
) {
  const nowMs = toTimestamp(now);
  const intervals: NormalizedInterval[] = [];
  const seenIds = new Set<string>();
  for (const candidate of [...input].sort(compareRawIntervals)) {
    const startMs = toTimestamp(candidate.startedAt);
    const endMs = candidate.stoppedAt === null ? nowMs : toTimestamp(candidate.stoppedAt);
    if (
      !candidate.id ||
      seenIds.has(candidate.id) ||
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      endMs <= startMs
    ) {
      continue;
    }
    seenIds.add(candidate.id);
    intervals.push({ id: candidate.id, startMs, endMs });
  }
  intervals.sort(compareIntervals);
  const layouts = collisionComponents(
    intervals,
    Math.max(0, minimumOverlapMs)
  ).flatMap(layoutCollisionGroup);

  return layouts.sort((left, right) => left.id.localeCompare(right.id));
}

function meaningfulOverlapPairs(intervals: NormalizedInterval[]) {
  const pairs = new Set<string>();
  for (let leftIndex = 0; leftIndex < intervals.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < intervals.length;
      rightIndex += 1
    ) {
      const left = intervals[leftIndex]!;
      const right = intervals[rightIndex]!;
      if (
        intersectionDurationMs(left, right) >=
        MINIMUM_MEANINGFUL_OVERLAP_MS
      ) {
        pairs.add(pairKey(left.id, right.id));
      }
    }
  }
  return pairs;
}

function meaningfulOverlapMetrics(
  intervals: NormalizedInterval[],
  pairs: Set<string>
) {
  if (intervals.length === 0) {
    return { additionalMs: 0, concurrentMs: 0, maxConcurrency: 0 };
  }
  const points = [...new Set(
    intervals.flatMap((interval) => [interval.startMs, interval.endMs])
  )].sort((left, right) => left - right);
  let additionalMs = 0;
  let concurrentMs = 0;
  let maxConcurrency = 1;

  for (let index = 0; index < points.length - 1; index += 1) {
    const startMs = points[index]!;
    const endMs = points[index + 1]!;
    if (endMs <= startMs) continue;
    const active = intervals.filter(
      (interval) => interval.startMs < endMs && interval.endMs > startMs
    );
    const components = collisionComponentsFromPairs(active, pairs)
      .filter((component) => component.length > 1);
    if (components.length === 0) continue;
    const segmentMs = endMs - startMs;
    concurrentMs += segmentMs;
    additionalMs += components.reduce(
      (total, component) => total + (component.length - 1) * segmentMs,
      0
    );
    maxConcurrency = Math.max(
      maxConcurrency,
      ...components.map((component) => component.length)
    );
  }

  return { additionalMs, concurrentMs, maxConcurrency };
}

function collisionComponents(
  intervals: NormalizedInterval[],
  minimumOverlapMs: number
) {
  const pairs = new Set<string>();
  for (let leftIndex = 0; leftIndex < intervals.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < intervals.length;
      rightIndex += 1
    ) {
      const left = intervals[leftIndex]!;
      const right = intervals[rightIndex]!;
      const overlapMs = intersectionDurationMs(left, right);
      if (overlapMs > 0 && overlapMs >= minimumOverlapMs) {
        pairs.add(pairKey(left.id, right.id));
      }
    }
  }
  return collisionComponentsFromPairs(intervals, pairs);
}

function collisionComponentsFromPairs(
  intervals: NormalizedInterval[],
  pairs: Set<string>
) {
  const remaining = new Map(intervals.map((interval) => [interval.id, interval]));
  const components: NormalizedInterval[][] = [];
  for (const interval of intervals) {
    if (!remaining.has(interval.id)) continue;
    const component: NormalizedInterval[] = [];
    const queue = [interval];
    remaining.delete(interval.id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const candidate of [...remaining.values()]) {
        if (!pairs.has(pairKey(current.id, candidate.id))) continue;
        remaining.delete(candidate.id);
        queue.push(candidate);
      }
    }
    components.push(component.sort(compareIntervals));
  }
  return components;
}

function intersectionDurationMs(
  left: NormalizedInterval,
  right: NormalizedInterval
) {
  return Math.max(
    0,
    Math.min(left.endMs, right.endMs) -
      Math.max(left.startMs, right.startMs)
  );
}

function pairKey(leftId: string, rightId: string) {
  return leftId < rightId
    ? `${leftId}\u0000${rightId}`
    : `${rightId}\u0000${leftId}`;
}

function layoutCollisionGroup(group: NormalizedInterval[]): TimeIntervalLayout[] {
  const groupId = group.map((interval) => interval.id).sort().join(":");
  if (group.length === 1) {
    return [fullLayout(group[0]!, groupId)];
  }

  if (group.length === 2) {
    const [first, second] = group;
    const contained =
      contains(first, second) ? { container: first, overlay: second }
      : contains(second, first) ? { container: second, overlay: first }
      : null;
    if (contained) {
      const containerDuration = contained.container.endMs - contained.container.startMs;
      const overlayDuration = contained.overlay.endMs - contained.overlay.startMs;
      if (
        overlayDuration / containerDuration <=
        TIME_OVERLAP_LAYOUT_CONSTANTS.containedOverlayMaximumRatio
      ) {
        return [
          fullLayout(contained.container, groupId),
          {
            id: contained.overlay.id,
            groupId,
            mode: "insetOverlay",
            laneIndex: 1,
            laneCount: 2,
            offsetFraction: TIME_OVERLAP_LAYOUT_CONSTANTS.insetOffsetFraction,
            widthFraction: 1 - TIME_OVERLAP_LAYOUT_CONSTANTS.insetOffsetFraction,
            zIndex: 2,
            textDensity: "title"
          }
        ];
      }
    }
  }

  const laneEnds: number[] = [];
  const assigned = group.map((interval) => {
    let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= interval.startMs);
    if (laneIndex < 0) {
      laneIndex = laneEnds.length;
      laneEnds.push(interval.endMs);
    } else {
      laneEnds[laneIndex] = interval.endMs;
    }
    return { interval, laneIndex };
  });
  const laneCount = Math.max(1, laneEnds.length);
  const compact = laneCount >= 3;
  return assigned.map(({ interval, laneIndex }) => ({
    id: interval.id,
    groupId,
    mode: compact ? "compactLane" : "lane",
    laneIndex,
    laneCount,
    offsetFraction: laneIndex / laneCount,
    widthFraction: 1 / laneCount,
    zIndex: laneIndex + 1,
    textDensity: compact ? "none" : "title"
  }));
}

function fullLayout(interval: NormalizedInterval, groupId: string): TimeIntervalLayout {
  return {
    id: interval.id,
    groupId,
    mode: "full",
    laneIndex: 0,
    laneCount: 1,
    offsetFraction: 0,
    widthFraction: 1,
    zIndex: 0,
    textDensity: "full"
  };
}

function contains(container: NormalizedInterval, candidate: NormalizedInterval) {
  return (
    container.startMs <= candidate.startMs &&
    container.endMs >= candidate.endMs &&
    (container.startMs < candidate.startMs || container.endMs > candidate.endMs)
  );
}

function mergeWindows(windows: Array<{ startMs: number; endMs: number }>) {
  const sorted = [...windows].sort(
    (left, right) => left.startMs - right.startMs || left.endMs - right.endMs
  );
  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const window of sorted) {
    const previous = merged.at(-1);
    if (!previous || window.startMs > previous.endMs) {
      merged.push({ ...window });
    } else {
      previous.endMs = Math.max(previous.endMs, window.endMs);
    }
  }
  return merged;
}

function compareIntervals(left: NormalizedInterval, right: NormalizedInterval) {
  return left.startMs - right.startMs || left.endMs - right.endMs || left.id.localeCompare(right.id);
}

function compareRawIntervals(left: TimeIntervalInput, right: TimeIntervalInput) {
  const leftStart = sortableTimestamp(left.startedAt);
  const rightStart = sortableTimestamp(right.startedAt);
  const leftEnd = sortableTimestamp(left.stoppedAt ?? Number.POSITIVE_INFINITY);
  const rightEnd = sortableTimestamp(right.stoppedAt ?? Number.POSITIVE_INFINITY);
  return (
    leftStart - rightStart ||
    leftEnd - rightEnd ||
    left.id.localeCompare(right.id)
  );
}

function toTimestamp(value: Date | string | number) {
  return value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
}

function sortableTimestamp(value: Date | string | number) {
  const timestamp = toTimestamp(value);
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function seconds(milliseconds: number) {
  return Math.max(0, Math.floor(milliseconds / 1000));
}
