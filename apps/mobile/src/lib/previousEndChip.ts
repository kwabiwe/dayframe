import type { PreviousEndOffer } from "@dayframe/shared";

/** Shown when the end the chip offered has moved since the sheet opened (PRD D16). */
export const PREVIOUS_END_CHANGED_MESSAGE = "That gap has changed, so the start was not moved. Check the start time.";

/**
 * The offer the sheet showed is still the one the Dashboard works out now, for the same running
 * block. The chip is fixed for the presentation (it never appears or leaves while the sheet is up),
 * so before it moves the start, and again on Done, it checks the end has not moved since — a
 * refresh, another device or a reconciled queued Stop can change it (Codex r1 on #419).
 *
 * The block is recognised by its saved start, not its id: Play opens the sheet on an optimistic
 * block whose id becomes the server's when the Start is accepted, and its start does not change
 * (Codex r2 on #419).
 */
export function previousEndStillHolds({
  current,
  currentEntryStartedAt,
  presented,
  presentedEntryStartedAt
}: {
  current: PreviousEndOffer | null | undefined;
  currentEntryStartedAt: string | null | undefined;
  presented: PreviousEndOffer | null;
  presentedEntryStartedAt: string | null;
}) {
  const sameBlock = Boolean(
    presentedEntryStartedAt &&
      currentEntryStartedAt &&
      Date.parse(presentedEntryStartedAt) === Date.parse(currentEntryStartedAt)
  );
  return Boolean(presented && current && sameBlock && current.startedAt === presented.startedAt);
}

/**
 * A draft start or end as an instant: the draft's own instant while its date and time fields still
 * show it, otherwise the fields parsed. In the hour repeated when the clocks go back, one local
 * date and time names two instants and parsing picks the first, so 01:15 GMT (the second 01:15)
 * would come back as 01:15 BST, an hour earlier (Codex r1 and r2 on #419).
 */
export function draftInstantMs({
  dateText,
  draftMs,
  formatDate,
  formatTime,
  parse,
  timeText
}: {
  dateText: string;
  draftMs: number;
  formatDate: (date: Date) => string;
  formatTime: (date: Date) => string;
  parse: () => number | null;
  timeText: string;
}) {
  if (Number.isFinite(draftMs) && draftMs > 0) {
    const own = new Date(draftMs);
    if (formatDate(own) === dateText && formatTime(own) === timeText) return draftMs;
  }
  return parse();
}
