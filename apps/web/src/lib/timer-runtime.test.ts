import { describe, expect, it, vi } from "vitest";
import type { BootstrapData, TimeEntryRow } from "@/lib/queries";
import {
  applyOptimisticActiveEntryPatch,
  applyOptimisticActiveEntryCompactPatch,
  applyOptimisticTimerDelete,
  applyOptimisticTimerStart,
  applyOptimisticTimerStop,
  createTimerMutationGate,
  entryContinuationDecision,
  quickActionTimerDraft,
  runActiveEntryCompactMutation,
  runTimerStartMutation,
  shouldHydrateTimerDraft,
  timerDraftForEntry,
  timerDraftsEqual,
  timerDraftVersion,
  timerStartErrorMessage,
  type TimerDraft,
  type TimerStartRequestPayload
} from "./timer-runtime";
import type { CalendarEntryCompactSavePlan } from "./calendar-entry-compact-editor";

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

  it("projects a compact active edit while preserving hidden metadata", () => {
    const active = entry({
      placeId: "place-office",
      placeName: "Office",
      projectId: "legacy-project",
      clientName: "Legacy client",
      tagNames: ["ship"],
      tags: [{ id: "tag-1", name: "Ship", normalizedName: "ship" }]
    });
    const patched = applyOptimisticActiveEntryCompactPatch(bootstrapData(active), compactPlan());

    expect(patched.activeEntry).toEqual(expect.objectContaining({
      categoryId: "work",
      description: "Calendar draft",
      startedAt: "2026-07-22T08:45:00.000Z",
      placeId: "place-office",
      projectId: "legacy-project",
      clientName: "Legacy client",
      tagNames: ["ship"]
    }));
    expect(patched.entries.filter((item) => item.id === active.id)).toHaveLength(1);
  });

  it("gates a compact active edit, sends one partial PATCH payload, and reconciles one refresh", async () => {
    const active = entry({
      id: "active-calendar",
      placeId: "place-office",
      projectId: "legacy-project",
      clientName: "Legacy client",
      tagNames: ["ship"]
    });
    const snapshot = bootstrapData(active);
    const draftSnapshot = timerDraftForEntry(active);
    const gate = createTimerMutationGate();
    let data = snapshot;
    let draft = draftSnapshot;
    const requests: Array<{ entryId: string; payload: Record<string, unknown> }> = [];
    const refresh = vi.fn(async () => undefined);
    let release: (() => void) | undefined;
    const requestPending = new Promise<void>((resolve) => { release = resolve; });
    const run = () => runActiveEntryCompactMutation({
      commit: (nextData) => { data = nextData; },
      draftSnapshot,
      gate,
      getCurrentData: () => data,
      input: { plan: compactPlan() },
      refresh,
      send: async (entryId, payload) => {
        requests.push({ entryId, payload: { ...payload } });
        await requestPending;
        return { updatedAt: "2026-07-22T10:05:00.000Z" };
      },
      setBusy: () => undefined,
      setDraft: (nextDraft) => { draft = nextDraft; },
      setError: () => undefined,
      snapshot
    });

    const first = run();
    await expect(run()).resolves.toEqual({ ok: false, error: "A timer update is already in progress." });
    expect(requests).toEqual([{
      entryId: "active-calendar",
      payload: {
        categoryId: "work",
        description: "Calendar draft",
        startedAt: "2026-07-22T08:45:00.000Z"
      }
    }]);
    expect(data.activeEntry).toEqual(expect.objectContaining({
      placeId: "place-office",
      projectId: "legacy-project",
      clientName: "Legacy client",
      tagNames: ["ship"]
    }));
    expect(draft).toEqual({ categoryId: "work", description: "Calendar draft", tagNames: ["ship"] });

    release?.();
    await expect(first).resolves.toEqual({ ok: true });
    expect(data.activeEntry?.updatedAt).toBe("2026-07-22T10:05:00.000Z");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
  });

  it("projects active tag edits into every timer surface and sends them in the same PATCH", async () => {
    const active = entry({ id: "active-tags", placeId: "place-office", tagNames: ["ship"] });
    const snapshot = bootstrapData(active);
    const draftSnapshot = timerDraftForEntry(active);
    const plan = {
      ...compactPlan(),
      payload: { ...compactPlan().payload, tagNames: ["writing"] },
      resolved: { ...compactPlan().resolved, tagNames: ["writing"] }
    };
    let data = snapshot;
    let draft = draftSnapshot;
    const send = vi.fn(async () => ({ updatedAt: "2026-07-22T10:06:00.000Z" }));

    await expect(runActiveEntryCompactMutation({
      commit: (nextData) => { data = nextData; },
      draftSnapshot,
      gate: createTimerMutationGate(),
      getCurrentData: () => data,
      input: { plan },
      refresh: async () => undefined,
      send,
      setBusy: () => undefined,
      setDraft: (nextDraft) => { draft = nextDraft; },
      setError: () => undefined,
      snapshot
    })).resolves.toEqual({ ok: true });

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("active-tags", expect.objectContaining({ tagNames: ["writing"] }));
    expect(data.activeEntry?.tagNames).toEqual(["writing"]);
    expect(data.entries.find((candidate) => candidate.id === active.id)?.tagNames).toEqual(["writing"]);
    expect(draft.tagNames).toEqual(["writing"]);
    expect(data.activeEntry?.placeId).toBe("place-office");
  });

  it("restores the exact active snapshot and timer draft after a compact edit failure", async () => {
    const active = entry({ id: "active-calendar", placeId: "place-office", tagNames: ["ship"] });
    const snapshot = bootstrapData(active);
    const draftSnapshot = timerDraftForEntry(active);
    let data = snapshot;
    let draft = draftSnapshot;
    let busy = false;
    let error: string | null = null;

    await expect(runActiveEntryCompactMutation({
      commit: (nextData) => { data = nextData; },
      draftSnapshot,
      gate: createTimerMutationGate(),
      getCurrentData: () => data,
      input: { plan: compactPlan() },
      refresh: async () => undefined,
      send: async () => { throw new Error("Server kept the previous timer"); },
      setBusy: (nextBusy) => { busy = nextBusy; },
      setDraft: (nextDraft) => { draft = nextDraft; },
      setError: (nextError) => { error = nextError; },
      snapshot
    })).resolves.toEqual({ ok: false, error: "Server kept the previous timer" });

    expect(data).toBe(snapshot);
    expect(draft).toBe(draftSnapshot);
    expect(error).toBe("Server kept the previous timer");
    expect(busy).toBe(false);
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

  it("starts a Quick Action as a clean category-only task", () => {
    expect(quickActionTimerDraft("chores")).toEqual({
      categoryId: "chores",
      description: "",
      tagNames: []
    });
    expect(quickActionTimerDraft(null)).toEqual({
      categoryId: "",
      description: "",
      tagNames: []
    });
  });

  it("replaces an active timer through the Quick Action mutation without rewriting its metadata", async () => {
    const previous = entry({
      id: "active-work",
      categoryId: "work",
      categoryName: "Work",
      description: "BAU",
      tagNames: ["Cubic"],
      tags: [{ id: "tag-cubic", name: "Cubic", normalizedName: "cubic" }],
      placeId: "place-office",
      placeName: "Office",
      projectId: "legacy-project",
      projectName: "Legacy project",
      projectColor: "purple",
      clientName: "Legacy client"
    });
    const harness = timerStartHarness(bootstrapData(previous));

    await expect(harness.run(quickActionTimerDraft("chores"))).resolves.toEqual({ ok: true });

    const state = harness.state();
    const stoppedPrevious = state.data.entries.find((item) => item.id === previous.id);
    expect(stoppedPrevious).toEqual(expect.objectContaining({
      categoryId: "work",
      description: "BAU",
      tagNames: ["Cubic"],
      placeId: "place-office",
      projectId: "legacy-project",
      clientName: "Legacy client"
    }));
    expect(stoppedPrevious?.stoppedAt).not.toBeNull();
    expect(state.data.activeEntry).toEqual(expect.objectContaining({
      categoryId: "chores",
      description: null,
      tagNames: [],
      placeId: null,
      projectId: null,
      clientName: null
    }));
    expect(state.data.entries.filter((item) => item.stoppedAt === null)).toHaveLength(1);
    expect(state.requests.map(serializedRequest)).toEqual([{
      mode: "start",
      categoryId: "chores",
      tagNames: []
    }]);
  });

  it("abandons a dirty idle draft when a Quick Action starts", async () => {
    const harness = timerStartHarness(
      bootstrapData(null),
      { categoryId: "work", description: "Unstarted BAU", tagNames: ["Cubic"] }
    );

    await harness.run(quickActionTimerDraft("chores"));

    expect(harness.state().draft).toEqual({
      categoryId: "chores",
      description: "",
      tagNames: []
    });
    expect(harness.state().data.activeEntry).toEqual(expect.objectContaining({
      categoryId: "chores",
      description: null,
      tagNames: []
    }));
    expect(harness.state().requests.map(serializedRequest)).toEqual([{
      mode: "start",
      categoryId: "chores",
      tagNames: []
    }]);
  });

  it("admits only the first of rapid same and different Quick Actions", async () => {
    let releaseRequest: (() => void) | undefined;
    const requestPending = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    const previous = entry({
      id: "active-work",
      categoryId: "work",
      categoryName: "Work",
      description: "BAU",
      tagNames: ["Cubic"],
      startedAt: "2026-07-22T08:00:00.000Z"
    });
    const harness = timerStartHarness(bootstrapData(previous), undefined, () => requestPending);

    const first = harness.run(quickActionTimerDraft("chores"));
    const repeated = harness.run(quickActionTimerDraft("chores"));
    const different = harness.run(quickActionTimerDraft("focus"));

    await expect(repeated).resolves.toEqual({ ok: false, error: "A timer update is already in progress." });
    await expect(different).resolves.toEqual({ ok: false, error: "A timer update is already in progress." });
    expect(harness.state().requests).toHaveLength(1);
    expect(harness.state().drafts).toEqual([{
      categoryId: "chores",
      description: "",
      tagNames: []
    }]);

    releaseRequest?.();
    await expect(first).resolves.toEqual({ ok: true });
    const state = harness.state();
    expect(state.data.entries.filter((item) => item.stoppedAt === null)).toHaveLength(1);
    expect(state.data.entries.filter((item) => item.durationSeconds === 0 && item.stoppedAt !== null)).toHaveLength(0);
    expect(state.requests).toHaveLength(1);
  });

  it("rolls a failed Quick Action back to the complete previous timer and draft", async () => {
    const previous = entry({
      id: "active-work",
      categoryId: "work",
      categoryName: "Work",
      description: "BAU",
      tagNames: ["Cubic"],
      tags: [{ id: "tag-cubic", name: "Cubic", normalizedName: "cubic" }],
      placeId: "place-office",
      placeName: "Office",
      projectId: "legacy-project",
      projectName: "Legacy project",
      clientName: "Legacy client"
    });
    const harness = timerStartHarness(
      bootstrapData(previous),
      undefined,
      async () => { throw new Error("Unable to start Chores"); }
    );

    await expect(harness.run(quickActionTimerDraft("chores"))).resolves.toEqual({
      ok: false,
      error: "Unable to start Chores"
    });

    const state = harness.state();
    expect(state.data.activeEntry).toEqual(previous);
    expect(state.data.entries).toEqual([previous]);
    expect(state.draft).toEqual(timerDraftForEntry(previous));
    expect(state.error).toBe("Unable to start Chores");
    expect(state.busy).toBe(false);
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

  it("changes the timer draft hydration key for a newer same-entry version", () => {
    expect(timerDraftVersion(entry({ id: "active", updatedAt: "2026-07-31T10:00:00.000Z" })))
      .not.toBe(timerDraftVersion(entry({ id: "active", updatedAt: "2026-07-31T10:01:00.000Z" })));
    expect(timerDraftVersion(null)).toBe("idle");
  });

  it("distinguishes a newer local timer description from the last canonical draft", () => {
    expect(timerDraftsEqual(
      { categoryId: "category", description: "TY1", tagNames: ["vpn"] },
      { categoryId: "category", description: "TY1", tagNames: ["vpn"] }
    )).toBe(true);
    expect(timerDraftsEqual(
      { categoryId: "category", description: "TY1 VPN", tagNames: [] },
      { categoryId: "category", description: "TY1", tagNames: [] }
    )).toBe(false);
  });

  it("does not hydrate a same-entry server revision over newer local typing", () => {
    const previousServerDraft = { categoryId: "", description: "TY1", tagNames: [] };
    const localDraft = { ...previousServerDraft, description: "TY1 VPN" };

    expect(shouldHydrateTimerDraft(false, localDraft, previousServerDraft)).toBe(false);
    expect(shouldHydrateTimerDraft(false, previousServerDraft, previousServerDraft)).toBe(true);
    expect(shouldHydrateTimerDraft(true, localDraft, previousServerDraft)).toBe(true);
  });
});

function bootstrapData(activeEntry: TimeEntryRow | null) {
  const entries = activeEntry ? [activeEntry] : [];
  return {
    activeEntry,
    categories: [
      { id: "focus", name: "Focus", color: "coral", isPinned: true },
      { id: "work", name: "Work", color: "blue", isPinned: true },
      { id: "chores", name: "Chores", color: "orange", isPinned: true }
    ],
    tags: [
      { id: "tag-1", name: "Ship", normalizedName: "ship" },
      { id: "tag-cubic", name: "Cubic", normalizedName: "cubic" }
    ],
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

function timerStartHarness(
  initialData: BootstrapData,
  initialDraft: TimerDraft = timerDraftForEntry(initialData.activeEntry),
  send: (payload: TimerStartRequestPayload) => Promise<void> = async () => undefined
) {
  const gate = createTimerMutationGate();
  let data = initialData;
  let draft = initialDraft;
  let busy = false;
  let error: string | null = null;
  const requests: TimerStartRequestPayload[] = [];
  const drafts: TimerDraft[] = [];
  let optimisticId = 0;

  return {
    run(input: Partial<TimerDraft>) {
      return runTimerStartMutation({
        gate,
        snapshot: data,
        currentDraft: draft,
        input,
        now: () => "2026-07-22T10:00:00.000Z",
        createOptimisticId: () => `optimistic-${++optimisticId}`,
        commit: (nextData) => { data = nextData; },
        setDraft: (nextDraft) => {
          draft = nextDraft;
          drafts.push(nextDraft);
        },
        setBusy: (nextBusy) => { busy = nextBusy; },
        setError: (nextError) => { error = nextError; },
        send: async (payload) => {
          requests.push(payload);
          await send(payload);
        },
        refresh: async () => undefined
      });
    },
    state: () => ({ data, draft, drafts, requests, busy, error })
  };
}

function serializedRequest(payload: TimerStartRequestPayload) {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function compactPlan(): CalendarEntryCompactSavePlan {
  return {
    durationSeconds: 4_800,
    payload: {
      categoryId: "work",
      description: "Calendar draft",
      startedAt: "2026-07-22T08:45:00.000Z"
    },
    resolved: {
      categoryId: "work",
      description: "Calendar draft",
      tagNames: ["ship"],
      startedAt: "2026-07-22T08:45:00.000Z",
      stoppedAt: null
    }
  };
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
    updatedAt: "2026-07-22T09:00:00.000Z",
    durationSeconds: 60,
    tagNames: [],
    tags: [],
    ...overrides
  } as TimeEntryRow;
}
