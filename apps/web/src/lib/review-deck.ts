import { groupOutings, type CardOuting, type ReviewMutation, type ReviewMutationEdit } from "@dayframe/shared";
import type { CategoryRow, ReviewItemRow } from "@/lib/queries";

// Review helpers for the List's and Grid's "?" (location v4 steps 14–15; the web Review deck is gone): the picture,
// title, window and Log it / Skip decision, built on the same Review mutation contract as the iPhone deck (apps/mobile/src/lib/reviewDeck.ts,
// reviewLogAs.ts and review.ts carry the iPhone versions of these helpers).

export type ReviewPicture = "place" | "commute" | "workout" | "sleep" | "suggestion";
export type ReviewDecisionKind = "log" | "skip";

/** Location V2 evidence: decided with confirm / ignore_once_location and editable in the evidence panel. */
export function hasV2Evidence(item: Pick<ReviewItemRow, "eventSource" | "rawPayload">) {
  return item.eventSource === "location_learning" &&
    (item.rawPayload?.algorithmVersion === "location-v2.0" || typeof item.rawPayload?.clientSegmentId === "string");
}

export function isTimeAway(item: Pick<ReviewItemRow, "eventType" | "rawPayload">) {
  return item.eventType === "commute_detected" && item.rawPayload?.qualificationReason === "same_place_outing";
}

function isLocationItem(item: Pick<ReviewItemRow, "eventSource" | "eventType">) {
  return item.eventType === "commute_detected" ||
    item.eventType === "learned_place_visit" ||
    item.eventType === "geofence_exit" ||
    item.eventType === "unknown_stay" ||
    item.eventSource === "location_learning" ||
    item.eventSource === "geofence_specific" ||
    item.eventSource === "geofence_broad" ||
    item.eventSource === "ha_geofence";
}

export function reviewPicture(item: Pick<ReviewItemRow, "eventSource" | "eventType" | "rawPayload">): ReviewPicture {
  if (item.eventType === "commute_detected" && !isTimeAway(item)) return "commute";
  if (item.eventType?.startsWith("health_sleep") || item.eventSource?.startsWith("health_sleep")) return "sleep";
  if (item.eventSource?.startsWith("health_") || item.eventType?.startsWith("health_")) return "workout";
  if (isLocationItem(item) || isTimeAway(item)) return "place";
  return "suggestion";
}

export function reviewSourceLabel(picture: ReviewPicture) {
  if (picture === "sleep" || picture === "workout") return "Apple Health";
  if (picture === "commute" || picture === "place") return "Location";
  return "Suggestion";
}

/** The card's heading: what the moment is, never an address. */
export function reviewTitle(item: Pick<ReviewItemRow, "title" | "eventSource" | "eventType" | "rawPayload" | "placeName">) {
  const evidenceKind = typeof item.rawPayload?.evidenceKind === "string" ? item.rawPayload.evidenceKind : null;
  // Stays and Moves carry the server's title (PRD D19, D21): "Peak Gym", "Commute", "Getting around".
  if (item.eventType === "commute_detected") return item.title?.trim() || "Getting around";
  const visit = item.eventType === "learned_place_visit" || item.eventType === "geofence_exit" || evidenceKind === "learned_place";
  return item.title?.trim() || (visit && item.placeName) || "Suggestion";
}

/** The name "Log as" starts from: the suggestion's own title. */
export function reviewDefaultName(item: Pick<ReviewItemRow, "title" | "eventSource" | "eventType" | "rawPayload" | "placeName">) {
  return item.title?.trim() || reviewTitle(item);
}

/**
 * A suggested time as epoch milliseconds. Server-rendered props carry timestamps as `Date` objects
 * while a refreshed bootstrap carries ISO strings; both must read as the same instant (to the ms).
 */
export function timeMs(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value) return Date.parse(value);
  return Number.NaN;
}

function nullableMs(value: unknown) {
  const ms = timeMs(value);
  return Number.isFinite(ms) ? ms : null;
}

export function reviewWindow(item: Pick<ReviewItemRow, "suggestedStartedAt" | "suggestedStoppedAt">) {
  const start = timeMs(item.suggestedStartedAt);
  const stop = timeMs(item.suggestedStoppedAt);
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return null;
  return { startMs: start, stopMs: stop };
}


/**
 * A held decision is only saved for the suggestion the user saw: a refresh that changed its name,
 * times, activity or place means they decided about something else (iPhone reviewDeckProposalSignature).
 */
