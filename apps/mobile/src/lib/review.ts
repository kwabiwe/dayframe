import { isTimerTripClashItem } from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "./api";

export const REVIEW_COPY = {
  needsReview: "Needs review",
  suggestedActivity: "Suggested block",
  detectedVisit: "Detected visit",
  editDetails: "Edit before logging",
  dismissSuggestion: "Skip",
  suggestedNote: "Some suggested time needs review.",
  emptyState: "No detected visits or suggested blocks need review."
} as const;

export const LOCATION_EVIDENCE_LOADING_FEEDBACK_DELAY_MS = 300;

export function scheduleLocationEvidenceLoadingFeedback(onShow: () => void) {
  const timeout = setTimeout(
    onShow,
    LOCATION_EVIDENCE_LOADING_FEEDBACK_DELAY_MS
  );
  return () => clearTimeout(timeout);
}

type MobileCategory = MobileBootstrap["categories"][number];

export type OptimisticReviewRemoval = {
  index: number;
  item: MobileReviewItem;
  precedingItemIds: string[];
  followingItemIds: string[];
};

export function isReviewNeededEntry(entry: Pick<MobileTimeEntry, "reviewStatus">) {
  return entry.reviewStatus === "needs_review";
}

export function isOpenReviewItem(item: Pick<MobileReviewItem, "status">) {
  return item.status === "open";
}

/**
 * Whether a Review item asks on a block (location v4 design §7): "a block ran into your trip"
 * (`location_timer_trip_clash`, by its Review type or its event's — the type is optional in an older bootstrap, and
 * Review presentation records carry only the event's). It is one "?" like any other — counted by the badge, the
 * List's "N to check", Today's chip and the evening reminder — but its dot and its question are on the block its
 * payload names (`timeEntryId`), never a List row, a dashed Grid block or a hatched Today span of its own.
 */
export function asksOnItsBlock(item: { type?: string | null; eventType?: string | null }) {
  return isTimerTripClashItem(item);
}

/** Whether a "?" is drawn as its own row or span (a List check row, a dashed Grid block, Today's hatched span). */
export function drawsAsOwnCheck(item: { type?: string | null; eventType?: string | null }) {
  return !asksOnItsBlock(item);
}

export function isOneOffLocationReviewItem(
  item: Pick<MobileReviewItem, "rawPayload">
) {
  return item.rawPayload?.evidenceKind === "one_off_activity";
}

export function hasSuggestedTimeWindow(
  item: Pick<MobileReviewItem, "suggestedStartedAt" | "suggestedStoppedAt">
) {
  const startedAt = parseTime(item.suggestedStartedAt);
  const stoppedAt = parseTime(item.suggestedStoppedAt);
  return Boolean(startedAt && stoppedAt && startedAt.getTime() < stoppedAt.getTime());
}

export function reviewItemDurationSeconds(
  item: Pick<MobileReviewItem, "suggestedStartedAt" | "suggestedStoppedAt">,
  now: number
) {
  void now;
  const startedAt = parseTime(item.suggestedStartedAt);
  const stoppedAt = parseTime(item.suggestedStoppedAt);
  if (!startedAt || !stoppedAt || startedAt.getTime() >= stoppedAt.getTime()) return 0;
  return Math.floor((stoppedAt.getTime() - startedAt.getTime()) / 1000);
}

export function buildReviewItemDraftEntry(
  item: MobileReviewItem,
  categories: MobileCategory[],
  now: number
): MobileTimeEntry | null {
  if (!isOpenReviewItem(item) || !hasSuggestedTimeWindow(item)) return null;

  const category =
    categories.find((candidate) => candidate.id === item.suggestedCategoryId) ??
    categories.find(
      (candidate) =>
        Boolean(item.categoryName) &&
        candidate.name.trim().toLowerCase() === item.categoryName!.trim().toLowerCase()
    ) ??
    (
      item.suggestedCategoryId == null && !item.categoryName?.trim()
        ? fallbackSemanticCategory(item, categories)
        : undefined
    );

  return {
    id: item.id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: item.suggestedCategoryId ?? category?.id ?? null,
    categoryName: item.categoryName ?? category?.name ?? null,
    categoryColor: category?.color ?? null,
    placeName: item.placeName,
    source: item.eventSource ?? "manual_app",
    confidence: item.confidence,
    reviewStatus: "needs_review",
    description: reviewItemDraftDescription(item),
    startedAt: item.suggestedStartedAt ?? new Date(now).toISOString(),
    stoppedAt: item.suggestedStoppedAt ?? new Date(now).toISOString(),
    durationSeconds: reviewItemDurationSeconds(item, now)
  };
}

