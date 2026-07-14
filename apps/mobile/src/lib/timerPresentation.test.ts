import { describe, expect, it, vi } from "vitest";
import {
  activeTimerElapsedSeconds,
  activeTimerPresentation,
  applySuggestionToRunningTimer,
  buildMobileQuickActions,
  displayTimerDescription,
  runningTimerSheetElapsedSeconds
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

  it("uses the same exact active timestamp for the card and running edit sheet", () => {
    const nowMs = Date.parse("2026-07-14T12:35:15.000Z");
    const cardElapsed = activeTimerElapsedSeconds({
      durationSeconds: 0,
      startedAt: "2026-07-14T12:34:47.000Z"
    }, nowMs);

    expect(cardElapsed).toBe(28);
    expect(runningTimerSheetElapsedSeconds({
      activeElapsedSeconds: cardElapsed,
      nowMs,
      previewStartAt: new Date("2026-07-14T12:34:00.000Z"),
      startTimeEdited: false
    })).toBe(cardElapsed);
  });

  it("only previews a minute-level start time after the user explicitly edits it", () => {
    expect(runningTimerSheetElapsedSeconds({
      activeElapsedSeconds: 28,
      nowMs: Date.parse("2026-07-14T12:35:15.000Z"),
      previewStartAt: new Date("2026-07-14T12:34:00.000Z"),
      startTimeEdited: true
    })).toBe(75);
  });

  it("applies a suggestion with one update to the running entry and no timer start", async () => {
    const updateEntry = vi.fn().mockResolvedValue({ ok: true });
    const startTimer = vi.fn();

    await applySuggestionToRunningTimer({
      entryId: "entry-running",
      suggestion: {
        categoryId: "focus",
        description: "Design review"
      },
      updateEntry
    });

    expect(updateEntry).toHaveBeenCalledOnce();
    expect(updateEntry).toHaveBeenCalledWith("entry-running", {
      categoryId: "focus",
      description: "Design review"
    });
    expect(startTimer).not.toHaveBeenCalled();
  });

  it("only uses pinned categories for quick actions", () => {
    expect(
      buildMobileQuickActions({
        categories: [
          category({ id: "focus", isPinned: true, name: "Focus" }),
          category({ id: "admin", isPinned: false, name: "Admin" }),
          category({ id: "family", isPinned: true, name: "Family" })
        ]
      }).map((action) => ({ description: action.description, id: action.id, name: action.name, subtitle: action.subtitle }))
    ).toEqual([
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
