import type { MobileBootstrap, MobileReviewItem, MobileTimeEntry } from "../../apps/mobile/src/lib/api";

// Synthetic only. This module has no database/network client and no production
// source. IDs, coordinates, dates and labels are constructed locally.
export const REVIEW_PERFORMANCE_PROFILES = [2, 13, 25, 50] as const;
export const syntheticId = (n: number) => `18600000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
export const SYNTHETIC_REVIEW_NOW = Date.parse("2026-08-28T18:00:00Z");
export function syntheticReviewBootstrap(count: number): MobileBootstrap {
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new Error("Synthetic fixture supports 1–50 items only.");
  const kinds = ["health_sleep_import", "health_workout_import", "learned_place_visit", "commute_detected"];
  const reviewItems: MobileReviewItem[] = Array.from({ length: count }, (_, index) => {
    const eventType = kinds[index % kinds.length];
    const start = SYNTHETIC_REVIEW_NOW - (index + 1) * 3_600_000;
    return {
      id: syntheticId(index + 100), type: index % 4 < 2 ? "health" : "location",
      title: `Synthetic ${eventType} ${index + 1}`, eventType,
      eventSource: index % 4 === 0 ? "health_sleep" : index % 4 === 1 ? "health_workout" : "location_learning",
      categoryName: "Synthetic activity", categoryColor: "moss", placeName: index % 4 >= 2 ? "Synthetic place" : null,
      suggestedCategoryId: syntheticId(3), suggestedPlaceId: index % 4 >= 2 ? syntheticId(4) : null,
      suggestedStartedAt: new Date(start).toISOString(), suggestedStoppedAt: new Date(start + 1_800_000).toISOString(),
      confidence: "medium_high", status: "open", notes: null, createdAt: new Date(start).toISOString(),
      rawPayload: index % 4 >= 2 ? { algorithmVersion: "location-v2.0", clientSegmentId: `synthetic-segment-${index}`, semanticReason: "existing_review_preserved" } : { durationSeconds: 1800 }
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
