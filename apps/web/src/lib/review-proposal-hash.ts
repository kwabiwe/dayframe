import { createHash } from "node:crypto";

/**
 * Only mutation-relevant, persisted proposal values participate in this
 * fingerprint. Display labels and raw event payloads deliberately do not.
 * The presentation read and locked mutation resolvers use this same helper so
 * a Quick Confirm can never silently apply a different proposal.
 */
export type EffectiveReviewProposal = {
  reviewItemId: string;
  eventId: string | null;
  locationSegmentId: string | null;
  sourceKind: "generic" | "location_v2";
  title: string;
  categoryId: string | null;
  placeId: string | null;
  startedAt: Date | string | null;
  stoppedAt: Date | string | null;
  confidence: string;
  eventSource: string | null;
  eventType: string | null;
  semanticRevision: Date | string | null;
};

export function reviewProposalHash(input: EffectiveReviewProposal) {
  return createHash("sha256")
    .update(canonicalJson({
      version: 1,
      reviewItemId: input.reviewItemId,
      eventId: input.eventId,
      locationSegmentId: input.locationSegmentId,
      sourceKind: input.sourceKind,
      title: input.title,
      categoryId: input.categoryId,
      placeId: input.placeId,
      startedAt: isoOrNull(input.startedAt),
      stoppedAt: isoOrNull(input.stoppedAt),
      confidence: input.confidence,
      eventSource: input.eventSource,
      eventType: input.eventType,
      semanticRevision: isoOrNull(input.semanticRevision)
    }))
    .digest("hex");
}

export function isoOrNull(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)])
  );
}
