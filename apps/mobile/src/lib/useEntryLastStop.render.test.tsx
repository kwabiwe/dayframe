import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryLastStopPage, MobileBootstrap, MobileTimeEntry } from "./api";
import { projectDurableLocalWork } from "./durableLocalProjection";
import { projectedLastStopIds } from "./entryLastStop";
import { optimisticPatchTimeEntry, optimisticStopActiveTimer, rollbackOptimisticStopSafely, rollbackRejectedOptimisticTimerStart } from "./timerPresentation";
import { useEntryLastStop } from "./useEntryLastStop";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("./api", () => ({ fetchEntryLastStops: mocks.fetch }));

const owner = { userId: "one", workspaceId: "workspace" };
const at = (hour: number) => new Date(2026, 9, 25, hour).getTime();
const row = (id: string, stop: number) => ({ id, stoppedAt: new Date(stop).toISOString() });
const page = (rows: EntryLastStopPage["rows"], truncated = false) => ({ rows, truncated });
const empty: readonly MobileTimeEntry[] = [];
const defaults = { owner, entryId: "edit", entries: empty, presentationId: 1, visible: true, startMs: at(12), cutoffMs: at(12), endMs: at(13) };
let root: ReactTestRenderer;
let result: ReturnType<typeof useEntryLastStop>;
function Reader(input: Parameters<typeof useEntryLastStop>[0]) {
  result = useEntryLastStop(input);
  return null;
}
async function render(input: Partial<Parameters<typeof useEntryLastStop>[0]> = {}) {
  await act(async () => {
    const component = createElement(Reader, { ...defaults, ...input });
    if (root) root.update(component);
    else root = create(component);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.fetch.mockReset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined as unknown as ReactTestRenderer;
  vi.useRealTimers();
});

describe("Last stop date read", () => {
  it("uses one day read across time adjustments and keeps an owner-scoped optimistic stop", async () => {
    mocks.fetch.mockResolvedValue(page([row("server", at(9)), row("later", at(15))]));
    const entries = [{ ...row("queued-stop", at(10)), reviewStatus: "confirmed" }] as MobileTimeEntry[];
    const projectedIds = projectedLastStopIds([], entries);
    await render({ entries, projectedIds });
    expect(result).toEqual({ candidate: row("queued-stop", at(10)), status: "ready" });
    await render({ startMs: at(16), cutoffMs: at(16), endMs: at(17), entries, projectedIds });
    expect(result).toEqual({ candidate: row("later", at(15)), status: "ready" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the previous canonical timer finished by a preexisting queued Switch and follows changes while open", async () => {
    const running = {
      id: "canonical-running", projectId: null, projectName: null, projectColor: null,
      clientName: null, categoryId: null, categoryName: null, placeName: null, source: "mobile_app",
      confidence: "high", reviewStatus: "confirmed", description: null,
      startedAt: new Date(at(8)).toISOString(), stoppedAt: null, durationSeconds: 0
    } satisfies MobileTimeEntry;
    const canonical: MobileBootstrap = {
      user: { id: owner.userId, email: "fixture@example.invalid", name: "Fixture" },
      workspace: { id: owner.workspaceId, name: "Fixture" }, projects: [], categories: [],
      places: [], reviewItems: [], activeEntry: running, entries: [running]
    };
    const switchId = "optimistic-active-timer:replacement";
    const switched = projectDurableLocalWork(canonical, {
      owner, correlations: new Map(), timeEntryCommands: [], timerStops: [],
      activityEvents: [{ ...owner, type: "timer_start", source: "mobile_app", localId: switchId,
        occurredAt: new Date(at(10)), queuedAt: new Date(at(10)).toISOString() }]
    });
    const originalPage = page([row("historical-server", at(9))]);
    mocks.fetch.mockResolvedValue(originalPage);
    const publish = async (data: MobileBootstrap, deletedIds?: ReadonlySet<string>) => render({
      entries: data.entries, projectedIds: projectedLastStopIds(canonical.entries, data.entries), deletedIds
    });
    expect(switched.activeEntry?.id).toBe(switchId);
    expect(projectedLastStopIds(canonical.entries, switched.entries)).toEqual(new Set([running.id]));
    await publish(switched);
    expect(result.candidate).toEqual(row(running.id, at(10)));

    const restored = rollbackRejectedOptimisticTimerStart(switched, canonical, switchId)!;
    await publish(restored);
    expect(result.candidate).toEqual(row("historical-server", at(9)));

    const stopped = optimisticStopActiveTimer(restored, new Date(at(11)).toISOString())!;
    await publish(stopped);
    expect(result.candidate).toEqual(row(running.id, at(11)));
    const edited = optimisticPatchTimeEntry(stopped, running.id, { stoppedAt: new Date(at(10)).toISOString() })!;
    await publish(edited);
    expect(result.candidate).toEqual(row(running.id, at(10)));
    await publish(edited, new Set([running.id, "historical-server"]));
    expect(result).toEqual({ candidate: null, status: "ready" });
    const rolledBack = rollbackOptimisticStopSafely(edited, canonical, running.id, new Map())!;
    await publish(rolledBack);
    expect(result.candidate).toEqual(row("historical-server", at(9)));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("replaces a same-day historical page after an accepted bootstrap and ignores its superseded response", async () => {
    let resolveOld!: (page: EntryLastStopPage) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise<EntryLastStopPage>((resolve) => { resolveOld = resolve; }));
    mocks.fetch.mockResolvedValueOnce(page([row("fresh-server", at(10))]));
    await render({ bootstrapGeneration: 1 });
    const oldSignal = mocks.fetch.mock.calls[0][0].signal as AbortSignal;
    await render({ bootstrapGeneration: 2 });
    expect(oldSignal.aborted).toBe(true);
    expect(result).toEqual({ candidate: row("fresh-server", at(10)), status: "ready" });
    await act(async () => { resolveOld(page([row("stale-server", at(11))])); });
    expect(result).toEqual({ candidate: row("fresh-server", at(10)), status: "ready" });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("narrows only after a capped day misses the chosen time and the time changes settle", async () => {
    vi.useFakeTimers();
    mocks.fetch.mockResolvedValueOnce(page([row("later", at(15))], true)).mockResolvedValueOnce(page([row("earlier", at(9))]));
    await render();
    expect(result).toEqual({ candidate: null, status: "loading" });
    await render({ startMs: at(11), cutoffMs: at(11) });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][0].throughMs).toBe(at(11));
    expect(result).toEqual({ candidate: row("earlier", at(9)), status: "ready" });
  });

  it("does not replace a newer owner or date and distinguishes unavailable from verified empty", async () => {
    let resolveOld!: (page: EntryLastStopPage) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise<EntryLastStopPage>((resolve) => { resolveOld = resolve; }));
    mocks.fetch.mockResolvedValueOnce(page([]));
    mocks.fetch.mockRejectedValueOnce(new Error("Offline"));
    await render();
    const old = mocks.fetch.mock.calls[0][0].signal as AbortSignal;
    expect(result.status).toBe("loading");
    await render({ owner: { ...owner, userId: "two" } });
    expect(old.aborted).toBe(true);
    expect(result).toEqual({ candidate: null, status: "ready" });
    await act(async () => { resolveOld(page([row("old-owner", at(9))])); });
    expect(result).toEqual({ candidate: null, status: "ready" });
    await render({ startMs: at(36), cutoffMs: at(36), endMs: at(37) });
    expect(result).toEqual({ candidate: null, status: "unavailable" });
  });
});
