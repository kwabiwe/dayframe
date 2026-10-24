/**
 * Calendar titles at every zoom (location v4 design §11, owner change C6), one rule for the iPhone's
 * native Calendar and the web Calendar, as in Apple Calendar:
 *
 * - every block is drawn at least one label line tall, and its label prints its real length;
 * - blocks whose drawn shapes would collide (a short block's label line reaching into the next one
 *   included) sit side by side in columns, found by one clustering pass over the drawn extents;
 * - under 34 tall a block has one line ("Title 11m"); from 34 a detail line too; trip blocks show
 *   their leg strip from 44 (legs arrive in a later step); a column under 34 wide shows the
 *   activity icon only, with the full title in VoiceOver and the tooltip.
 *
 * The iPhone recomputes this in Swift on every zoom step inside its native gesture owner
 * (`DayframeCalendarCore.swift` mirrors these constants; a contract test keeps them equal).
 */
export const CALENDAR_BLOCK_LABEL = {
  /** Web: the drawn minimum, one 16 px label line. */
  webMinimumHeight: 16,
  /** iPhone: one label line at the default text size; it grows with Dynamic Type up to the cap. */
  iosMinimumHeight: 15,
  /** The iPhone's metadata text-size cap, which also caps the minimum height's growth. */
  iosMaximumTextScale: 1.3,
  /** From this drawn height a block shows a detail line under its title. */
  twoLineMinimumHeight: 34,
  /** From this drawn height a trip block shows its leg strip. */
  legStripMinimumHeight: 44,
  /** A column narrower than this shows the activity icon only. */
  iconOnlyMaximumWidth: 34,
  /** In a column narrower than this the length takes at most half the line, scaled to fit whole. */
  compactLengthMaximumWidth: 72,
  /** Below this drawn height the title line uses the smaller label size. */
  compactTextMaximumHeight: 22,
  /** Drawn edges this close count as touching, not colliding (rounding and the 1 px/pt gap). */
  touchTolerance: 0.5
} as const;

/**
 * Dense-day Calendar (owner, 24 Oct 2026; mock-up calendar-dense v2), replacing accepted difference #2:
 * the title always wins over the length, as in iOS Calendar.
 *
 * - every block is drawn at least one label line tall (18), and blocks whose drawn shapes would collide
 *   share the cluster's width in columns for their whole height, widening right into columns free for
 *   their whole height (`layoutCalendarBlockColumns(..., { expandRight: true })`); nothing is drawn on top;
 * - the title wraps to the lines that fit, then ends with an ellipsis after a whole word;
 * - compact type under 34 tall or 90 wide; the time and length only from 120 wide with a line to spare;
 * - a column under 22 wide shows its colour only (its title on tap and to assistive tech).
 */
export const CALENDAR_DENSE_LABEL = {
  /** The drawn minimum: one label line. */
  minimumHeight: 18,
  /** Under this drawn height, compact type. */
  compactTextMaximumHeight: 34,
  /** Under this width, compact type. */
  compactTextMaximumWidth: 90,
  /** From this width (and with a line to spare under the title), the time and length line. */
  detailMinimumWidth: 120,
  /** Under this width, the colour only. */
  sliverMaximumWidth: 22
} as const;

/**
 * Calendar v3 (owner, 24 Oct 2026; calendar-v3-mockup): Apple Calendar's hybrid overlap. A block that
 * starts within `closeMinutes` of its group's first start (or within its title line) sits beside it in
 * equal columns; a later start nests, indented `indent` from the block it starts inside and drawn on
 * top, never narrower than `minimumNestedWidth`. Blocks have `cornerRadius` corners. The iPhone's
 * DayframeCalendarConstants mirror these (nativeCalendar.contract.test.ts).
 */
export const CALENDAR_V3_OVERLAP = {
  closeMinutes: 20,
  indent: 14,
  minimumNestedWidth: 40,
  cornerRadius: 5
} as const;

export type CalendarHybridBlock = {
  id: string;
  /** Where the block is drawn, in the renderer's own units (px or pt), minimum height included. */
  top: number;
  bottom: number;
};

