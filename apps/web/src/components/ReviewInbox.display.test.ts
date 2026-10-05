import { describe, expect, it } from "vitest";
import { reviewItemDisplay } from "./ReviewInbox";

const base = {
  id: "30000000-0000-4000-8000-000000000001", type: "location", title: "Time away from Home", eventType: "commute_detected",
  eventSource: "location_learning", categoryName: null, placeName: null,
  suggestedStartedAt: "2026-03-10T12:00:00.000Z", suggestedStoppedAt: "2026-03-10T12:10:00.000Z"
};

describe("Review inbox display", () => {
  it("shows time away as itself, never as a commute suggestion (review finding 4)", () => {
    const display = reviewItemDisplay({ ...base, rawPayload: { qualificationReason: "same_place_outing", stopCount: 1 } } as never);
    expect(display.kind).toBe("Time away");
    expect(display.title).toBe("Time away from Home");
    expect(display.meta).toContain("Needs category");
  });

  it("keeps ordinary commutes as commute suggestions", () => {
    const display = reviewItemDisplay({ ...base, title: "Commute", rawPayload: { qualificationReason: "significant_endpoint_displacement" } } as never);
    expect(display).toMatchObject({ kind: "Commute suggestion", title: "Commute suggestion" });
  });
});
