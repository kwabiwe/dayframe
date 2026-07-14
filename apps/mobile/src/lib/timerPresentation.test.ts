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

  it("uses recent activity suggestions before pinned category fallbacks", () => {
    expect(
      buildMobileQuickActions({
        categories: [
          category({ id: "focus", isPinned: true, name: "Focus" }),
          category({ id: "admin", isPinned: false, name: "Admin" }),
          category({ id: "family", isPinned: true, name: "Family" })
        ],
        entries: [
          entry({
            categoryColor: "teal",
            categoryId: "admin",
            categoryName: "Admin",
            description: "Inbox triage",
            durationSeconds: 1200,
            startedAt: "2026-07-13T09:00:00.000Z",
            stoppedAt: "2026-07-13T09:20:00.000Z"
          })
        ]
      }).map((action) => ({ description: action.description, id: action.id, name: action.name, subtitle: action.subtitle }))
    ).toEqual([
      { description: "Inbox triage", id: "admin", name: "Inbox triage", subtitle: "Admin" },
      { description: undefined, id: "focus", name: "Focus", subtitle: null },
      { description: undefined, id: "family", name: "Family", subtitle: null }
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

function entry(input: Partial<MobileBootstrap["entries"][number]>): MobileBootstrap["entries"][number] {
  return {
    categoryColor: null,
    categoryId: null,
    categoryName: null,
    clientName: null,
    confidence: "manual",
    description: null,
    durationSeconds: 0,
    id: "entry-id",
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "manual",
    startedAt: "2026-07-13T09:00:00.000Z",
    stoppedAt: "2026-07-13T09:01:00.000Z",
    ...input
  };
}