export type CalendarHybridPlacement = {
  id: string;
  /** From the lane's left edge, and the width, before the visual gap (the same units as the lane). */
  x: number;
  width: number;
  /** 0 on the lane, +1 for each block it nests inside. */
  depth: number;
  columnIndex: number;
  columnCount: number;
};

/**
 * Calendar v3: Apple Calendar's hybrid overlap (calendar-v3-mockup `layout`), the same rule as the
 * iPhone's `DayframeCalendarHybridMath` (Swift). Blocks are taken by top, longer first, then id. A block
 * whose start is within `closeDistance` of the first start of a group still running joins that group,
 * whose members share equal columns (spreading right while free). Any other block that starts while
 * blocks are running nests: a group of its own, `CALENDAR_V3_OVERLAP.indent` in from the left edge of
 * the latest-starting running block (the deepest when tied, then the first placed), drawn on top of
 * it, reaching right until a block already placed to the parent's right, at its depth or shallower,
 * is still running beside its first block (stopping `gap` short), never narrower than
 * `minimumNestedWidth` and never past the lane.
 */
export function layoutCalendarHybrid(
  blocks: ReadonlyArray<CalendarHybridBlock>,
  { laneWidth, closeDistance, gap = 2 }: { laneWidth: number; closeDistance: number; gap?: number }
): CalendarHybridPlacement[] {
  const tolerance = CALENDAR_BLOCK_LABEL.touchTolerance;
  const width = Math.max(0, Number.isFinite(laneWidth) ? laneWidth : 0);
  const close = Math.max(0, Number.isFinite(closeDistance) ? closeDistance : 0);
  const seen = new Set<string>();
  const items = blocks
    .filter((block) => {
      if (!block.id || seen.has(block.id) || !Number.isFinite(block.top) || !Number.isFinite(block.bottom)) return false;
      seen.add(block.id);
      return true;
    })
    .map((block) => ({ id: block.id, top: block.top, bottom: Math.max(block.top, block.bottom) }))
    .sort((left, right) => left.top - right.top
      || (right.bottom - right.top) - (left.bottom - left.top)
      || compareCodeUnits(left.id, right.id));

  type Group = { firstTop: number; firstBottom: number; parent: number | null; depth: number; members: number[]; columns: number[][] };
  const groups: Group[] = [];
  const groupOf: number[] = [];
  const column: number[] = [];
  let running: number[] = [];
  items.forEach((item, index) => {
    running = running.filter((other) => items[other].bottom > item.top + tolerance);
    const joinable = running.map((other) => groupOf[other]).filter((group) => item.top - groups[group].firstTop < close);
    let group: number;
    if (joinable.length) {
      group = Math.min(...joinable);
    } else {
      let parent: number | null = null;
      for (const candidate of running) {
        if (parent === null) { parent = candidate; continue; }
        const later = items[candidate].top > items[parent].top;
        const deeper = items[candidate].top === items[parent].top && groups[groupOf[candidate]].depth > groups[groupOf[parent]].depth;
        if (later || deeper) parent = candidate;
      }
      groups.push({
        firstTop: item.top,
        firstBottom: item.bottom,
        parent,
        depth: parent === null ? 0 : groups[groupOf[parent]].depth + 1,
        members: [],
        columns: []
      });
      group = groups.length - 1;
    }
    groups[group].members.push(index);
    const free = groups[group].columns.findIndex((lane) => items[lane[lane.length - 1]].bottom <= item.top + tolerance);
    if (free >= 0) {
      groups[group].columns[free].push(index);
      column.push(free);
    } else {
      groups[group].columns.push([index]);
      column.push(groups[group].columns.length - 1);
    }
    groupOf.push(group);
    running.push(index);
  });

  const x = new Array<number>(items.length).fill(0);
  const resolved = new Array<boolean>(items.length).fill(false);
  const out: CalendarHybridPlacement[] = [];
  groups.forEach((group, groupIndex) => {
    let left = 0;
    let right = width;
    if (group.parent !== null) {
      const parent = group.parent;
      left = x[parent] + CALENDAR_V3_OVERLAP.indent;
      const parentDepth = groups[groupOf[parent]].depth;
      items.forEach((other, index) => {
        if (resolved[index] && index !== parent && groupOf[index] !== groupIndex
          && other.top < group.firstBottom && other.bottom > group.firstTop
          && x[index] > x[parent] && groups[groupOf[index]].depth <= parentDepth) {
          right = Math.min(right, x[index] - gap);
        }
      });
      left = Math.min(left, Math.max(0, width - CALENDAR_V3_OVERLAP.minimumNestedWidth));
      right = Math.min(width, Math.max(left + CALENDAR_V3_OVERLAP.minimumNestedWidth, right));
    }
    const count = Math.max(1, group.columns.length);
    const columnWidth = (right - left) / count;
    for (const member of group.members) {
      let span = 1;
      while (column[member] + span < count && !group.columns[column[member] + span].some((other) =>
        items[other].top < items[member].bottom - tolerance && items[other].bottom > items[member].top + tolerance)) span += 1;
      x[member] = left + column[member] * columnWidth;
      resolved[member] = true;
      out.push({ id: items[member].id, x: x[member], width: columnWidth * span, depth: group.depth, columnIndex: column[member], columnCount: count });
    }
  });
  return out;
}