export function reviewProposalSignature(item: Pick<ReviewItemRow, "title" | "suggestedStartedAt" | "suggestedStoppedAt" | "suggestedCategoryId" | "suggestedPlaceId">) {
  return JSON.stringify([
    item.title ?? null,
    nullableMs(item.suggestedStartedAt),
    nullableMs(item.suggestedStoppedAt),
    item.suggestedCategoryId ?? null,
    item.suggestedPlaceId ?? null
  ]);
}

export type ReviewLogAsDraft = {
  /** What the user typed, or undefined when the field was never edited. */
  name?: string;
  /** The activity picked on the card (null = No activity), or undefined when never changed. */
  categoryId?: string | null;
};

/**
 * Logging sends edit_and_confirm only when the user really changed the name or the activity;
 * otherwise the plain confirm/accept is sent, as on iPhone (the server keeps a moment's source and
 * confidence either way since #261). Needs a complete suggested window, as the edit contract does.
 */
export function reviewLogAsEdit(item: ReviewItemRow, draft: ReviewLogAsDraft | undefined): ReviewMutationEdit | null {
  const typed = draft?.name?.trim();
  const defaultName = reviewDefaultName(item);
  const nameChanged = typed !== undefined && typed !== "" && typed !== defaultName;
  const categoryChanged = draft?.categoryId !== undefined && draft.categoryId !== item.suggestedCategoryId;
  if (!nameChanged && !categoryChanged) return null;
  const span = reviewWindow(item);
  if (!span) return null;
  // A generic entry is stored with exactly this description, so an activity-only change keeps the
  // name the card shows; a Location visit derives its own name when none is sent.
  const description = nameChanged ? typed : hasV2Evidence(item) ? undefined : defaultName || undefined;
  return {
    categoryId: categoryChanged ? draft!.categoryId ?? null : item.suggestedCategoryId ?? null,
    ...(description ? { description, ...(nameChanged ? { descriptionTyped: true as const } : {}) } : {}),
    startedAt: new Date(span.startMs).toISOString(),
    stoppedAt: new Date(span.stopMs).toISOString()
  };
}

export function reviewMutationFor(item: ReviewItemRow, kind: ReviewDecisionKind, draft: ReviewLogAsDraft | undefined): ReviewMutation {
  const v2 = hasV2Evidence(item);
  if (kind === "skip") return v2 ? { action: "ignore_once_location" } : { action: "ignore_once" };
  const edit = reviewLogAsEdit(item, draft);
  if (edit) return { action: "edit_and_confirm", edit };
  return v2 ? { action: "confirm" } : { action: "accept" };
}

/** The activity the card shows: the picked one (still active), else the suggestion's. */
export function reviewCardCategory(item: ReviewItemRow, draft: ReviewLogAsDraft | undefined, categories: readonly CategoryRow[]) {
  const pickedId = draft?.categoryId !== undefined ? draft.categoryId : item.suggestedCategoryId;
  if (pickedId === null) return null;
  const found = categories.find((category) => category.id === pickedId);
  if (found) return { id: found.id, name: found.name, color: found.color as unknown };
  if (pickedId === item.suggestedCategoryId && item.categoryName) {
    return { id: pickedId, name: item.categoryName, color: item.categoryColor as unknown };
  }
  return null;
}

/** A drafted activity that has been archived or removed since it was picked falls back to the suggestion's. */
export function activeDraft(draft: ReviewLogAsDraft | undefined, categories: readonly CategoryRow[]): ReviewLogAsDraft | undefined {
  if (!draft || draft.categoryId === undefined || draft.categoryId === null) return draft;
  return categories.some((category) => category.id === draft.categoryId) ? draft : { ...draft, categoryId: undefined };
}

export type ReviewOuting = CardOuting<ReviewItemRow>;

/**
 * The outings among these cards (PRD D19): an unknown Stay's card (the anchor) with the Move cards
 * that share its key (shared `groupOutings`, as the iPhone deck groups them).
 */
export function reviewOutings(items: readonly ReviewItemRow[]) {
  return groupOutings(items);
}

/** Log it / Skip on a grouped card: every member decided together; "Log as" applies to the Stay. */
export function outingMutationFor(outing: ReviewOuting, kind: ReviewDecisionKind, draft: ReviewLogAsDraft | undefined): ReviewMutation {
  const memberReviewItemIds = outing.members.map((member) => member.id);
  if (kind === "skip") return { action: "ignore_outing", memberReviewItemIds };
  const edit = reviewLogAsEdit(outing.anchor, draft);
  return { action: "confirm_outing", memberReviewItemIds, ...(edit ? { edit } : {}) };
}
