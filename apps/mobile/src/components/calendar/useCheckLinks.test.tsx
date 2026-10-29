import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { CHECK_LINK_WAIT_MS, useCheckLinks, type CheckLinkItem, type CheckLinkOwner } from "./useCheckLinks";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

const ID = "30000000-0000-4000-8000-000000000001";
const OTHER = "30000000-0000-4000-8000-000000000002";
const A: CheckLinkOwner = { backendId: "b", workspaceId: "w", userId: "a" };
const B: CheckLinkOwner = { backendId: "b", workspaceId: "w", userId: "b" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Found = CheckLinkItem | string | null;
/** Whether any openCheck call actually opened its "?". */
const opened = (fn: { mock: { results: { value: unknown }[] } }) => fn.mock.results.some((result) => result.value === true);
const asFound = (found: Found): CheckLinkItem | null => typeof found === "string" ? { startedAt: found, asks: false } : found;

function mount(initial: { ready?: boolean; owner?: CheckLinkOwner | null; listed?: string[]; lookup?: (owner: CheckLinkOwner, id: string) => Promise<Found>;
  selectedDayKey?: string; now?: number } = {}) {
  const calls = {
    openCheck: vi.fn((id: string, _dayKey?: string) => props.listed.includes(id)),
    openDay: vi.fn((dayKey: string) => { props.selectedDayKey = dayKey; }),
    openTodayFirst: vi.fn(),
    lookupStart: vi.fn((owner: CheckLinkOwner, id: string) => props.lookup(owner, id).then(asFound))
  };
  let props = {
    ready: initial.ready ?? true,
    owner: initial.owner === undefined ? A : initial.owner,
    listed: initial.listed ?? [],
    lookup: initial.lookup ?? (async () => null as Found),
    selectedDayKey: initial.selectedDayKey ?? "2026-10-29",
    loads: 0,
    now: initial.now ?? 1_000
  };
  const result: { open: (check: string) => void } = { open: () => undefined };
  function Harness(current: typeof props) {
    result.open = useCheckLinks({
      ready: current.ready, owner: current.owner, todayKey: "2026-10-29", selectedDayKey: props.selectedDayKey, loads: current.loads,
      openCheck: calls.openCheck, openDay: calls.openDay, openTodayFirst: calls.openTodayFirst,
      lookupItem: calls.lookupStart, dayKeyOf: (instant) => instant.slice(0, 10), now: () => props.now
    });
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness {...props} />); });
  const update = (next: Partial<typeof props>) => act(() => { props = { ...props, ...next }; tree.update(<Harness {...props} />); });
  return { calls, update, link: (check: string) => act(() => result.open(check)), load: (next: Partial<typeof props> = {}) => update({ ...next, loads: props.loads + 1 }),
    props: () => props };
}

