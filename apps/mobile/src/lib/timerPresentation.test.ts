import { describe, expect, it } from "vitest";
import {
  activeTimerPresentation,
  buildMobileQuickActions,
  displayTimerDescription
} from "./timerPresentation";
import type { MobileBootstrap } from "./api";

describe("mobile timer presentation", () => {
  it("uses a task-description prompt instead of Running for blank active timers", () => {
    expect(
      activeTimerPresentation({
        categoryColor: null,
        id: "entry-1",
        categoryId: null,
        categoryName: null,
        clientName: null,
        confidence: "manual",
        description: null,
        durationSeconds: 0,
        placeName: null,
        projectColor: null,
        projectId: null,
        projectName: null,
        reviewStatus: "confirmed",
        source: "manual",
        startedAt: "2026-07-12T12:00:00.000Z",
        stoppedAt: null
      })
    ).toEqual({
      categoryLabel: "Uncategorized",
      title: "Add a task description"
    });
  });

  it("hides the old mobile start-activity placeholder", () => {
    expect(displayTimerDescription({ description: "Start activity" })).toBeNull();
  });

  it("keeps uncategorized available before pinned quick actions", () => {
    expect(
      buildMobileQuickActions({
        categories: [
          category({ id: "focus", isPinned: true, name: "Focus" }),
          category({ id: "admin", isPinned: false, name: "Admin" }),
          category({ id: "family", isPinned: true, name: "Family" })
        ]
      }).map((action) => ({ id: action.id, name: action.name }))
    ).toEqual([
      { id: null, name: "Uncategorized" },
      { id: "focus", name: "Focus" },
      { id: "family", name: "Family" }
    ]);
  });
});

function category(input: Partial<MobileBootstrap["categories"][number]>): MobileBootstrap["categories"][number] {
  return {
    color: "blue",
    id: "category-id",
    isPinned: false,
    name: "Category",
    ...input
  };
}
