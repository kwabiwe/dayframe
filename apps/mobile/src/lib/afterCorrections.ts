import type { MobileAccountOwner } from "./mobileAccount";
import type { ReviewAnswerVenue } from "./reviewAnswer";
import { registerAfterCorrections, type AfterCorrectionsQueue } from "./reviewAnswersAfterCorrections";
import { readAcknowledgedTimelineCorrections, readPendingTimelineCorrections } from "./timelineCorrectionOutbox";

/** The correction queue, as waiting answers and logs read it. */
export const TIMELINE_CORRECTION_QUEUE: AfterCorrectionsQueue = {
  readPending: readPendingTimelineCorrections,
  readAcknowledged: (owner) => readAcknowledgedTimelineCorrections(owner)
};

/**
 * The one way an answer to a "?" from its sheet, or a Logs as, is kept when corrections must reach the server first
 * (Codex r6 on #610): every answer path (Yes / Not now, with or without new changes) and every Logs as path (Yes with
 * an activity, Done, Save this place, plain Logs as) calls this, so none goes ahead of a correction still queued for
 * its place or trip — this sheet's new ones (`newIds`) or one from an earlier Done. Null: nothing to wait for, so it
 * may go at once.
 */
export function waitForItemCorrections(owner: MobileAccountOwner, input: {
  id: string;
  /** The place or trip the answer or log is about. */
  itemId: string;
  /** An outing's trips (their segments): their queued corrections are waited for too (Codex r10 on #610). */
  memberItemIds?: readonly string[];
  newIds: readonly string[];
  /**
   * `logAsCategoryId`: Yes to a guessed venue with an activity picked (Codex r1 on #620); kept as the record's `log`
   * beside its `venue`, and released as one `record_poi_once` with that activity, never as `log_place`.
   */
  action: { kind: "answer"; reviewItemId: string; logged: boolean; venue?: ReviewAnswerVenue | null; logAsCategoryId?: string | null;
    outingMemberIds?: readonly string[] }
    | { kind: "log"; categoryId: string };
}) {
  return registerAfterCorrections(owner, {
    id: input.id,
    reviewItemId: input.action.kind === "answer" ? input.action.reviewItemId : "",
    logged: input.action.kind === "answer" ? input.action.logged : true,
    ...(input.action.kind === "answer" && input.action.venue ? { venue: input.action.venue } : {}),
    ...(input.action.kind === "answer" && input.action.venue && input.action.logged && input.action.logAsCategoryId
      ? { log: { itemId: input.itemId, categoryId: input.action.logAsCategoryId } } : {}),
    ...(input.action.kind === "log" ? { log: { itemId: input.itemId, categoryId: input.action.categoryId } } : {}),
    ...(input.action.kind === "answer" && input.action.outingMemberIds?.length ? { outingMemberIds: input.action.outingMemberIds } : {}),
    newIds: input.newIds,
    itemIds: [input.itemId, ...(input.memberItemIds ?? [])]
  }, TIMELINE_CORRECTION_QUEUE);
}