function compareCodeUnits(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** What a block of this drawn height and width shows in the dense-day rules. */
export function calendarDenseLabel({ height, width, lineHeight, compactLineHeight, detailLineHeight }: {
  height: number; width: number; lineHeight: number; compactLineHeight: number; detailLineHeight: number;
}) {
  const sliver = width < CALENDAR_DENSE_LABEL.sliverMaximumWidth;
  const compact = height < CALENDAR_DENSE_LABEL.compactTextMaximumHeight || width < CALENDAR_DENSE_LABEL.compactTextMaximumWidth;
  const line = compact ? compactLineHeight : lineHeight;
  const detail = !sliver && !compact && width >= CALENDAR_DENSE_LABEL.detailMinimumWidth && height >= line + detailLineHeight;
  const titleLines = sliver ? 0 : Math.max(1, Math.floor((height - (detail ? detailLineHeight : 0)) / line));
  return { sliver, compact, detail, titleLines };
}

/**
 * How many of a title's words to show (dense-day rules): every word up to, not including, the
 * first one wider than the title itself, so no word is ever shown in part. Nothing measured yet
 * (a width of 0, as before layout) cuts nothing.
 */
export function wholeWordsThatFit(wordWidths: readonly number[], available: number) {
  if (!(available > 0)) return wordWidths.length;
  const first = wordWidths.findIndex((width) => width > available);
  return first === -1 ? wordWidths.length : first;
}

export type CalendarDrawnBlock = {
  id: string;
  /** Where the block is drawn, in the renderer's own units (px or pt), minimum height included. */
  top: number;
  bottom: number;
};

export type CalendarBlockColumn = {
  id: string;
  clusterId: string;
  columnIndex: number;
  columnCount: number;
  /** Columns it spans: 1, or more when it widens right into free columns. */
  spanCount: number;
  offsetFraction: number;
  widthFraction: number;
  zIndex: number;
};

/** The drawn extent of a block: its time's height, but never less than one label line. */
export function calendarDrawnExtent(top: number, timeHeight: number, minimumHeight: number) {
  return { top, bottom: top + Math.max(minimumHeight, Number.isFinite(timeHeight) ? timeHeight : 0) };
}

/**
 * One clustering pass over drawn extents. Blocks are taken by top, then id (never by length, so a
 * running block growing past a neighbour that started with it keeps its column); a cluster
 * grows while the next block starts above its lowest bottom; inside a cluster each block takes the
 * leftmost column whose last block has ended by its top (greedy interval partitioning). Every block
 * in a cluster is 1 / columns wide; a block that collides with nothing keeps the full width.
 * O(n log n): one sort, then two heaps (columns in use by bottom, freed columns by index).
 */
export function layoutCalendarBlockColumns(
  blocks: ReadonlyArray<CalendarDrawnBlock>,
  options: { expandRight?: boolean } = {}
): CalendarBlockColumn[] {
  const tolerance = CALENDAR_BLOCK_LABEL.touchTolerance;
  const seen = new Set<string>();
  const items = blocks
    .filter((block) => {
      if (!block.id || seen.has(block.id) || !Number.isFinite(block.top) || !Number.isFinite(block.bottom)) return false;
      seen.add(block.id);
      return true;
    })
    .map((block) => ({ id: block.id, top: block.top, bottom: Math.max(block.top, block.bottom) }))
    .sort((left, right) => left.top - right.top || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const out: CalendarBlockColumn[] = [];
  let cluster: Array<{ id: string; columnIndex: number; top: number; bottom: number }> = [];
  let clusterBottom = -Infinity;
  let columnCount = 0;
  // Columns in use, lowest bottom first, and freed columns, leftmost first.
  const busy = new MinHeap<{ bottom: number; column: number }>((left, right) => left.bottom - right.bottom || left.column - right.column);
  const free = new MinHeap<number>((left, right) => left - right);
  const flush = () => {
    if (cluster.length === 0) return;
    const clusterId = cluster.map((member) => member.id).join(":");
    for (const member of cluster) {
      // Dense-day rules: widen right while the next column is free for this block's whole drawn height.
      let spanCount = 1;
      if (options.expandRight) {
        while (member.columnIndex + spanCount < columnCount && !cluster.some((other) => other.columnIndex === member.columnIndex + spanCount &&
          other.top < member.bottom - tolerance && other.bottom > member.top + tolerance)) spanCount += 1;
      }
      out.push({
        id: member.id,
        clusterId,
        columnIndex: member.columnIndex,
        columnCount,
        spanCount,
        offsetFraction: member.columnIndex / columnCount,
        widthFraction: spanCount / columnCount,
        zIndex: columnCount > 1 ? member.columnIndex + 1 : 0
      });
    }
    cluster = [];
    columnCount = 0;
    busy.clear();
    free.clear();
  };

  for (const item of items) {
    if (item.top >= clusterBottom - tolerance) {
      flush();
      clusterBottom = item.bottom;
    }
    while (busy.size > 0 && busy.peek()!.bottom <= item.top + tolerance) free.push(busy.pop()!.column);
    const columnIndex = free.size > 0 ? free.pop()! : columnCount++;
    busy.push({ bottom: item.bottom, column: columnIndex });
    cluster.push({ id: item.id, columnIndex, top: item.top, bottom: item.bottom });
    clusterBottom = Math.max(clusterBottom, item.bottom);
  }
  flush();
  return out;
}

/** A small binary min-heap for the column sweep. */
class MinHeap<T> {
  private readonly items: T[] = [];
  constructor(private readonly compare: (left: T, right: T) => number) {}
  get size() {
    return this.items.length;
  }
  peek(): T | undefined {
    return this.items[0];
  }
  clear() {
    this.items.length = 0;
  }
  push(item: T) {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(items[index], items[parent]) >= 0) break;
      [items[index], items[parent]] = [items[parent], items[index]];
      index = parent;
    }
  }
  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop()!;
    if (items.length > 0) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && this.compare(items[left], items[smallest]) < 0) smallest = left;
        if (right < items.length && this.compare(items[right], items[smallest]) < 0) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest], items[index]];
        index = smallest;
      }
    }
    return top;
  }
}

export type CalendarBlockLabelTier = {
  /** One line ("Title 11m") or a title line plus a detail line. */
  lines: 1 | 2;
  /** The column is too narrow for words: the activity icon only. */
  iconOnly: boolean;
  /** A trip block tall enough for its leg strip (legs arrive in a later step). */
  legStrip: boolean;
  /** The title line uses the smaller label size. */
  compactText: boolean;
};

/** What a block of this drawn height and width shows. */
export function calendarBlockLabelTier({ height, width }: { height: number; width: number }): CalendarBlockLabelTier {
  return {
    lines: height >= CALENDAR_BLOCK_LABEL.twoLineMinimumHeight ? 2 : 1,
    iconOnly: width < CALENDAR_BLOCK_LABEL.iconOnlyMaximumWidth,
    legStrip: height >= CALENDAR_BLOCK_LABEL.legStripMinimumHeight,
    compactText: height < CALENDAR_BLOCK_LABEL.compactTextMaximumHeight
  };
}
