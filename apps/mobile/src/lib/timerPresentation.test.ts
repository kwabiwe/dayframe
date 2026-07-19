import { describe, expect, it, vi } from "vitest";
import {
  activeTimerElapsedSeconds,
  activeTimerPresentation,
  applySuggestionToRunningTimer,
  buildMobileQuickActions,
  displayTimerDescription,
  optimisticDeleteTimeEntry,
  optimisticPatchTimeEntry,
  optimisticRestoreTimeEntries,
  optimisticStartTimer,
  optimisticStopActiveTimer,
  replaceOptimisticTimeEntryId,
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

  it("updates, stops and deletes a timer optimistically without waiting for a reload", () => {
    const original = bootstrapWithActiveEntry();
    const patched = optimisticPatchTimeEntry(original, "entry-running", {
      categoryId: "focus",
      description: "Architecture review"
    });
    expect(patched?.activeEntry).toMatchObject({
      categoryId: "focus",
      categoryName: "Focus",
      description: "Architecture review"
    });

    const stopped = optimisticStopActiveTimer(patched, "2026-07-16T09:30:00.000Z");
    expect(stopped?.activeEntry).toBeNull();
    expect(stopped?.entries.find((entry) => entry.id === "entry-running")).toMatchObject({
      durationSeconds: 1800,
      stoppedAt: "2026-07-16T09:30:00.000Z"
    });

    const deleted = optimisticDeleteTimeEntry(stopped, "entry-running");
    expect(deleted?.entries.some((entry) => entry.id === "entry-running")).toBe(false);
    expect(deleted?.historyEntries?.some((entry) => entry.id === "entry-running")).toBe(false);
  });

  it("updates normalized tag metadata across every entry pool and leaves the exact snapshot available for rollback", () => {
    const snapshot = bootstrapWithActiveEntry();
    const patched = optimisticPatchTimeEntry(snapshot, "entry-running", {
      description: "Architecture review #planning",
      tagNames: ["Planning"]
    });

    expect(patched?.activeEntry?.tags).toEqual([
      { id: "optimistic-tag:planning", name: "Planning", normalizedName: "planning" }
    ]);
    expect(patched?.historyEntries?.[0].tagNames).toEqual(["Planning"]);
    expect(patched?.tags).toEqual([
      { id: "optimistic-tag:planning", name: "Planning", normalizedName: "planning", usageCount: 0 }
    ]);
    expect(snapshot.activeEntry?.tagNames).toBeUndefined();
    expect(snapshot.historyEntries?.[0].tags).toBeUndefined();
  });

  it("restores an optimistically deleted entry without replacing newer dashboard state", () => {
    const snapshot = bootstrapWithActiveEntry();
    const deleted = optimisticDeleteTimeEntry(snapshot, "entry-running");
    const withNewerState = deleted
      ? { ...deleted, workspace: { ...deleted.workspace, name: "Newer workspace state" } }
      : deleted;
    const restored = optimisticRestoreTimeEntries(withNewerState, snapshot, ["entry-running"]);

    expect(restored?.entries.some((entry) => entry.id === "entry-running")).toBe(true);
    expect(restored?.historyEntries?.some((entry) => entry.id === "entry-running")).toBe(true);
    expect(restored?.workspace.name).toBe("Newer workspace state");
  });

  it("rolls back the exact grouped entries after persistence failure", () => {
    const first = bootstrapWithActiveEntry();
    const secondEntry = {
      ...first.entries[0],
      id: "entry-grouped-2",
      startedAt: "2026-07-16T08:00:00.000Z",
      stoppedAt: "2026-07-16T08:30:00.000Z"
    };
    const snapshot = {
      ...first,
      entries: [first.entries[0], secondEntry],
      historyEntries: [first.entries[0], secondEntry]
    };
    const deleted = ["entry-running", "entry-grouped-2"].reduce(
      optimisticDeleteTimeEntry,
      snapshot
    );
    const restored = optimisticRestoreTimeEntries(
      deleted ? { ...deleted, workspace: { ...deleted.workspace, name: "Newer workspace state" } } : deleted,
      snapshot,
      ["entry-running", "entry-grouped-2"]
    );

    expect(restored?.entries).toEqual(snapshot.entries);
    expect(restored?.historyEntries).toEqual(snapshot.historyEntries);
    expect(restored?.workspace.name).toBe("Newer workspace state");
  });

  it("starts one optimistic timer and replaces its local id after persistence", () => {
    const original = bootstrapWithActiveEntry();
    const pending = {
      ...original.activeEntry!,
      id: "optimistic-active-timer:1",
      categoryId: null,
      categoryName: null,
      description: null,
      startedAt: "2026-07-16T10:00:00.000Z"
    };
    const started = optimisticStartTimer(original, pending);

    expect(started?.activeEntry?.id).toBe("optimistic-active-timer:1");
    expect(started?.entries.filter((entry) => entry.id === pending.id)).toHaveLength(1);
    expect(started?.entries.find((entry) => entry.id === "entry-running")?.stoppedAt)
      .toBe("2026-07-16T10:00:00.000Z");

    const persisted = replaceOptimisticTimeEntryId(started, pending.id, "entry-server");
    expect(persisted?.activeEntry?.id).toBe("entry-server");
    expect(persisted?.entries.filter((entry) => entry.id === "entry-server")).toHaveLength(1);
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

  it("sorts pinned category quick actions by learned category usage", () => {
    expect(
      buildMobileQuickActions({
        categories: [
          category({ id: "family", isPinned: true, name: "Family" }),
          category({ id: "coding", isPinned: true, name: "Coding" }),
          category({ id: "chores", isPinned: true, name: "Chores" })
        ],
        categoryUsage: [
          {
            categoryId: "coding",
            lastSeenAt: "2026-07-10T10:00:00.000Z",
            score: 82,
            totalSeconds: 10_800,
            useCount: 6
          },
          {
            categoryId: "chores",
            lastSeenAt: "2026-07-14T10:00:00.000Z",
            score: 54,
            totalSeconds: 3600,
            useCount: 2
          }
        ]
      }).map((action) => action.name)
    ).toEqual(["Coding", "Chores", "Family"]);
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

function bootstrapWithActiveEntry(): MobileBootstrap {
  const activeEntry: NonNullable<MobileBootstrap["activeEntry"]> = {
    categoryColor: null,
    categoryId: null,
    categoryName: null,
    clientName: null,
    confidence: "manual",
    description: null,
    durationSeconds: 0,
    id: "entry-running",
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "mobile_app",
    startedAt: "2026-07-16T09:00:00.000Z",
    stoppedAt: null
  };
  return {
    activeEntry,
    categories: [category({ id: "focus", name: "Focus" })],
    entries: [activeEntry],
    historyEntries: [activeEntry]
  } as MobileBootstrap;
}
