import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "../../apps/mobile/src/lib/api";
import { LocationReviewEvidenceDtoSchema, type LocationReviewEvidenceDto } from "@dayframe/shared";

// Synthetic only. This module has no database/network client and no production
// source. IDs, coordinates, dates and labels are constructed locally.
export const REVIEW_PERFORMANCE_PROFILES = [2, 13, 25, 50] as const;
export const syntheticId = (n: number) => `18600000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
export const SYNTHETIC_REVIEW_NOW = Date.parse("2026-08-28T18:00:00Z");
export function syntheticReviewBootstrap(count: number): MobileBootstrap {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("Synthetic fixture supports 1–50 items only.");
  const kinds = ["health_sleep_import", "commute_detected", "learned_place_visit", "unknown_stay", "health_workout_import"];
  const reviewItems: MobileReviewItem[] = Array.from({ length: count }, (_, index) => {
    const eventType = kinds[index % kinds.length];
    const isLocation = !eventType.startsWith("health_");
    const trusted = eventType === "learned_place_visit";
    // Include wholly non-overlapping windows as well as dense historical peers.
    const start = SYNTHETIC_REVIEW_NOW - (index + 1) * 3_600_000 - (index % 7 === 6 ? 400 * 86_400_000 : 0);
    return {
      id: syntheticId(index + 100), type: isLocation ? "location" : "health",
      title: `Synthetic ${eventType} ${index + 1}`, eventType,
      eventSource: isLocation ? "location_learning" : eventType === "health_sleep_import" ? "health_sleep" : "health_workout",
      categoryName: "Synthetic activity", categoryColor: "moss", placeName: trusted ? "Synthetic place" : null,
      suggestedCategoryId: syntheticId(3), suggestedPlaceId: trusted ? syntheticId(4) : null,
      suggestedStartedAt: new Date(start).toISOString(), suggestedStoppedAt: new Date(start + 1_800_000).toISOString(),
      confidence: "medium_high", status: "open", notes: null, createdAt: new Date(start).toISOString(),
      rawPayload: isLocation ? { algorithmVersion: "location-v2.0", clientSegmentId: `synthetic-segment-${index}`, semanticReason: "existing_review_preserved" } : { durationSeconds: 1800 }
    };
  });
  const historyEntries = Array.from({ length: 250 }, (_, index) => ({
    id: syntheticId(index + 1_000), description: `Synthetic entry ${index + 1}`,
    startedAt: new Date(SYNTHETIC_REVIEW_NOW - index * 900_000 - 3_600_000).toISOString(),
    stoppedAt: index === 0 ? null : new Date(SYNTHETIC_REVIEW_NOW - index * 900_000 - 2_700_000).toISOString(),
    projectId: null, projectName: null, projectColor: null, clientName: null, placeName: null, confidence: "high", durationSeconds: 900,
    source: "manual_app", reviewStatus: "confirmed", categoryId: syntheticId(3),
    categoryName: "Synthetic activity", tags: []
  })) satisfies MobileTimeEntry[];
  return {
    user: { id: syntheticId(1), name: "Synthetic local fixture", email: "fixture@example.test" },
    workspace: { id: syntheticId(2), name: "Synthetic Review performance" },
    categories: [{ id: syntheticId(3), name: "Synthetic activity", color: "moss", isPinned: false }],
    activeEntry: null, projects: [], places: [], entries: historyEntries.slice(0, 20), historyEntries,
    weekEntries: historyEntries.slice(0, 100), dayEntries: historyEntries.slice(0, 10),
    reviewItems, stats: { todaySeconds: 0, weekSeconds: 0, reviewCount: count }
  };
}

/** Transient cache DTOs; all coordinates are constructed near (0, 0). */
export function syntheticReviewEvidence(data: MobileBootstrap): LocationReviewEvidenceDto[] {
  return data.reviewItems.filter(item => item.type === "location").map((item, index) => {
    const count = index % 2 === 0 ? 8 : 400;
    const startedAt = item.suggestedStartedAt!, stoppedAt = item.suggestedStoppedAt!;
    const start = Date.parse(startedAt), duration = Date.parse(stoppedAt) - start;
    const acceptedSamples = Array.from({ length: count }, (_, sample) => ({
      id: `synthetic-evidence-${index}-${sample}`,
      point: { type: "Point" as const, coordinates: [sample / 100_000, index / 100_000] as [number, number] },
      occurredAt: new Date(start + duration * sample / (count - 1)).toISOString(),
      accuracyMeters: 10, kind: "significant_change", role: "accepted"
    }));
    return LocationReviewEvidenceDtoSchema.parse({
      reviewItemId: item.id, eventId: syntheticId(index + 2_000),
      segment: { id: `synthetic-segment-${index}`, kind: item.eventType === "commute_detected" ? "commute" : "stay",
        status: "finalised", startedAt, stoppedAt, confidence: item.confidence,
        continuityStatus: "continuous", algorithmVersion: "location-v2.0", evidenceCount: count, rejectedEvidenceCount: 0 },
      display: { title: item.title, subtitle: "Synthetic cache fixture", placeId: item.suggestedPlaceId,
        placeName: item.placeName, addressSummary: null },
      map: { centre: acceptedSamples[0].point, stayRadiusMeters: 80,
        route: item.eventType === "commute_detected" ? { type: "LineString", coordinates: acceptedSamples.map(sample => sample.point.coordinates) } : null,
        straightLineFallback: null, acceptedSamples, rejectedSamples: [], anchors: [], gaps: [], nearbySavedPlaces: [] },
      suggestedSplitPoints: [], evidenceExpiresAt: null, evidenceExpired: false, rawEvidenceAvailable: true,
      textualSummary: "Synthetic evidence; no captured location or Health data."
    });
  });
}
