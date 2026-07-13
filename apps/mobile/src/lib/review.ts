import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "./api";

export const REVIEW_COPY = {
  needsReview: "Needs review",
  suggestedActivity: "Suggested time entry",
  detectedVisit: "Detected visit",
  confirm: "Confirm",
  edit: "Edit",
  dismiss: "Ignore",
  suggestedNote: "Some suggested time needs review.",
  emptyState: "No detected visits or suggested time entries need review."
} as const;

type MobileCategory = MobileBootstrap["categories"][number];

export function isReviewNeededEntry(entry: Pick<MobileTimeEntry, "reviewStatus">) {
  return entry.reviewStatus === "needs_review";
}

export function isOpenReviewItem(item: Pick<MobileReviewItem, "status">) {
  return item.status === "open";
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

  const category = categories.find((candidate) => (
    candidate.id === item.suggestedCategoryId ||
    (item.categoryName ? candidate.name === item.categoryName : false)
  )) ?? fallbackHealthCategory(item, categories);

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

function reviewItemDraftDescription(item: MobileReviewItem) {
  if (item.eventType === "commute_detected" || item.eventType === "learned_place_visit") return null;
  const title = item.title.trim();
  return title || REVIEW_COPY.suggestedActivity;
}

function isHealthReviewItem(item: Pick<MobileReviewItem, "eventSource" | "eventType">) {
  return item.eventSource?.startsWith("health_") || item.eventType?.startsWith("health_") || false;
}