export function hasReviewNeededActivityForRange({
  entries,
  now,
  rangeEnd,
  rangeStart,
  reviewItems
}: {
  entries: MobileTimeEntry[];
  now: number;
  rangeEnd: Date;
  rangeStart: Date;
  reviewItems: MobileReviewItem[];
}) {
  return (
    entries.some((entry) => isReviewNeededEntry(entry) && entryOverlapsRange(entry, rangeStart, rangeEnd, now)) ||
    reviewItems.some((item) => (
      isOpenReviewItem(item) &&
      reviewItemOverlapsRange(item, rangeStart, rangeEnd, now)
    ))
  );
}

export function countReviewNeededActivityForRange({
  entries,
  now,
  rangeEnd,
  rangeStart,
  reviewItems
}: {
  entries: MobileTimeEntry[];
  now: number;
  rangeEnd: Date;
  rangeStart: Date;
  reviewItems: MobileReviewItem[];
}) {
  const reviewEntryIds = new Set(
    entries
      .filter((entry) => isReviewNeededEntry(entry) && entryOverlapsRange(entry, rangeStart, rangeEnd, now))
      .map((entry) => entry.id)
  );
  const openReviewIds = reviewItems
    .filter((item) => isOpenReviewItem(item) && reviewItemOverlapsRange(item, rangeStart, rangeEnd, now))
    .map((item) => item.id);
  return reviewEntryIds.size + openReviewIds.length;
}

function entryOverlapsRange(entry: MobileTimeEntry, rangeStart: Date, rangeEnd: Date, now: number) {
  const startedAt = parseTime(entry.startedAt);
  const stoppedAt = parseTime(entry.stoppedAt) ?? new Date(now);
  if (!startedAt || Number.isNaN(stoppedAt.getTime())) return false;
  return startedAt < rangeEnd && stoppedAt > rangeStart;
}

function reviewItemOverlapsRange(item: MobileReviewItem, rangeStart: Date, rangeEnd: Date, now: number) {
  void now;
  const startedAt = parseTime(item.suggestedStartedAt ?? item.createdAt);
  const stoppedAt = parseTime(item.suggestedStoppedAt);
  if (!startedAt) return false;
  if (!stoppedAt) return startedAt >= rangeStart && startedAt < rangeEnd;
  if (Number.isNaN(stoppedAt.getTime())) return false;
  return startedAt < rangeEnd && stoppedAt > rangeStart;
}

function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fallbackHealthCategory(item: MobileReviewItem, categories: MobileCategory[]) {
  if (!isHealthReviewItem(item)) return undefined;
  const preferredName = item.eventType === "health_sleep_import" ? "sleep" : "health";
  return categories.find((candidate) => candidate.name.trim().toLowerCase() === preferredName)
    ?? categories.find((candidate) => candidate.name.trim().toLowerCase() === "health");
}

/** Time away from a saved or learned place: Review-only, never a journey or the Commute category. */
export function isTimeAwayReviewItem(item: Pick<MobileReviewItem, "eventType"> & { rawPayload?: MobileReviewItem["rawPayload"] }) {
  return item.eventType === "commute_detected" && item.rawPayload?.qualificationReason === "same_place_outing";
}

function fallbackSemanticCategory(item: MobileReviewItem, categories: MobileCategory[]) {
  // A legacy time-away card (no route line) suggested no activity; a Location v3 one is a Move.
  if (isTimeAwayReviewItem(item) && !item.rawPayload?.routeLabel) return undefined;
  if (item.eventType === "commute_detected") {
    // Only a Commute (Home ↔ Work, or an older server's journey) falls back to Commute; every other
    // Move to Getting around (PRD D19).
    // By starter key first, so a renamed starter is still found; then by its current name (and
    // Getting around's old name, "Travel"; Codex r1 on #502).
    const commute = item.title?.trim() === "Commute" || !item.rawPayload?.routeLabel;
    const [starterKey, names] = commute ? ["commute", ["commute"]] : ["travel", ["getting around", "travel"]];
    return categories.find((candidate) => candidate.starterKey === starterKey)
      ?? names.map((name) => categories.find((candidate) => candidate.name.trim().toLowerCase() === name)).find(Boolean);
  }
  return fallbackHealthCategory(item, categories);
}

