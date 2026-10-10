import type { ReviewMutation, ReviewMutationEdit } from "@dayframe/shared";
import type { CategoryRow, ReviewItemRow } from "@/lib/queries";

// Web Review (Blocks parity step 13): the queue, the card and the Log it / Skip decision, built on
// the same Review mutation contract as the iPhone deck (apps/mobile/src/lib/reviewDeck.ts,
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

export function reviewConfidence(confidence: string) {
  switch (confidence) {
    case "high":
      return { label: "High", score: 5 };
    case "medium_high":
      return { label: "Medium high", score: 4 };
    case "medium":
      return { label: "Medium", score: 3 };
    case "low":
      return { label: "Low", score: 2 };
    case "hint":
      return { label: "Hint", score: 1 };
    default:
      return { label: "Unknown", score: 0 };
  }
}

/** The card's heading: what the moment is, never an address. */
export function reviewTitle(item: Pick<ReviewItemRow, "title" | "eventSource" | "eventType" | "rawPayload" | "placeName">) {
  const evidenceKind = typeof item.rawPayload?.evidenceKind === "string" ? item.rawPayload.evidenceKind : null;
  if (isTimeAway(item)) return item.title?.trim() || "Time away";
  if (item.eventType === "commute_detected") return item.title?.trim() || "Commute";
  const visit = item.eventType === "learned_place_visit" || item.eventType === "geofence_exit" || evidenceKind === "learned_place";
  if (visit && item.placeName) return `Visit to ${item.placeName}`;
  return item.title?.trim() || "Suggestion";
}

/** The name "Log as" starts from: the suggestion's own title. */
export function reviewDefaultName(item: Pick<ReviewItemRow, "title" | "eventSource" | "eventType" | "rawPayload" | "placeName">) {
  return item.title?.trim() || reviewTitle(item);
}

/** Why Dayframe asked instead of logging it (the card's reason line). */
export function reviewReason(item: Pick<ReviewItemRow, "eventSource" | "eventType" | "rawPayload" | "suggestedPlaceId" | "notes">) {
  if (!isLocationItem(item)) return item.notes?.trim() || null;
  const reason = typeof item.rawPayload?.semanticReason === "string" ? item.rawPayload.semanticReason : null;
  switch (reason) {
    case "existing_review_preserved":
      return "Already waiting for you before automatic logging was turned on.";
    case "untrusted_commute_endpoints":
      return "The start or end place isn’t saved.";
    case "untrusted_place":
      return "This place isn’t saved.";
    case "short_journey_review_only":
      return "Short journeys aren’t added automatically.";
    case "journey_contains_stop":
      return "This trip includes a stop.";
    case "motion_review_only":
      return "Timed from Motion & Fitness.";
    case "time_away_review_only":
      return "Time away isn’t added automatically.";
    case "insufficient_route_evidence":
      return "Route evidence is limited.";
    case "boundary_uncertainty_exceeded":
      return "A start or end time is uncertain by more than five minutes.";
    case "boundary_bounds_missing":
    case "boundary_bounds_invalid":
    case "uncertain_boundary":
      return "The start or end time needs a check.";
    case "internal_route_gap":
      return "There is a gap in the journey evidence.";
    case "commute_overlap_exceeded":
      return "This journey overlaps tracked time by more than five minutes.";
    case "location_stay_conflict":
      return "This visit conflicts with another location block by more than five minutes.";
    case "insufficient_confidence":
      return "Confidence is below the automatic threshold.";
    case "review_mode":
      return "Automatic location logging is off.";
    case "segment_not_finalised":
      return "Location evidence is incomplete.";
    case "confirmed_time_overlap":
      return "It overlaps time you already tracked.";
    default:
      break;
  }
  if (item.rawPayload?.continuityStatus === "uncertain_gap") return "The start or end time needs a check.";
  if (item.eventType === "commute_detected" && !isTimeAway(item) && item.suggestedPlaceId == null) {
    return "The start or end place isn’t saved.";
  }
  if (item.eventType === "unknown_stay" && item.suggestedPlaceId == null) return "This place isn’t saved.";
  return "Dayframe asks before logging location time.";
}

