import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "./api";

export const REVIEW_COPY = {
  needsReview: "Needs review",
  suggestedActivity: "Suggested time entry",
  detectedVisit: "Detected visit",
  editDetails: "Edit details",
  dismissSuggestion: "Dismiss suggestion",
  suggestedNote: "Some suggested time needs review.",
  emptyState: "No detected visits or suggested time entries need review."
} as const;

type MobileCategory = MobileBootstrap["categories"][number];

export type ReviewMenuAction = "edit" | "dismiss";

export type PendingReviewMenuAction = {
  action: ReviewMenuAction;
  itemId: string;
  token: number;
};

export type ReviewMenuState = {
  openItemId: string | null;
  closingItemId: string | null;
  pendingAction: PendingReviewMenuAction | null;
};

export type ReviewMenuEvent =
  | { type: "toggle"; itemId: string; disabled: boolean }
  | { type: "close" }
  | { type: "begin_action"; action: ReviewMenuAction; itemId: string; token: number }
  | { type: "menu_closed"; itemId: string }
  | { type: "finish_action"; itemId: string; token: number }
  | { type: "reconcile"; openItemIds: string[] }
  | { type: "reset" };

export const CLOSED_REVIEW_MENU_STATE: ReviewMenuState = {
  openItemId: null,
  closingItemId: null,
  pendingAction: null
};

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

export function isCalendarPreviewReviewItem(item: Pick<MobileReviewItem, "eventType">) {
  return item.eventType === "commute_detected";
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

function fallbackSemanticCategory(item: MobileReviewItem, categories: MobileCategory[]) {
  if (item.eventType === "commute_detected") {
    return categories.find(
      (candidate) => candidate.name.trim().toLowerCase() === "commute"
    );
  }
  return fallbackHealthCategory(item, categories);
}

export function reviewItemCategoryLabel(
  item: Pick<MobileReviewItem, "categoryName" | "eventSource" | "eventType">
) {
  const explicit = item.categoryName?.trim();
  if (explicit) return explicit;
  if (item.eventType === "commute_detected") return "Commute";
  if (isHealthReviewItem(item)) return "Health";
  return "No category";
}

export function reviewConfirmLabel(
  item: Pick<MobileReviewItem, "eventSource" | "eventType">
) {
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

export function reduceReviewMenuState(
  state: ReviewMenuState,
  event: ReviewMenuEvent
): ReviewMenuState {
  switch (event.type) {
    case "toggle":
      if (event.disabled || state.pendingAction || state.closingItemId) return state;
      if (state.openItemId === event.itemId) {
        return { ...state, openItemId: null, closingItemId: event.itemId };
      }
      if (state.openItemId) return state;
      return { ...state, openItemId: event.itemId };
    case "close":
      return state.openItemId == null
        ? state
        : { ...state, openItemId: null, closingItemId: state.openItemId };
    case "begin_action":
      if (!canRunReviewMenuAction(state, event.itemId)) return state;
      return {
        openItemId: null,
        closingItemId: event.itemId,
        pendingAction: {
          action: event.action,
          itemId: event.itemId,
          token: event.token
        }
      };
    case "menu_closed":
      return state.closingItemId === event.itemId
        ? { ...state, closingItemId: null }
        : state;
    case "finish_action":
      return (
        state.pendingAction?.itemId === event.itemId &&
        state.pendingAction.token === event.token
      )
        ? { ...state, pendingAction: null }
        : state;
    case "reconcile": {
      const openItemIds = new Set(event.openItemIds);
      const openItemRemoved = Boolean(
        state.openItemId && !openItemIds.has(state.openItemId)
      );
      const pendingItemRemoved = Boolean(
        state.pendingAction && !openItemIds.has(state.pendingAction.itemId)
      );
      if (!openItemRemoved && !pendingItemRemoved) return state;
      return {
        ...state,
        openItemId: openItemRemoved ? null : state.openItemId,
        closingItemId: openItemRemoved
          ? state.closingItemId ?? state.openItemId
          : state.closingItemId,
        pendingAction: pendingItemRemoved ? null : state.pendingAction
      };
    }
    case "reset":
      if (!state.openItemId && !state.pendingAction) return state;
      return {
        openItemId: null,
        closingItemId: state.closingItemId ?? state.openItemId,
        pendingAction: null
      };
  }
}

export function canRunReviewMenuAction(state: ReviewMenuState, itemId: string) {
  return (
    state.openItemId === itemId &&
    state.closingItemId == null &&
    state.pendingAction == null
  );
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
  return isLocationReviewItem(item) &&
    (
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

  if (overlapCount > 0) {
    return `Not added automatically · overlaps ${overlapCount} ${overlapCount === 1 ? "entry" : "entries"}`;
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
      return "Needs review · place isn’t saved";
    case "insufficient_route_evidence":
      return "Needs review · route evidence is limited";
    case "uncertain_boundary":
      return "Needs review · time range is uncertain";
    case "insufficient_confidence":
      return "Needs review · confidence is below the automatic threshold";
    case "review_mode":
      return "Needs review · automatic location logging is not enabled";
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
  if (item.eventType === "commute_detected" && item.suggestedPlaceId == null) {
    return "Needs review · start or end place isn’t saved";
  }
  if (item.eventType === "unknown_stay" && item.suggestedPlaceId == null) {
    return "Needs review · place isn’t saved";
  }
  return "Needs review before this location activity is recorded";
}
