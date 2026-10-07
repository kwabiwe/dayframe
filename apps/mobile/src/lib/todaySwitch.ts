import type { MobileTimeEntry } from "./api";
import { displayTimerDescription } from "./timerPresentation";

/** How far the live block must be pulled left before releasing it opens the Switch sheet. */
export const LIVE_SWIPE_COMMIT = 90;
/** Past the commit point the block follows the finger at this rate, as in the prototype. */
export const LIVE_SWIPE_RUBBER_BAND = 0.35;

/** Where the live block sits for a leftward pull of `dx` (never right of rest). */
export function liveSwipeOffset(dx: number) {
  "worklet";
  const pull = Math.min(0, dx);
  return pull < -LIVE_SWIPE_COMMIT ? -LIVE_SWIPE_COMMIT + (pull + LIVE_SWIPE_COMMIT) * LIVE_SWIPE_RUBBER_BAND : pull;
}

export const SWITCH_RECENT_LIMIT = 6;

export type SwitchRecent = {
  entry: MobileTimeEntry;
  /** "Deep work", the description a pick starts with. */
  title: string;
};

function description(entry: Pick<MobileTimeEntry, "description">) {
  return displayTimerDescription(entry)?.trim() ?? "";
}

/**
 * "Pick up something recent" (Blocks prototype Switch sheet): the most recently finished blocks
 * with a description, newest first, one per activity and description, leaving out what is
 * recording now. At most six.
 */
export function switchRecents(
  entries: readonly MobileTimeEntry[],
  active: Pick<MobileTimeEntry, "categoryId" | "description" | "id"> | null,
  limit = SWITCH_RECENT_LIMIT
): SwitchRecent[] {
  const activeDescription = active ? description(active).toLowerCase() : null;
  const seen = new Set<string>();
  const recents: SwitchRecent[] = [];
  const finished = entries
    .filter((entry) => entry.stoppedAt && entry.id !== active?.id && description(entry))
    .sort((a, b) => Date.parse(b.stoppedAt as string) - Date.parse(a.stoppedAt as string));
  for (const entry of finished) {
    const title = description(entry);
    const lower = title.toLowerCase();
    if (activeDescription && lower === activeDescription) continue;
    const key = `${entry.categoryId ?? ""}|${lower}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recents.push({ entry, title });
    if (recents.length >= limit) break;
  }
  return recents;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Work · last Tue 6", as in the prototype; "today" and "yesterday" read as words. */
export function switchRecentMeta(entry: Pick<MobileTimeEntry, "categoryName" | "startedAt">, nowMs: number) {
  const started = new Date(entry.startedAt);
  const today = new Date(nowMs);
  const dayDiff = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(started.getFullYear(), started.getMonth(), started.getDate()).getTime()) /
      86_400_000
  );
  const when = dayDiff <= 0 ? "today" : dayDiff === 1 ? "yesterday" : `${WEEKDAYS[started.getDay()]} ${started.getDate()}`;
  return [entry.categoryName ?? "No activity", `last ${when}`].join(" · ");
}
