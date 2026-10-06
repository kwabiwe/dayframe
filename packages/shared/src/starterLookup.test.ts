import { describe, expect, it } from "vitest";
import { applyActivityEvent, normalizeActivityEvent, type NormalizationContext } from "./index";

const sleepId = "70000000-0000-4000-8000-000000000001";
const commuteId = "70000000-0000-4000-8000-000000000002";
const homeId = "71000000-0000-4000-8000-000000000001";
const workId = "71000000-0000-4000-8000-000000000002";

function context(categories: NormalizationContext["categories"]): NormalizationContext {
  return {
    projects: [],
    categories,
    places: [
      { id: homeId, name: "Saved place 1", radiusMeters: 120, priority: 1 },
      { id: workId, name: "Saved place 2", radiusMeters: 120, priority: 1 }
    ],
    automationRules: []
  } as unknown as NormalizationContext;
}

describe("starter activities found by key after a rename", () => {
  it("files Health sleep under the renamed Sleep starter", () => {
    const next = applyActivityEvent(
      { completedEntries: [], reviewItems: [] },
      {
        source: "health_sleep",
        type: "health_sleep_import",
        occurredAt: new Date("2026-07-06T23:55:00.000Z"),
        description: "Sleep",
        rawPayload: { autoConfirm: true, startedAt: "2026-07-06T23:55:00.000Z", stoppedAt: "2026-07-07T06:27:00.000Z", durationSeconds: 23520 }
      },
      context([{ id: sleepId, name: "Bedtime", starterKey: "sleep" }])
    );
    expect(next.completedEntries).toEqual([expect.objectContaining({ categoryId: sleepId })]);
  });

  it("files a clean commute under the renamed Commute starter", () => {
    const event = normalizeActivityEvent(
      {
        source: "location_learning",
        type: "commute_detected",
        occurredAt: new Date("2026-07-13T08:25:00.000Z"),
        rawPayload: {
          fromPlaceId: homeId, fromPlaceName: "Saved place 1", toPlaceId: workId, toPlaceName: "Saved place 2",
          startedAt: "2026-07-13T08:00:00.000Z", stoppedAt: "2026-07-13T08:25:00.000Z", reviewFirst: false
        }
      },
      context([{ id: commuteId, name: "Getting there", starterKey: "commute" }])
    );
    expect(event).toEqual(expect.objectContaining({ categoryId: commuteId }));
  });

  it("prefers the starter over another activity that happens to share the old name", () => {
    const event = normalizeActivityEvent(
      {
        source: "location_learning",
        type: "commute_detected",
        occurredAt: new Date("2026-07-13T08:25:00.000Z"),
        rawPayload: {
          fromPlaceId: homeId, fromPlaceName: "Saved place 1", toPlaceId: workId, toPlaceName: "Saved place 2",
          startedAt: "2026-07-13T08:00:00.000Z", stoppedAt: "2026-07-13T08:25:00.000Z", reviewFirst: false
        }
      },
      context([
        { id: "70000000-0000-4000-8000-000000000009", name: "Commute" },
        { id: commuteId, name: "Getting there", starterKey: "commute" }
      ])
    );
    expect(event).toEqual(expect.objectContaining({ categoryId: commuteId }));
  });
});
