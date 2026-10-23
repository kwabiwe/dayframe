import { MINIMUM_MEANINGFUL_OVERLAP_MS } from "@dayframe/shared";

/**
 * iPhone Calendar overlap columns (Trello 210). Logged blocks that overlap are laid out side by
 * side, as Apple Calendar and Google Calendar do: never one block drawn over another's text.
 *
 * - Two blocks collide when they share at least a minute, or when one lies wholly inside the other
 *   (a contained block of any length: iOS draws it at least 4 points tall, so even a 30-second block
 *   inside a longer one would otherwise sit on top of it). A sub-minute brush at the edge of two
 *   blocks is drawn as touching, as before.
 * - Colliding blocks form clusters (blocks linked by collisions, so a chain A–B–C is one cluster).
 * - Inside a cluster, blocks are taken by start, then longer first, then id, and each goes in the
 *   leftmost column whose last block is no longer drawn by its start (greedy interval partitioning).
 *   A block occupies its column for at least `minimumDrawnMs` (5 minutes: iOS's 4-point minimum
 *   height at the most zoomed-out 48 points an hour), so a short block's painted minimum height
 *   never runs into the next block in its column, and a block whose drawn interval collapsed to
 *   nothing (a clock change: 01:45 BST to 01:15 GMT is drawn as one 4-point block at 01:45) still
 *   takes its own column beside another block drawn at the same place. A block drawn after that
 *   shares the column.
 * - Every block in a cluster is 1 / columns of the width, at column / columns; a block that collides
 *   with nothing keeps the full width.
 */
export type CalendarColumnInput = {
  id: string;
  /** Where the block is drawn: start and end on one timeline (a running block ends now). */
  startMs: number;
  endMs: number;
};

export type CalendarColumnLayout = {
  id: string;
  clusterId: string;
  columnIndex: number;
  columnCount: number;
  offsetFraction: number;
  widthFraction: number;
  zIndex: number;
};

/**
 * The time-based fallback: what an older native build (before location v4 C6) draws, at its old
 * 4-point minimum. A current build lays out its own columns over drawn extents at every zoom, which
 * collide at least as often, so React's hit analysis built on these columns stays conservative.
 */
export const CALENDAR_MINIMUM_DRAWN_MS = 5 * 60_000;

export function layoutCalendarColumns(
  input: ReadonlyArray<CalendarColumnInput>,
  {
    minimumOverlapMs = MINIMUM_MEANINGFUL_OVERLAP_MS,
    minimumDrawnMs = CALENDAR_MINIMUM_DRAWN_MS
  }: { minimumOverlapMs?: number; minimumDrawnMs?: number } = {}
): CalendarColumnLayout[] {
  const seen = new Set<string>();
  const blocks: CalendarColumnInput[] = [];
  for (const candidate of input) {
    if (!candidate.id || seen.has(candidate.id)) continue;
    if (!Number.isFinite(candidate.startMs) || !Number.isFinite(candidate.endMs)) continue;
    seen.add(candidate.id);
    blocks.push({ id: candidate.id, startMs: candidate.startMs, endMs: Math.max(candidate.startMs, candidate.endMs) });
  }
  blocks.sort(compareColumnOrder);

  const threshold = Math.max(0, minimumOverlapMs);
  const collides = (left: CalendarColumnInput, right: CalendarColumnInput) => {
    const overlapMs = Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs);
    if (overlapMs > 0 && overlapMs >= threshold) return true;
    return contains(left, right) || contains(right, left);
  };

  const layouts: CalendarColumnLayout[] = [];
  const remaining = new Set(blocks.map((_, index) => index));
  for (let index = 0; index < blocks.length; index += 1) {
    if (!remaining.has(index)) continue;
    remaining.delete(index);
    const members = [index];
    for (let cursor = 0; cursor < members.length; cursor += 1) {
      const current = blocks[members[cursor]!]!;
      for (const other of [...remaining]) {
        if (!collides(current, blocks[other]!)) continue;
        remaining.delete(other);
        members.push(other);
      }
    }
    const cluster = members.sort((left, right) => left - right).map((member) => blocks[member]!);
    const clusterId = cluster.map((block) => block.id).sort().join(":");

    const columnEnds: number[] = [];
    const assigned = cluster.map((block) => {
      const occupiedEnd = Math.max(block.endMs, block.startMs + Math.max(0, minimumDrawnMs));
      let columnIndex = columnEnds.findIndex((columnEnd) => columnEnd <= block.startMs);
      if (columnIndex < 0) {
        columnIndex = columnEnds.length;
        columnEnds.push(occupiedEnd);
      } else {
        columnEnds[columnIndex] = occupiedEnd;
      }
      return { block, columnIndex };
    });
    const columnCount = Math.max(1, columnEnds.length);
    for (const { block, columnIndex } of assigned) {
      layouts.push({
        id: block.id,
        clusterId,
        columnIndex,
        columnCount,
        offsetFraction: columnIndex / columnCount,
        widthFraction: 1 / columnCount,
        zIndex: columnCount === 1 ? 0 : columnIndex + 1
      });
    }
  }
  return layouts;
}

/** Start first, then the longer block (it takes the left column), then id for a stable order. */
function compareColumnOrder(left: CalendarColumnInput, right: CalendarColumnInput) {
  return left.startMs - right.startMs || right.endMs - left.endMs || left.id.localeCompare(right.id);
}

function contains(container: CalendarColumnInput, candidate: CalendarColumnInput) {
  return container.startMs <= candidate.startMs && container.endMs >= candidate.endMs;
}
