import type { MobileTimeEntry } from "./api";
import type { TodayActivity } from "./todayReviewPresentation";
import { displayTimerDescription } from "./timerPresentation";

/**
 * Today's ribbon (Blocks prototype): the day as one 24-hour strip. Logged entries are solid blocks,
 * time waiting in Review is hatched, and a coral line marks now. Dragging along it scrubs through
 * the day; tapping a block opens it.
 */
export type RibbonBlock =
  | (RibbonBlockBase & { kind: "entry"; entry: MobileTimeEntry })
  | (RibbonBlockBase & { kind: "pending"; activity: TodayActivity });

type RibbonBlockBase = {
  key: string;
  color: string | null;
  startMs: number;
  endMs: number;
  /** Position and size as fractions of the day. */
  left: number;
  width: number;
  live: boolean;
  title: string;
};

export type RibbonModel = {
  dayStartMs: number;
  dayMs: number;
  nowMs: number;
  /** Where the now line sits, or null when now is outside the day. */
  now: number | null;
  /** Pending first so logged blocks draw over them. */
  blocks: RibbonBlock[];
};

export type RibbonHit =
  | { kind: "block"; block: RibbonBlock; atMs: number }
  | { kind: "gap"; atMs: number };

export const RIBBON_TICK_HOURS = [3, 6, 9, 12, 15, 18, 21] as const;
export const RIBBON_LABEL_HOURS = [0, 6, 12, 18, 24] as const;
/** A block this narrow or narrower is still drawn this wide (points), as in the prototype. */
export const RIBBON_MIN_BLOCK_WIDTH = 3;
/** Neighbouring ribbon blocks sit this far apart (owner, X2). */
export const RIBBON_BLOCK_GAP = 1;

/**
 * A block's reach: its time, at least the minimum width, but never past where the next block starts
 * when that one starts after this one ends (blocks that overlap in time stack instead).
 */
export function ribbonBlockReachMs(model: Pick<RibbonModel, "blocks">, block: Pick<RibbonBlock, "startMs" | "endMs">, minimumMs: number) {
  let next = Number.POSITIVE_INFINITY;
  for (const other of model.blocks) {
    if (other.startMs >= block.endMs && other.startMs > block.startMs && other.startMs < next) next = other.startMs;
  }
  return Math.min(Math.max(block.endMs, block.startMs + minimumMs), next);
}

/**
 * Where a ribbon block is drawn: its reach, less half the gap on each side, so neighbours never
 * touch and what is drawn always lies inside what a tap selects.
 */
export function ribbonBlockFrame(model: Pick<RibbonModel, "blocks" | "dayStartMs" | "dayMs">, block: Pick<RibbonBlock, "startMs" | "endMs">, trackWidth: number) {
  const perMs = trackWidth / model.dayMs;
  const reach = ribbonBlockReachMs(model, block, RIBBON_MIN_BLOCK_WIDTH / perMs);
  const start = (block.startMs - model.dayStartMs) * perMs;
  return { x: start + RIBBON_BLOCK_GAP / 2, width: Math.max(0, (reach - block.startMs) * perMs - RIBBON_BLOCK_GAP) };
}

export function buildTodayRibbon({
  entries,
  pending,
  nowMs,
}: {
  entries: readonly MobileTimeEntry[];
  pending: readonly TodayActivity[];
  nowMs: number;
}): RibbonModel {
  const start = new Date(nowMs);
  start.setHours(0, 0, 0, 0);
  const dayStartMs = start.getTime();
  const next = new Date(start);
  next.setDate(start.getDate() + 1);
  const dayMs = next.getTime() - dayStartMs;
  const place = (from: number, to: number) => ({ left: (from - dayStartMs) / dayMs, width: (to - from) / dayMs });

  const logged: RibbonBlock[] = [];
  for (const entry of entries) {
    const from = Math.max(Date.parse(entry.startedAt), dayStartMs);
    const to = Math.min(entry.stoppedAt ? Date.parse(entry.stoppedAt) : nowMs, next.getTime(), nowMs);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    logged.push({
      kind: "entry",
      key: `entry:${entry.id}`,
      entry,
      color: entry.categoryColor ?? entry.categoryId ?? null,
      startMs: from,
      endMs: to,
      live: !entry.stoppedAt,
      title: displayTimerDescription(entry)?.trim() || entry.categoryName || "No activity",
      ...place(from, to),
    });
  }
  const waiting: RibbonBlock[] = [];
  for (const activity of pending) {
    const interval = activity.clippedInterval ?? activity.interval;
    if (!activity.awaitingDecision || !interval) continue;
    const from = Math.max(interval.startMs, dayStartMs);
    const to = Math.min(interval.endMs, next.getTime());
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;
    waiting.push({
      kind: "pending",
      key: `pending:${activity.presentationKey}`,
      activity,
      color: activity.category?.color ?? activity.category?.name ?? null,
      startMs: from,
      endMs: to,
      live: false,
      title: activity.title,
      ...place(from, to),
    });
  }
  const byStart = (a: RibbonBlock, b: RibbonBlock) => a.startMs - b.startMs || a.key.localeCompare(b.key);
  return {
    dayStartMs,
    dayMs,
    nowMs,
    now: nowMs >= dayStartMs && nowMs < next.getTime() ? (nowMs - dayStartMs) / dayMs : null,
    blocks: [...waiting.sort(byStart), ...logged.sort(byStart)],
  };
}

