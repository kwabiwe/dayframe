import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "./api";

export const REVIEW_COPY = {
  needsReview: "Needs review",
  suggestedActivity: "Suggested activity",
  confirm: "Confirm",
  edit: "Edit",
  dismiss: "Dismiss",
  suggestedNote: "Some suggested activity needs review.",
  emptyState: "No suggested activity needs review."
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
  const startedAt = parseTime(item.suggestedStartedAt);
  const stoppedAt = parseTime(item.suggestedStoppedAt) ?? new Date(now);
  if (!startedAt || Number.isNaN(stoppedAt.getTime()) || startedAt.getTime() >= stoppedAt.getTime()) return 0;
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
  ));

  return {
    id: item.id,
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: item.suggestedCategoryId,
    categoryName: item.categoryName ?? category?.name ?? null,
    categoryColor: category?.color ?? null,
    placeName: item.placeName,
    source: item.eventSource ?? "manual_app",
    confidence: item.confidence,
    reviewStatus: "needs_review",
    description: item.title.trim() || REVIEW_COPY.suggestedActivity,
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

function entryOverlapsRange(entry: MobileTimeEntry, rangeStart: Date, rangeEnd: Date, now: number) {
  const startedAt = parseTime(entry.startedAt);
  const stoppedAt = parseTime(entry.stoppedAt) ?? new Date(now);
  if (!startedAt || Number.isNaN(stoppedAt.getTime())) return false;
  return startedAt < rangeEnd && stoppedAt > rangeStart;
}

function reviewItemOverlapsRange(item: MobileReviewItem, rangeStart: Date, rangeEnd: Date, now: number) {
  const startedAt = parseTime(item.suggestedStartedAt ?? item.createdAt);
  const stoppedAt = parseTime(item.suggestedStoppedAt) ?? new Date(now);
  if (!startedAt || Number.isNaN(stoppedAt.getTime())) return false;
  return startedAt < rangeEnd && stoppedAt > rangeStart;
}

function parseTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
