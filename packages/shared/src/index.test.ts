import { describe, expect, it } from "vitest";
import { applyActivityEvent, type NormalizationContext, type TimelineState } from "./index";

const context: NormalizationContext = {
  projects: [],
  categories: [{ id: categoryId("focus"), name: "Focus" }],
  places: [],
  automationRules: []
};

describe("category-first timer events", () => {
  it("closes the current active timer before starting a new explicit category timer", () => {
    const startedAt = new Date("2026-07-04T08:00:00.000Z");
    const switchAt = new Date("2026-07-04T09:15:00.000Z");
    const initial: TimelineState = {
      activeEntry: {
        id: "entry-active",
        categoryId: categoryId("admin"),
        source: "manual_app",
        confidence: "high",
        startedAt,
        description: "Admin"
      },
      completedEntries: [],
      reviewItems: []
    };

    const next = applyActivityEvent(
      initial,
      {
        source: "mobile_app",
        type: "timer_start",
        occurredAt: switchAt,
        categoryId: categoryId("focus"),
        description: "Write notes"
      },
      context
    );

    expect(next.completedEntries).toEqual([
      expect.objectContaining({
        id: "entry-active",
        stoppedAt: switchAt
      })
    ]);
    expect(next.activeEntry).toEqual(
      expect.objectContaining({
        categoryId: categoryId("focus"),
        description: "Write notes",
        startedAt: switchAt
      })
    );
  });
});

function categoryId(seed: string) {
  const suffix = seed === "focus" ? "0001" : "0002";
  return `20000000-0000-4000-8000-00000000${suffix}`;
}
