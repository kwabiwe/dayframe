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
  /** Below this drawn height the title line uses the smaller label size. */
  compactTextMaximumHeight: 22,
  /** Drawn edges this close count as touching, not colliding (rounding and the 1 px/pt gap). */
  touchTolerance: 0.5
} as const;

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
  offsetFraction: number;
  widthFraction: number;
  zIndex: number;
};

/** The drawn extent of a block: its time's height, but never less than one label line. */
export function calendarDrawnExtent(top: number, timeHeight: number, minimumHeight: number) {
  return { top, bottom: top + Math.max(minimumHeight, Number.isFinite(timeHeight) ? timeHeight : 0) };
}

/**
 * One clustering pass over drawn extents. Blocks are taken by top, longer first, then id; a cluster
 * grows while the next block starts above its lowest bottom; inside a cluster each block takes the
 * leftmost column whose last block has ended by its top (greedy interval partitioning). Every block
 * in a cluster is 1 / columns wide; a block that collides with nothing keeps the full width.
 * O(n log n) for the sort plus O(n · columns).
 */
export function layoutCalendarBlockColumns(blocks: ReadonlyArray<CalendarDrawnBlock>): CalendarBlockColumn[] {
  const tolerance = CALENDAR_BLOCK_LABEL.touchTolerance;
  const seen = new Set<string>();
  const items = blocks
    .filter((block) => {
      if (!block.id || seen.has(block.id) || !Number.isFinite(block.top) || !Number.isFinite(block.bottom)) return false;
      seen.add(block.id);
      return true;
    })
    .map((block) => ({ id: block.id, top: block.top, bottom: Math.max(block.top, block.bottom) }))
    .sort((left, right) => left.top - right.top || right.bottom - left.bottom || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const out: CalendarBlockColumn[] = [];
  let cluster: Array<{ id: string; columnIndex: number }> = [];
  let clusterBottom = -Infinity;
  let columnBottoms: number[] = [];
  const flush = () => {
    if (cluster.length === 0) return;
    const clusterId = cluster.map((member) => member.id).join(":");
    const columnCount = columnBottoms.length;
    for (const member of cluster) {
      out.push({
        id: member.id,
        clusterId,
        columnIndex: member.columnIndex,
        columnCount,
        offsetFraction: member.columnIndex / columnCount,
        widthFraction: 1 / columnCount,
        zIndex: columnCount > 1 ? member.columnIndex + 1 : 0
      });
    }
    cluster = [];
    columnBottoms = [];
  };

  for (const item of items) {
    if (item.top >= clusterBottom - tolerance) {
      flush();
      clusterBottom = item.bottom;
    }
    let columnIndex = columnBottoms.findIndex((bottom) => bottom <= item.top + tolerance);
    if (columnIndex < 0) {
      columnIndex = columnBottoms.length;
      columnBottoms.push(item.bottom);
    } else {
      columnBottoms[columnIndex] = item.bottom;
    }
    cluster.push({ id: item.id, columnIndex });
    clusterBottom = Math.max(clusterBottom, item.bottom);
  }
  flush();
  return out;
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