describe("old Review links in Calendar › List (step 15; Codex r1 on #615)", () => {
  it("opens a \"?\" the List has on its day, once (a warm link)", () => {
    const { calls, link } = mount({ listed: [ID] });
    link(ID);
    expect(calls.openCheck).toHaveBeenCalledWith(ID);
    expect(calls.lookupStart).not.toHaveBeenCalled();
    expect(calls.openDay).not.toHaveBeenCalled();
  });

  it("opens today's first \"?\" for a link that names none", () => {
    const { calls, link } = mount();
    link("first");
    expect(calls.openTodayFirst).toHaveBeenCalledOnce();
    expect(calls.openCheck).not.toHaveBeenCalled();
  });

  it("holds a cold link until signed in with the bootstrap in, then answers it for that account", async () => {
    const lookup = vi.fn(async () => "2026-10-20T09:00:00.000Z");
    const { calls, link, update } = mount({ ready: false, owner: null, lookup });
    link(ID);
    expect(calls.openCheck).not.toHaveBeenCalled();
    update({ owner: A });
    expect(calls.openCheck).not.toHaveBeenCalled();
    update({ ready: true });
    await act(async () => { await Promise.resolve(); });
    expect(lookup).toHaveBeenCalledWith(A, ID);
    expect(calls.openDay).toHaveBeenCalledWith("2026-10-20");
  });

  it("reads a decided item's or a capped-out item's day before opening the List there", async () => {
    // Not in the List (decided, or beyond the bootstrap's 100 open items): one owner-scoped read gives its day.
    const { calls, link } = mount({ lookup: async (_owner, id) => id === ID ? "2026-10-12T22:30:00.000Z" : null });
    link(ID);
    await act(async () => { await Promise.resolve(); });
    expect(calls.lookupStart).toHaveBeenCalledOnce();
    expect(calls.openDay).toHaveBeenLastCalledWith("2026-10-12");
  });

  it("opens a late bootstrap's own \"?\" without a read", () => {
    const { calls, link, update } = mount({ ready: false });
    link(ID);
    update({ ready: true, listed: [ID] });
    expect(calls.openCheck).toHaveBeenCalledWith(ID);
    expect(calls.lookupStart).not.toHaveBeenCalled();
  });

  it("falls back to today when the read fails, finds nothing, or the id can't be looked up", async () => {
    const failing = mount({ lookup: async () => { throw new Error("offline"); } });
    failing.link(ID);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(failing.calls.openDay).toHaveBeenLastCalledWith("2026-10-29");
    const missing = mount({ lookup: async () => null });
    missing.link(ID);
    await act(async () => { await Promise.resolve(); });
    expect(missing.calls.openDay).toHaveBeenLastCalledWith("2026-10-29");
    const notUuid = mount();
    notUuid.link("not-an-id");
    expect(notUuid.calls.lookupStart).not.toHaveBeenCalled();
    expect(notUuid.calls.openDay).toHaveBeenLastCalledWith("2026-10-29");
  });

  it("opens today, not the old account's day, when the account changes while it reads; nothing once signed out", async () => {
    const read = deferred<string | null>();
    const switching = mount({ lookup: () => read.promise });
    switching.link(ID);
    switching.update({ owner: B });
    await act(async () => { read.resolve("2026-10-20T09:00:00.000Z"); await read.promise; });
    expect(switching.calls.openDay).toHaveBeenLastCalledWith("2026-10-29");

    const later = deferred<string | null>();
    const signingOut = mount({ lookup: () => later.promise });
    signingOut.link(ID);
    signingOut.update({ owner: null, ready: false });
    await act(async () => { later.resolve("2026-10-20T09:00:00.000Z"); await later.promise; });
    expect(signingOut.calls.openDay).not.toHaveBeenCalled();
  });

  it("lets a newer link win over an older read still in flight", async () => {
    const slow = deferred<string | null>();
    const { calls, link } = mount({ listed: [OTHER], lookup: () => slow.promise });
    link(ID);
    link(OTHER);
    expect(calls.openCheck).toHaveBeenLastCalledWith(OTHER);
    await act(async () => { slow.resolve("2026-10-20T09:00:00.000Z"); await slow.promise; });
    expect(calls.openDay).not.toHaveBeenCalled();
  });

  it("keeps the named \"?\" through the read: one that arrived meanwhile opens by its id on its day, never the day's first (Codex r2 on #615)", async () => {
    const read = deferred<string | null>();
    const { calls, link, update } = mount({ lookup: () => read.promise });
    link(ID);
    expect(calls.openCheck).toHaveBeenLastCalledWith(ID);
    // The bootstrap brings it while the read is out.
    update({ listed: [ID] });
    await act(async () => { read.resolve("2026-10-27T08:00:00.000Z"); await read.promise; });
    expect(calls.openCheck).toHaveBeenLastCalledWith(ID, "2026-10-27");
    expect(calls.openDay).not.toHaveBeenCalled();
  });

  it("opens the day with nothing selected when the named item no longer asks (Codex r2 on #615)", async () => {
    const { calls, link } = mount({ listed: [OTHER], lookup: async () => "2026-10-27T08:00:00.000Z" });
    link(ID);
    await act(async () => { await Promise.resolve(); });
    expect(calls.openCheck).toHaveBeenLastCalledWith(ID, "2026-10-27");
    expect(calls.openCheck).not.toHaveBeenCalledWith(OTHER, expect.anything());
    expect(calls.openDay).toHaveBeenCalledWith("2026-10-27");
    expect(calls.openTodayFirst).not.toHaveBeenCalled();
  });

  it("keeps a named \"?\" the server says still asks waiting on its day, and opens it when a load brings it (Codex r4 on #615)", async () => {
    const { calls, link, load } = mount({ lookup: async () => ({ startedAt: "2026-10-27T08:00:00.000Z", asks: true }) });
    link(ID);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Its day opens unselected while the List doesn't have it yet.
    expect(calls.openDay).toHaveBeenCalledWith("2026-10-27");
    // The day's load brings it: its own request opens, by its id.
    calls.openCheck.mockClear();
    load({ listed: [ID] });
    expect(calls.openCheck).toHaveBeenCalledWith(ID, "2026-10-27");
    // Opened once: later loads don't ask again.
    calls.openCheck.mockClear();
    load();
    expect(calls.openCheck).not.toHaveBeenCalled();
  });

  it("stops waiting after its loads or its time run out, or once another day is shown (Codex r4 on #615)", async () => {
    const asking = async () => ({ startedAt: "2026-10-27T08:00:00.000Z", asks: true });
    const loads = mount({ lookup: asking });
    loads.link(ID);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    loads.calls.openCheck.mockClear();
    loads.load();
    loads.load();
    loads.load({ listed: [ID] });
    expect(opened(loads.calls.openCheck)).toBe(false);

    const timed = mount({ lookup: asking });
    timed.link(ID);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    timed.calls.openCheck.mockClear();
    timed.load({ now: 1_000 + CHECK_LINK_WAIT_MS + 1, listed: [ID] });
    expect(opened(timed.calls.openCheck)).toBe(false);

    const moved = mount({ lookup: asking });
    moved.link(ID);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    moved.calls.openCheck.mockClear();
    moved.update({ selectedDayKey: "2026-10-28" });
    moved.load({ listed: [ID] });
    expect(opened(moved.calls.openCheck)).toBe(false);
  });

  it("doesn't wait for a named item that no longer asks: its day stays unselected (Codex r4 on #615)", async () => {
    const { calls, link, load } = mount({ lookup: async () => ({ startedAt: "2026-10-27T08:00:00.000Z", asks: false }) });
    link(ID);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(calls.openDay).toHaveBeenCalledWith("2026-10-27");
    calls.openCheck.mockClear();
    load({ listed: [ID] });
    expect(calls.openCheck).not.toHaveBeenCalled();
  });
});
