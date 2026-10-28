import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MobileBootstrap } from "./api";

// The iPhone split's Undo window (owner 28 Oct 2026): synthetic ids, names and times only.
vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.mock("react-native", () => ({ AccessibilityInfo: { announceForAccessibility: vi.fn() } }));
const outbox = vi.hoisted(() => ({
  enqueue: vi.fn(async () => ({ clientCommandId: "mobile-time-entry:split-1" })),
  release: vi.fn(async () => 1),
  remove: vi.fn(async () => 1),
  pending: vi.fn(async () => [] as Array<{ clientCommandId: string; optimisticEntryId?: string }>),
  dispatched: vi.fn(() => false)
}));
vi.mock("./timeEntryOutbox", () => ({
  createTimeEntryCommandHoldLease: () => ({ ended: false, end: vi.fn() }),
  enqueueTimeEntrySplit: outbox.enqueue,
  releaseTimeEntryCommands: outbox.release,
  removeTimeEntryCommands: outbox.remove,
  readPendingTimeEntryCommands: outbox.pending,
  wereTimeEntryCommandsDispatched: outbox.dispatched,
  extendTimeEntryCommandHold: vi.fn(),
  enqueueTimeEntryDelete: vi.fn()
}));

const { useRunningSplit } = await import("./useRunningSplit");

const OWNER = { userId: "user-a", workspaceId: "workspace-a" };
const RUNNING = "70000000-0000-4000-8000-000000000001";

function bootstrap(): MobileBootstrap {
  const running = {
    id: RUNNING, projectId: null, projectName: null, projectColor: null, clientName: null, categoryId: "c", categoryName: "Writing",
    categoryColor: "green", placeName: null, source: "mobile_app", confidence: "high", reviewStatus: "confirmed",
    description: "Draft chapter", startedAt: "2026-08-22T10:00:00.000Z", stoppedAt: null, durationSeconds: 0, tagNames: []
  };
  return {
    user: { id: OWNER.userId, email: "a@example.com", name: "A" }, workspace: { id: OWNER.workspaceId, name: "A" },
    activeEntry: running, projects: [], categories: [], entries: [running], places: [], reviewItems: []
  } as MobileBootstrap;
}

describe("useRunningSplit", () => {
  let data: MobileBootstrap | null;
  let api!: ReturnType<typeof useRunningSplit>;
  const deliver = vi.fn();

  function Probe() {
    api = useRunningSplit({
      read: () => data,
      update: (change) => { data = change(data); },
      owner: () => OWNER,
      persistedId: (id) => id,
      isOnline: () => true,
      deliver,
      onStorageFailure: vi.fn()
    });
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T11:00:00.000Z"));
    data = bootstrap();
    deliver.mockClear();
    for (const mock of Object.values(outbox)) mock.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("shows the split at once, holds it, and Undo puts back one running block without sending anything", async () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe />); });
    await act(async () => { await api.split(Date.parse("2026-08-22T10:30:00.000Z")); });
    const secondId = data!.activeEntry!.id;
    expect(secondId).toMatch(/^optimistic-active-timer:split:/);
    expect(data!.entries.find((entry) => entry.id === RUNNING)?.stoppedAt).toBe("2026-08-22T10:30:00.000Z");
    expect(outbox.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      owner: OWNER, target: { targetEntryId: RUNNING }, splitAt: "2026-08-22T10:30:00.000Z", splitEntryLocalId: secondId,
      deliverAfter: "2026-08-22T11:00:06.000Z"
    }));
    expect(api.held).toMatchObject({ title: "Draft chapter", commandId: "mobile-time-entry:split-1" });
    // An Edit of the second part made in the window goes with it.
    outbox.pending.mockResolvedValueOnce([{ clientCommandId: "mobile-time-entry:edit-2", optimisticEntryId: secondId }]);
    await act(async () => { expect(await api.undo()).toBe(true); });
    expect(outbox.remove).toHaveBeenCalledWith(["mobile-time-entry:split-1", "mobile-time-entry:edit-2"]);
    expect(data!.activeEntry).toMatchObject({ id: RUNNING, stoppedAt: null });
    expect(data!.entries.map((entry) => entry.id)).toEqual([RUNNING]);
    expect(api.held).toBeNull();
    await act(async () => { vi.advanceTimersByTime(6_000); });
    expect(outbox.release).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("lets it go when the window closes, and refuses a late Undo once the second part stopped", async () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe />); });
    await act(async () => { await api.split(Date.parse("2026-08-22T10:30:00.000Z")); });
    await act(async () => { vi.advanceTimersByTime(5_000); await Promise.resolve(); });
    expect(outbox.release).toHaveBeenCalledWith(["mobile-time-entry:split-1"], { owner: OWNER, requestImmediateDelivery: true });
    await act(async () => { await Promise.resolve(); });
    expect(deliver).toHaveBeenCalledWith(OWNER);
    expect(api.held).toBeNull();

    await act(async () => { await api.split(Date.parse("2026-08-22T10:45:00.000Z")); });
    data = { ...data!, activeEntry: null };
    await act(async () => { expect(await api.undo()).toBe(false); });
    expect(outbox.remove).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("never splits outside the running block", async () => {
    let tree!: ReturnType<typeof create>;
    act(() => { tree = create(<Probe />); });
    await act(async () => { expect(await api.split(Date.parse("2026-08-22T09:59:00.000Z"))).toBe(false); });
    await act(async () => { expect(await api.split(Date.parse("2026-08-22T11:01:00.000Z"))).toBe(false); });
    expect(outbox.enqueue).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
