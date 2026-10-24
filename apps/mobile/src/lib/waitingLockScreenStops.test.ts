import { describe, expect, it, vi } from "vitest";
import type { MobileBootstrap, QueuedEvent } from "./api";
import { shouldApplyDashboardRefresh } from "./dashboardRefresh";
import { createWaitingLockScreenStopsApplier } from "./waitingLockScreenStops";

const OWNER = { userId: "user-1", workspaceId: "workspace-1" };

function entry(id: string, stoppedAt: string | null = null): MobileBootstrap["entries"][number] {
  return {
    id, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: null,
    categoryName: null, categoryColor: null, placeName: null, source: "mobile_app", confidence: "high",
    reviewStatus: "confirmed", description: "Writing", startedAt: "2026-10-24T09:00:00.000Z", stoppedAt,
    durationSeconds: 0, tagNames: []
  } as MobileBootstrap["entries"][number];
}

function dashboard(active: MobileBootstrap["entries"][number] | null, entries = active ? [active] : []): MobileBootstrap {
  return {
    user: { id: OWNER.userId, email: "a@example.com", name: "A" },
    workspace: { id: OWNER.workspaceId, name: "A" },
    activeEntry: active, projects: [], categories: [], entries, places: [], reviewItems: []
  } as unknown as MobileBootstrap;
}

function lockScreenStop(targetEntryId: string, extra: Partial<QueuedEvent> = {}): QueuedEvent {
  return {
    ...OWNER, source: "shortcut", type: "timer_stop", localId: `stop-${targetEntryId}`,
    occurredAt: new Date("2026-10-24T09:30:00.000Z"), queuedAt: "2026-10-24T09:30:00.000Z",
    rawPayload: { origin: "ios_live_activity", stopScope: "entry", targetActivityId: "activity-1", targetEntryId },
    ...extra
  };
}

function harness(initial: MobileBootstrap | null, readStops: (owner: unknown) => Promise<QueuedEvent[]>) {
  const state = { shown: initial, revision: 0, published: [] as MobileBootstrap[] };
  const apply = createWaitingLockScreenStopsApplier({
    shown: () => state.shown,
    ownerOf: () => OWNER,
    readStops: vi.fn(readStops),
    revision: () => state.revision,
    publishAsMutation: (next) => {
      state.revision += 1;
      state.shown = next;
      state.published.push(next);
    }
  });
  return { apply, state };
}

describe("waiting Lock Screen Stops on the Dashboard shown (owner option A; Codex r1–r3 on #578)", () => {
  it("shows the running block stopped, as a mutation that invalidates a refresh already in flight", async () => {
    const running = entry("block-a");
    const { apply, state } = harness(dashboard(running), async () => [lockScreenStop("block-a")]);
    // A load that read the queue before the tap is still out.
    const inFlightLoad = { startedRevision: state.revision };

    await apply();

    expect(state.published).toHaveLength(1);
    expect(state.shown?.activeEntry).toBeNull();
    expect(state.shown?.entries[0]?.stoppedAt).toBe("2026-10-24T09:30:00.000Z");
    expect(shouldApplyDashboardRefresh({ ...inFlightLoad, currentRevision: state.revision, timerMutationsInFlight: 0 })).toBe(false);
  });

  it("publishes nothing when the Dashboard changed while the queue was read", async () => {
    let release!: (stops: QueuedEvent[]) => void;
    const { apply, state } = harness(dashboard(entry("block-a")), () => new Promise((resolve) => { release = resolve; }));
    const applying = apply();
    // The person started block B meanwhile (a local mutation).
    state.shown = dashboard(entry("block-b"));
    state.revision += 1;
    release([lockScreenStop("block-a")]);
    await applying;
    expect(state.published).toEqual([]);
    expect(state.shown?.activeEntry?.id).toBe("block-b");
  });

  it("never hides a newer running block for an older block's Stop", async () => {
    const older = entry("block-a", "2026-10-24T09:20:00.000Z");
    const newer = entry("block-b");
    const { apply, state } = harness(dashboard(newer, [newer, older]), async () => [lockScreenStop("block-a")]);
    await apply();
    expect(state.published).toEqual([]);
    expect(state.shown?.activeEntry?.id).toBe("block-b");
  });

  it("ignores refused, unscoped and other Stops, and does nothing when nothing runs", async () => {
    const running = entry("block-a");
    const { apply, state } = harness(dashboard(running), async () => [
      lockScreenStop("block-a", { failureKind: "permanent", failedAt: "2026-10-24T09:31:00.000Z", lastStatusCode: 422 }),
      lockScreenStop("block-a", { localId: "unscoped", rawPayload: { origin: "ios_app_shortcut", stopScope: "running_at" } })
    ]);
    await apply();
    expect(state.published).toEqual([]);

    const read = vi.fn(async () => [lockScreenStop("block-a")]);
    const idle = harness(dashboard(null), read);
    await idle.apply();
    expect(idle.state.published).toEqual([]);
  });

  it("shares one read between overlapping calls (a foreground and a load)", async () => {
    let calls = 0;
    let release!: (stops: QueuedEvent[]) => void;
    const { apply, state } = harness(dashboard(entry("block-a")), () => {
      calls += 1;
      return new Promise((resolve) => { release = resolve; });
    });
    const first = apply();
    const second = apply();
    expect(second).toBe(first);
    release([lockScreenStop("block-a")]);
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(state.published).toHaveLength(1);
    // A later call, with a block running again, reads again.
    state.shown = dashboard(entry("block-c"));
    const third = apply();
    release([]);
    await third;
    expect(calls).toBe(2);
  });
});