/**
 * Where a wall-clock hour sits on the strip. On a clock-change day (23 or 25 hours) the hours are
 * not evenly spaced, so ticks and labels follow the real day like the blocks do.
 */
export function ribbonHourFraction(model: Pick<RibbonModel, "dayStartMs" | "dayMs">, hour: number) {
  if (hour >= 24) return 1;
  const date = new Date(model.dayStartMs);
  date.setHours(hour, 0, 0, 0);
  return (date.getTime() - model.dayStartMs) / model.dayMs;
}

/**
 * What the finger is over at `fraction` of the day. A logged block wins over waiting Review time;
 * among overlapping logged blocks the one that started last (drawn on top) wins. `minFraction` is
 * the drawn minimum width, so a block drawn wider than its time is hit where it is drawn.
 */
/**
 * The block under a point. What is drawn wins: a block whose drawn frame (ribbonBlockFrame: at
 * least the minimum width, less half the gap each side) holds the point, the top one first (logged
 * time over a suggestion, later over earlier, as drawn). Only in a gap between drawn frames does the
 * nearest block's full frame answer, so a tap there still lands.
 */
export function ribbonHitAt(model: RibbonModel, fraction: number, minFraction = 0, gapFraction = 0): RibbonHit {
  const atMs = model.dayStartMs + Math.min(1, Math.max(0, fraction)) * model.dayMs;
  const minMs = minFraction * model.dayMs;
  const halfGapMs = (gapFraction * model.dayMs) / 2;
  const top = (blocks: RibbonBlock[]) => blocks.filter((block) => block.kind === "entry").pop() ?? blocks.pop();
  const reach = (block: RibbonBlock) => ribbonBlockReachMs(model, block, minMs);
  const drawn = model.blocks.filter((block) => atMs >= block.startMs + halfGapMs && atMs <= reach(block) - halfGapMs);
  const hit = top(drawn) ?? top(model.blocks.filter((block) => atMs >= block.startMs && atMs <= reach(block)));
  return hit ? { kind: "block", block: hit, atMs } : { kind: "gap", atMs };
}

function clock(ms: number) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function duration(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  if (!hours) return `${minutes}m`;
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** The scrub tooltip: the block's title and "08:13–10:00 · 1h 47m", or the time and "Untracked". */
export function ribbonTip(hit: RibbonHit): { title: string; detail: string } {
  if (hit.kind === "gap") return { title: clock(hit.atMs), detail: "Untracked" };
  const { block } = hit;
  const detail = [
    `${clock(block.startMs)}–${block.live ? "now" : clock(block.endMs)}`,
    duration(block.endMs - block.startMs),
    block.kind === "pending" ? "needs review" : null,
  ].filter(Boolean).join(" · ");
  return { title: block.title, detail };
}

/** What VoiceOver reads for a block when stepping through the ribbon. */
export function ribbonSpokenBlock(block: RibbonBlock) {
  const minutes = Math.floor((block.endMs - block.startMs) / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const spoken = [hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : null, rest || !hours ? `${rest} ${rest === 1 ? "minute" : "minutes"}` : null]
    .filter(Boolean)
    .join(" ");
  return `${block.title}, ${clock(block.startMs)} to ${block.live ? "now" : clock(block.endMs)}, ${spoken}${block.kind === "pending" ? ", needs review" : ""}`;
}
