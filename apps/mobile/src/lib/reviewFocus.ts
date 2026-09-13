import type { LegacyReviewEntryPresentation } from "@dayframe/shared";
import type { MobileTimeEntry } from "./api";

export type ReviewFocusRequest =
  | { kind: "review"; id: string }
  | { kind: "legacy_entry"; id: string };

type RouteParam = string | readonly string[] | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Route parameters carry only an exact opaque identity. Rejecting malformed,
 * duplicate, or conflicting values prevents a screen from ever substituting a
 * neighbouring Review source.
 */
export function parseReviewFocusRequest(input: {
  focusReviewId?: RouteParam;
  focusEntryId?: RouteParam;
}): ReviewFocusRequest | null {
  const reviewItemId = singleUuid(input.focusReviewId);
  const entryId = singleUuid(input.focusEntryId);
  if ((reviewItemId && entryId) || (!reviewItemId && !entryId)) return null;
  return reviewItemId
    ? { kind: "review", id: reviewItemId }
    : { kind: "legacy_entry", id: entryId! };
}

/**
 * The presentation contract carries actual editor values for a legacy entry.
 * This adapter is deliberately explicit: no unknown project/tag/time values
 * are filled with defaults merely to satisfy MobileTimeEntry.
 */
export function legacyReviewPresentationToMobileEntry(
  record: LegacyReviewEntryPresentation
): MobileTimeEntry | null {
  if (record.status !== "needs_review" || !record.interval.start) return null;
  const startedAt = Date.parse(record.interval.start);
  const stoppedAt = record.interval.end ? Date.parse(record.interval.end) : null;
  if (!Number.isFinite(startedAt) || (stoppedAt !== null && (!Number.isFinite(stoppedAt) || stoppedAt <= startedAt))) {
    return null;
  }
  return {
    id: record.entryId,
    projectId: record.editor.projectId,
    projectName: record.editor.projectName,
    projectColor: record.editor.projectColor,
    clientName: record.editor.clientName,
    categoryId: record.category.id,
    categoryName: record.category.name,
    categoryColor: record.category.color,
    placeName: record.place.label,
    placeKind: record.editor.placeKind,
    source: record.editor.source,
    confidence: record.confidence,
    reviewStatus: "needs_review",
    description: record.editor.description,
    startedAt: record.interval.start,
    stoppedAt: record.interval.end,
    durationSeconds: record.editor.durationSeconds,
    tagNames: record.editor.tagNames
  };
}

function singleUuid(value: RouteParam) {
  if (typeof value !== "string" || !UUID.test(value)) return null;
  return value;
}
