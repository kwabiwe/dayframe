import {
  clipCoveredEntry,
  COVERED_ACTIVITY_OTHER_KEY,
  coveredActivityBars,
  coveredActivityKey,
  coveredActivityTotals,
  formatDuration,
} from "@dayframe/shared";
import { spokenDuration } from "../components/today/todayBlocksLayout";

/**
 * "Where today went" on iPhone Today (owner decision 14 Oct 2026, PRD D15): today's covered time
 * per activity, folded into the bottom of the Today ribbon card. Every activity is included, Sleep
 * and others that don't count toward the goal too, and overlapping time is shared equally among
 * the activities running in it (`coveredActivityTotals`, the same algorithm as web #409), so the
 * segments add up exactly to Today's covered hero (D14). Four slots: every activity when there are
 * four or fewer, otherwise the top three and a neutral "Other". Built on the per-minute clock.
 */
export const WHERE_WENT_SLOTS = 4;

type WhereWentEntry = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  categoryColor?: string | null;
};

export type WhereWentSegment = {
  key: string;
  name: string;
  /** The activity's colour key (null: no activity, or Other), drawn with its display value. */
  color: string | null;
  seconds: number;
  /** "4h 17m", the shared duration format (UIA-042). */
  duration: string;
  /** Holds the running block: the segment carries the 2-point coral edge. */
  live: boolean;
  /** On Other only: the activities it holds, largest first. */
  includes?: string[];
};

export type TodayWhereWentModel = {
  segments: WhereWentSegment[];
  totalSeconds: number;
  accessibilityLabel: string;
};

export function buildTodayWhereWent({ entries, nowMs }: { entries: readonly WhereWentEntry[]; nowMs: number }): TodayWhereWentModel | null {
  const dayStart = new Date(nowMs);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const startMs = dayStart.getTime();
  const endMs = dayEnd.getTime();
  // Colours as the goal cells read them (a stored key, else the activity id as the seed).
  const sources = entries.map((entry) => ({ ...entry, categoryColor: entry.categoryColor ?? entry.categoryId ?? null }));
  const totals = coveredActivityTotals(sources, startMs, endMs, nowMs);
  const totalSeconds = totals.reduce((sum, total) => sum + total.seconds, 0);
  // Empty until the day holds a whole minute, so a block started this minute never flashes a strip.
  if (totalSeconds < 60) return null;
  const liveKeys = new Set(
    sources
      .filter((entry) => !entry.stoppedAt && clipCoveredEntry(entry, startMs, endMs, nowMs))
      .map((entry) => coveredActivityKey(entry))
  );
  const otherKeys = new Set(totals.length > WHERE_WENT_SLOTS ? totals.slice(WHERE_WENT_SLOTS - 1).map((total) => total.key) : []);
  const segments = coveredActivityBars(totals, WHERE_WENT_SLOTS).map((bar): WhereWentSegment => ({
    key: bar.key,
    name: bar.name,
    color: bar.color,
    seconds: bar.seconds,
    duration: formatDuration(bar.seconds),
    live: bar.key === COVERED_ACTIVITY_OTHER_KEY ? [...otherKeys].some((key) => liveKeys.has(key)) : liveKeys.has(bar.key),
    ...(bar.includes ? { includes: bar.includes } : {}),
  }));
  return { segments, totalSeconds, accessibilityLabel: whereWentSpokenLabel(segments, totalSeconds) };
}

/** "Where today went. Work, 4 hours 17 minutes, recording. … 7 hours 22 minutes in all." */
export function whereWentSpokenLabel(segments: readonly WhereWentSegment[], totalSeconds: number) {
  const parts = segments.map((segment) => {
    const name = segment.includes ? `Other: ${listNames(segment.includes)}` : segment.name;
    return `${name}, ${spokenDuration(segment.seconds)}${segment.live ? ", recording" : ""}.`;
  });
  return ["Where today went.", ...parts, `${spokenDuration(totalSeconds)} in all.`].join(" ");
}

function listNames(names: readonly string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Whether a strip that appears now fades in (motion.md): never on the first paint, hydration, a
 * cached launch or a refresh (`quiet`: the commit that brought the Dashboard's data from a load);
 * only when it appears mid-session, for example the first minute of the day's first block.
 */
export function whereWentEntranceAllowed({ painted, quiet }: { painted: boolean; quiet: boolean }) {
  return painted && !quiet;
}
