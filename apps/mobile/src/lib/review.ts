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

export type ReviewMenuState = {
  openItemId: string | null;
  actionItemId: string | null;
};

export type ReviewMenuEvent =
  | { type: "toggle"; itemId: string; disabled: boolean }
  | { type: "close" }
  | { type: "begin_action"; itemId: string }
  | { type: "finish_action"; itemId: string }
  | { type: "reconcile"; openItemIds: string[] };

export const CLOSED_REVIEW_MENU_STATE: ReviewMenuState = {
  openItemId: null,
  actionItemId: null
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
      if (event.disabled || state.actionItemId) return state;
      return {
        ...state,
        openItemId: state.openItemId === event.itemId ? null : event.itemId
      };
    case "close":
      return state.openItemId == null ? state : { ...state, openItemId: null };
    case "begin_action":
      if (!canRunReviewMenuAction(state, event.itemId)) return state;
      return { openItemId: null, actionItemId: event.itemId };
    case "finish_action":
      return state.actionItemId === event.itemId
        ? { ...state, actionItemId: null }
        : state;
    case "reconcile":
      return state.openItemId && !event.openItemIds.includes(state.openItemId)
        ? { ...state, openItemId: null }
        : state;
  }
}

export function canRunReviewMenuAction(state: ReviewMenuState, itemId: string) {
  return state.openItemId === itemId && state.actionItemId == null;
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