export function reviewWindow(item: Pick<ReviewItemRow, "suggestedStartedAt" | "suggestedStoppedAt">) {
  const start = item.suggestedStartedAt ? Date.parse(item.suggestedStartedAt) : Number.NaN;
  const stop = item.suggestedStoppedAt ? Date.parse(item.suggestedStoppedAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return null;
  return { startMs: start, stopMs: stop };
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function clock(ms: number) {
  const date = new Date(ms);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function localDayStart(ms: number) {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

const SHORT_DAY = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });

export function reviewDayLabel(ms: number, nowMs: number) {
  const day = localDayStart(ms);
  const today = localDayStart(nowMs);
  if (day === today) return "Today";
  if (day === localDayStart(today - 12 * 3_600_000)) return "Yesterday";
  return SHORT_DAY.format(new Date(ms)).replace(",", "");
}

export function formatReviewDuration(ms: number) {
  const minutesTotal = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** "Today · 21:19–21:26"; a range over midnight names the end's day too. Null without a window. */
export function reviewWhen(item: Pick<ReviewItemRow, "suggestedStartedAt" | "suggestedStoppedAt">, nowMs: number) {
  const window = reviewWindow(item);
  if (!window) {
    const start = item.suggestedStartedAt ? Date.parse(item.suggestedStartedAt) : Number.NaN;
    return Number.isFinite(start) ? `${reviewDayLabel(start, nowMs)} · ${clock(start)}` : null;
  }
  const sameDay = localDayStart(window.startMs) === localDayStart(window.stopMs);
  return `${reviewDayLabel(window.startMs, nowMs)} · ${clock(window.startMs)}–${sameDay ? "" : `${reviewDayLabel(window.stopMs, nowMs)} `}${clock(window.stopMs)}`;
}

/**
 * A held decision is only saved for the suggestion the user saw: a refresh that changed its name,
 * times, activity or place means they decided about something else (iPhone reviewDeckProposalSignature).
 */
export function reviewProposalSignature(item: Pick<ReviewItemRow, "title" | "suggestedStartedAt" | "suggestedStoppedAt" | "suggestedCategoryId" | "suggestedPlaceId">) {
  return JSON.stringify([
    item.title ?? null,
    item.suggestedStartedAt ? Date.parse(item.suggestedStartedAt) : null,
    item.suggestedStoppedAt ? Date.parse(item.suggestedStoppedAt) : null,
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
  if (!reviewWindow(item)) return null;
  // A generic entry is stored with exactly this description, so an activity-only change keeps the
  // name the card shows; a Location visit derives its own name when none is sent.
  const description = nameChanged ? typed : hasV2Evidence(item) ? undefined : defaultName || undefined;
  return {
    categoryId: categoryChanged ? draft!.categoryId ?? null : item.suggestedCategoryId ?? null,
    ...(description ? { description } : {}),
    startedAt: item.suggestedStartedAt!,
    stoppedAt: item.suggestedStoppedAt!
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

/** The nearest other V2 stay within 15 minutes, which the evidence editor can merge with. */
export function adjacentV2StayReviewId(item: ReviewItemRow, candidates: readonly ReviewItemRow[]) {
  if (!hasV2Evidence(item) || item.eventType === "commute_detected") return undefined;
  const itemStart = Date.parse(String(item.suggestedStartedAt ?? ""));
  const itemStop = Date.parse(String(item.suggestedStoppedAt ?? ""));
  if (!Number.isFinite(itemStart) || !Number.isFinite(itemStop)) return undefined;
  const maximumAdjacentGapMs = 15 * 60_000;
  return candidates
    .flatMap((candidate) => {
      if (candidate.id === item.id || !hasV2Evidence(candidate) || candidate.eventType === "commute_detected") return [];
      const candidateStart = Date.parse(String(candidate.suggestedStartedAt ?? ""));
      const candidateStop = Date.parse(String(candidate.suggestedStoppedAt ?? ""));
      if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateStop)) return [];
      const gap = Math.min(Math.abs(candidateStart - itemStop), Math.abs(itemStart - candidateStop));
      return gap <= maximumAdjacentGapMs ? [{ id: candidate.id, gap }] : [];
    })
    .sort((a, b) => a.gap - b.gap || a.id.localeCompare(b.id))[0]?.id;
}

/** ↑ / ↓ through the queue, wrapping like the prototype. */
export function stepSelection(ids: readonly string[], currentId: string | null, step: 1 | -1) {
  if (!ids.length) return null;
  const index = currentId ? ids.indexOf(currentId) : -1;
  if (index < 0) return ids[0];
  return ids[(index + step + ids.length) % ids.length];
}

/** After a decision the next card is the one below, else the one above (prototype `decide`). */
export function nextAfterDecision(ids: readonly string[], decidedId: string) {
  const index = ids.indexOf(decidedId);
  if (index < 0) return ids[0] ?? null;
  return ids[index + 1] ?? ids[index - 1] ?? null;
}
