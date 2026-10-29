import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { useCheckLinks, type CheckLinkOwner } from "./useCheckLinks";

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

function mount(initial: { ready?: boolean; owner?: CheckLinkOwner | null; listed?: string[]; lookup?: (owner: CheckLinkOwner, id: string) => Promise<string | null> } = {}) {
  const calls = {
    openCheck: vi.fn((id: string, _dayKey?: string) => props.listed.includes(id)),
    openDay: vi.fn(),
    openTodayFirst: vi.fn(),
    lookupStart: vi.fn((owner: CheckLinkOwner, id: string) => props.lookup(owner, id))
  };
  let props = {
    ready: initial.ready ?? true,
    owner: initial.owner === undefined ? A : initial.owner,
    listed: initial.listed ?? [],
    lookup: initial.lookup ?? (async () => null as string | null)
  };
  const result: { open: (check: string) => void } = { open: () => undefined };
  function Harness(current: typeof props) {
    result.open = useCheckLinks({
      ready: current.ready, owner: current.owner, todayKey: "2026-10-29",
      openCheck: calls.openCheck, openDay: calls.openDay, openTodayFirst: calls.openTodayFirst,
      lookupStart: calls.lookupStart, dayKeyOf: (instant) => instant.slice(0, 10)
    });
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Harness {...props} />); });
  const update = (next: Partial<typeof props>) => act(() => { props = { ...props, ...next }; tree.update(<Harness {...props} />); });
  return { calls, update, link: (check: string) => act(() => result.open(check)) };
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
});
