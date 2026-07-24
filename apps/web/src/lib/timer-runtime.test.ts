import { describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import {
  applyOptimisticActiveEntryPatch,
  applyOptimisticTimerDelete,
  applyOptimisticTimerStart,
  applyOptimisticTimerStop,
  createTimerMutationGate,
  entryContinuationDecision,
  timerStartErrorMessage
} from "./timer-runtime";

describe("shell timer runtime", () => {
  it("admits exactly one mutation while an action is in flight", async () => {
    const gate = createTimerMutationGate();
    let release: (() => void) | undefined;
    const mutation = vi.fn(() => new Promise<string>((resolve) => {
      release = () => resolve("done");
    }));

    const first = gate.run(mutation);
    const second = await gate.run(mutation);
    expect(second).toEqual({ ran: false });
    expect(mutation).toHaveBeenCalledTimes(1);

    release?.();
    await expect(first).resolves.toEqual({ ran: true, value: "done" });
    expect(gate.isActive()).toBe(false);
  });

  it("projects one optimistic start and one optimistic stop through every entry collection", () => {
    const data = bootstrapData(null);
    const started = applyOptimisticTimerStart(
      data,
      { categoryId: "focus", description: "Write release notes", tagNames: ["ship"] },
      "2026-07-22T09:00:00.000Z",
      "optimistic-1"
    );

    expect(started.activeEntry?.id).toBe("optimistic-1");
    expect(started.entries.filter((entry) => entry.id === "optimistic-1")).toHaveLength(1);
    expect(started.dayEntries.filter((entry) => entry.id === "optimistic-1")).toHaveLength(1);

    const stopped = applyOptimisticTimerStop(started, "2026-07-22T10:00:00.000Z");
    expect(stopped.activeEntry).toBeNull();
    expect(stopped.entries.filter((entry) => entry.id === "optimistic-1")).toHaveLength(1);
    expect(stopped.entries[0].stoppedAt).toBe("2026-07-22T10:00:00.000Z");
  });

  it("patches active details without adding a duplicate entry", () => {
    const active = entry({ id: "active-1", description: "Draft" });
    const data = bootstrapData(active);
    const patched = applyOptimisticActiveEntryPatch(data, {
      categoryId: "focus",
      description: "Final draft",
      tagNames: ["writing"]
    });

    expect(patched.activeEntry?.description).toBe("Final draft");
    expect(patched.entries.filter((item) => item.id === active.id)).toHaveLength(1);
    expect(patched.entries[0].tagNames).toEqual(["writing"]);
  });

  it("builds a category, description, and tags-only continuation draft", () => {
    const source = entry({
      categoryId: "focus",
      description: "  Write release notes  ",
      placeId: "place-1",
      projectId: "legacy-project",
      clientName: "Legacy client",
      tagNames: ["ship", "writing"]
    });
    const decision = entryContinuationDecision(source);

    expect(decision).toEqual({
      ok: true,
      draft: {
        categoryId: "focus",
        description: "Write release notes",
        tagNames: ["ship", "writing"]
      }
    });
    expect(decision.ok && Object.keys(decision.draft)).not.toContain("placeId");
    expect(decision.ok && Object.keys(decision.draft)).not.toContain("projectId");
    expect(decision.ok && Object.keys(decision.draft)).not.toContain("clientName");
  });

  it("allows an active timer replacement but refuses a meaningless blank entry", () => {
    expect(entryContinuationDecision(entry())).toEqual({
      ok: true,
      draft: {
        categoryId: "focus",
        description: "Work",
        tagNames: []
      }
    });
    expect(entryContinuationDecision(entry({
      categoryId: null,
      categoryName: null,
      description: null,
      tagNames: ["tag-only"]
    }))).toEqual({
      ok: false,
      error: "This entry does not have a task or category to start."
    });
  });

  it("optimistically closes the running timer when a continuation replaces it", () => {
    const active = entry({
      id: "active",
      description: "Existing task",
      startedAt: "2026-07-24T12:00:00.000Z",
      stoppedAt: null
    });
    const switchedAt = "2026-07-24T12:30:00.000Z";
    const next = applyOptimisticTimerStart(
      bootstrapData(active),
      {
        categoryId: "focus",
        description: "Replacement task",
        tagNames: ["writing"]
      },
      switchedAt,
      "optimistic-replacement"
    );

    expect(next.activeEntry).toEqual(expect.objectContaining({
      id: "optimistic-replacement",
      description: "Replacement task",
      startedAt: switchedAt,
      stoppedAt: null
    }));
    expect(next.entries).toContainEqual(expect.objectContaining({
      id: "active",
      stoppedAt: switchedAt,
      durationSeconds: 1800
    }));
  });

  it("optimistically removes a deleted active timer from every collection", () => {
    const active = entry({ id: "active", stoppedAt: null });
    const next = applyOptimisticTimerDelete(bootstrapData(active));

    expect(next.activeEntry).toBeNull();
    expect(next.entries).not.toContainEqual(expect.objectContaining({ id: "active" }));
    expect(next.historyEntries).not.toContainEqual(expect.objectContaining({ id: "active" }));
    expect(next.dayEntries).not.toContainEqual(expect.objectContaining({ id: "active" }));
    expect(next.weekEntries).not.toContainEqual(expect.objectContaining({ id: "active" }));
  });

  it("turns an offline fetch failure into calm restart feedback", () => {
    expect(timerStartErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "Unable to start right now. Check your connection and try again."
    );
    expect(timerStartErrorMessage(new Error("Timer conflict"))).toBe("Timer conflict");
  });
});

function bootstrapData(activeEntry: TimeEntryRow | null) {
  const entries = activeEntry ? [activeEntry] : [];
  return {
    activeEntry,
    categories: [{ id: "focus", name: "Focus", color: "coral", isPinned: true }],
    tags: [{ id: "tag-1", name: "Ship", normalizedName: "ship" }],
    entries,
    historyEntries: entries,
    dayEntries: entries,
    weekEntries: entries,
    dateRange: {
      selectedDate: "2026-07-22",
      dayStart: "2026-07-22T00:00:00.000Z",
      dayEnd: "2026-07-23T00:00:00.000Z",
      weekStart: "2026-07-20T00:00:00.000Z",
      weekEnd: "2026-07-27T00:00:00.000Z"
    }
  } as unknown as BootstrapData;
}

function entry(overrides: Partial<TimeEntryRow> = {}) {
  return {
    id: "entry-1",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "focus",
    categoryName: "Focus",
    categoryColor: "coral",
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Work",
    startedAt: "2026-07-22T09:00:00.000Z",
    stoppedAt: null,
    durationSeconds: 60,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