export function reviewItemCategoryLabel(
  item: Pick<MobileReviewItem, "categoryName" | "eventSource" | "eventType"> & { rawPayload?: MobileReviewItem["rawPayload"] }
) {
  const explicit = item.categoryName?.trim();
  if (explicit) return explicit;
  if (isTimeAwayReviewItem(item)) return "No activity";
  if (item.eventType === "commute_detected") return "Commute";
  if (isHealthReviewItem(item)) return "Health";
  return "No activity";
}

export function reviewConfirmLabel(
  item: Pick<MobileReviewItem, "eventSource" | "eventType"> & { rawPayload?: MobileReviewItem["rawPayload"] }
) {
  if (isTimeAwayReviewItem(item)) return "Confirm trip";
  if (item.eventType === "commute_detected") return "Confirm commute";
  if (isLocationReviewItem(item)) return "Confirm visit";
  return "Confirm activity";
}

export function reviewConfidencePresentation(confidence: string) {
  switch (confidence) {
    case "high":
      return { label: "High", score: 5 } as const;
    case "medium_high":
      return { label: "Medium high", score: 4 } as const;
    case "medium":
      return { label: "Medium", score: 3 } as const;
    case "low":
      return { label: "Low", score: 2 } as const;
    case "hint":
      return { label: "Hint", score: 1 } as const;
    default:
      return { label: "Unknown", score: 1 } as const;
  }
}

export function reviewActionOrder(item: MobileReviewItem) {
  return [
    ...(hasV2LocationEvidence(item) ? ["view_evidence" as const] : []),
    "confirm" as const,
    "overflow" as const
  ];
}

export function isCurrentReviewEditPresentation(
  currentPresentationId: number | null,
  presentationId: number
) {
  return currentPresentationId !== null && currentPresentationId === presentationId;
}

export function removeReviewItemOptimistically(
  data: MobileBootstrap,
  itemId: string
): { data: MobileBootstrap; removal: OptimisticReviewRemoval } | null {
  const index = data.reviewItems.findIndex((item) => item.id === itemId);
  if (index < 0) return null;
  return {
    data: {
      ...data,
      reviewItems: data.reviewItems.filter((item) => item.id !== itemId)
    },
    removal: {
      index,
      item: data.reviewItems[index],
      precedingItemIds: data.reviewItems
        .slice(0, index)
        .map((item) => item.id),
      followingItemIds: data.reviewItems
        .slice(index + 1)
        .map((item) => item.id)
    }
  };
}

export function restoreReviewItemOptimistically(
  data: MobileBootstrap,
  removal: OptimisticReviewRemoval
) {
  if (data.reviewItems.some((item) => item.id === removal.item.id)) return data;
  const reviewItems = [...data.reviewItems];
  const followingIndex = removal.followingItemIds
    .map((itemId) => reviewItems.findIndex((item) => item.id === itemId))
    .find((index) => index >= 0);
  const precedingIndex = [...removal.precedingItemIds]
    .reverse()
    .map((itemId) => reviewItems.findIndex((item) => item.id === itemId))
    .find((index) => index >= 0);
  const insertionIndex = followingIndex
    ?? (precedingIndex == null
      ? Math.min(removal.index, reviewItems.length)
      : precedingIndex + 1);
  reviewItems.splice(insertionIndex, 0, removal.item);
  return { ...data, reviewItems };
}

export function hideTombstonedReviewItems(
  data: MobileBootstrap,
  tombstonedItemIds: Iterable<string>
) {
  const tombstones = new Set(tombstonedItemIds);
  if (tombstones.size === 0) return data;
  const reviewItems = data.reviewItems.filter((item) => !tombstones.has(item.id));
  return reviewItems.length === data.reviewItems.length
    ? data
    : { ...data, reviewItems };
}

function reviewItemDraftDescription(item: MobileReviewItem) {
  // Every Move, time away included, starts with no name: its block shows its activity (PRD D19).
  if (isTimeAwayReviewItem(item)) return null;
  if (
    item.eventType === "commute_detected" ||
    item.eventType === "learned_place_visit" ||
    isOneOffLocationReviewItem(item)
  ) return null;
  const title = item.title.trim();
  return title || REVIEW_COPY.suggestedActivity;
}

function isHealthReviewItem(item: Pick<MobileReviewItem, "eventSource" | "eventType">) {
  return item.eventSource?.startsWith("health_") || item.eventType?.startsWith("health_") || false;
}

export function isLocationReviewItem(
  item: Pick<MobileReviewItem, "eventSource" | "eventType">
) {
  return (
    item.eventType === "commute_detected" ||
    item.eventType === "learned_place_visit" ||
    item.eventType === "geofence_exit" ||
    item.eventType === "unknown_stay" ||
    item.eventSource === "location_learning" ||
    item.eventSource === "geofence_specific" ||
    item.eventSource === "geofence_broad" ||
    item.eventSource === "ha_geofence"
  );
}

export function hasV2LocationEvidence(item: MobileReviewItem) {
  return (item.presentationSourceKind === "location_v2" || isLocationReviewItem(item)) &&
    (
      item.presentationSourceKind === "location_v2" ||
      item.rawPayload?.algorithmVersion === "location-v2.0" ||
      typeof item.rawPayload?.clientSegmentId === "string"
    );
}

export function locationReviewReasonCopy(
  item: Pick<
    MobileReviewItem,
    "eventSource" | "eventType" | "rawPayload" | "suggestedPlaceId"
  >,
  overlapCount = 0
) {
  if (!isLocationReviewItem(item)) return null;

  if (overlapCount > 0 && !item.rawPayload?.semanticReason && !item.rawPayload?.policyVersion) {
    return `Not added automatically · overlaps ${overlapCount} ${overlapCount === 1 ? "block" : "blocks"}`;
  }

  const reason = typeof item.rawPayload?.semanticReason === "string"
    ? item.rawPayload.semanticReason
    : null;
  switch (reason) {
    case "existing_review_preserved":
      return "Already awaiting your decision before automatic logging was enabled";
    case "untrusted_commute_endpoints":
      return "Needs review · start or end place isn’t saved";
    case "untrusted_place":
      return item.eventType === "unknown_stay" ? "New place" : "Needs review · place isn’t saved";
    case "ambiguous_place":
      return "Needs review · near more than one saved place";
    case "short_journey_review_only":
      return "Needs review · short journeys aren’t added automatically";
    case "journey_contains_stop":
      return "Needs review · this trip includes a stop";
    case "motion_review_only":
      return "Needs review · timed from Motion & Fitness";
    case "time_away_review_only":
      return "Needs review · round trips like this aren’t added automatically";
    case "insufficient_route_evidence":
      return "Needs review · route evidence is limited";
    case "boundary_uncertainty_exceeded":
      return "A start or end boundary is uncertain by more than five minutes.";
    case "boundary_bounds_missing":
    case "boundary_bounds_invalid":
      return "The start or end time needs your review.";
    case "internal_route_gap":
      return "There is a gap in the journey evidence.";
    case "commute_overlap_exceeded":
      return "This commute overlaps tracked time by more than five minutes.";
    case "location_stay_conflict":
      return "This visit conflicts with another location activity by more than five minutes.";
    case "uncertain_boundary":
      return "Needs review · time range is uncertain";
    case "insufficient_confidence":
      return "Needs review · confidence is below the automatic threshold";
    // Log automatically fallbacks (location v3 bug 8): why a visit at a place with it on came here.
    case "auto_log_uncertain":
      return "Not logged automatically · location was less certain than usual";
    case "auto_log_overlap":
      return "Not logged automatically · it overlaps a block";
    case "auto_log_logged_before":
      return "Not logged automatically · this visit was logged once before";
    case "auto_log_offered_before":
      return "Not logged automatically · it was asked in Calendar before";
    case "auto_log_off":
      return "Log automatically is off for this place";
    // Moves that log themselves (PRD D19): why this trip came here instead.
    case "travel_mode_unknown":
      return "Not logged automatically · how you travelled isn’t clear";
    case "log_trips_off":
      return "Log trips automatically is off";
    case "trip_logged_before":
      return "Not logged automatically · this trip was logged once before";
    case "trip_logging_opted_out":
      return "Not logged automatically · you stopped logging trips like this";
    case "review_mode":
      // Journeys are never logged automatically in Review mode; an older visit card says only that.
      return item.eventType === "commute_detected" ? "Trips aren’t logged automatically yet" : "Not logged automatically";
    case "segment_not_finalised":
      return "Needs review · location evidence is incomplete";
    case "confirmed_time_overlap":
      return "Not added automatically · overlaps tracked time";
    default:
      break;
  }

  if (item.rawPayload?.continuityStatus === "uncertain_gap") {
    return "Needs review · time range is uncertain";
  }
  if (item.eventType === "commute_detected" && !isTimeAwayReviewItem(item) && item.suggestedPlaceId == null) {
    return "Needs review · start or end place isn’t saved";
  }
  if (item.eventType === "unknown_stay" && item.suggestedPlaceId == null) {
    return "Needs review · place isn’t saved";
  }
  return "Needs review before this location activity is recorded";
}
