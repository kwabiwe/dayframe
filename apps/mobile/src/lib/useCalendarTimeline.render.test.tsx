import { act, create } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@dayframe/shared";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});

import { useCalendarTimeline } from "./useCalendarTimeline";

// Location v4 step 9 (Codex r1 on #570): synthetic days, no places.
const day = (date: string, id = date): LocationTimeline =>
  ({ date, timeZone: "UTC", dayStart: `${date}T00:00:00.000Z`, dayEnd: `${date}T23:59:59.999Z`, gaps: [], openTrip: null, items: [{ id } as never] }) as LocationTimeline;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(initial: { dayKey: string; owner: string | null; refreshKey?: unknown }) {
  const reads: Array<{ dayKey: string; signal: AbortSignal; reply: ReturnType<typeof deferred<LocationTimeline>> }> = [];
  const fetchTimeline = vi.fn((dayKey: string, options: { signal: AbortSignal }) => {
    const reply = deferred<LocationTimeline>();
    reads.push({ dayKey, signal: options.signal, reply });
    return reply.promise;
  });
  const seen: Array<LocationTimeline | null> = [];
  function Probe(props: { dayKey: string; owner: string | null; refreshKey?: unknown }) {
    seen.push(useCalendarTimeline({ enabled: true, fetchTimeline, refreshKey: props.refreshKey ?? 0, ...props }));
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(<Probe {...initial} />); });
  return { reads, latest: () => seen[seen.length - 1], update: (props: Parameters<typeof Probe>[0]) => act(() => tree.update(<Probe {...props} />)) };
}

describe("useCalendarTimeline (location v4 step 9)", () => {
  it("never lets a superseded read land over a newer one, even when it finishes last", async () => {
    const view = harness({ dayKey: "2026-10-22", owner: "w:u", refreshKey: 1 });
    view.update({ dayKey: "2026-10-22", owner: "w:u", refreshKey: 2 });
    expect(view.reads[0].signal.aborted).toBe(true);
    await act(async () => { view.reads[1].reply.resolve(day("2026-10-22", "new")); });
    await act(async () => { view.reads[0].reply.resolve(day("2026-10-22", "old")); });
    expect(view.latest()?.items[0]).toMatchObject({ id: "new" });
  });

  it("shows a day's timeline only for that day", async () => {
    const view = harness({ dayKey: "2026-10-22", owner: "w:u" });
    await act(async () => { view.reads[0].reply.resolve(day("2026-10-22")); });
    view.update({ dayKey: "2026-10-23", owner: "w:u" });
    expect(view.latest()).toBeNull();
  });

  it("drops one account's places at sign-out and never shows them to the next account", async () => {
    const view = harness({ dayKey: "2026-10-22", owner: "w:first" });
    await act(async () => { view.reads[0].reply.resolve(day("2026-10-22", "first")); });
    expect(view.latest()?.items[0]).toMatchObject({ id: "first" });
    view.update({ dayKey: "2026-10-22", owner: null });
    expect(view.latest()).toBeNull();
    view.update({ dayKey: "2026-10-22", owner: "w:second" });
    expect(view.latest()).toBeNull();
    await act(async () => { view.reads[1].reply.resolve(day("2026-10-22", "second")); });
    expect(view.latest()?.items[0]).toMatchObject({ id: "second" });
  });

  it("leaves the blocks on their own when a read fails", async () => {
    const view = harness({ dayKey: "2026-10-22", owner: "w:u" });
    await act(async () => { view.reads[0].reply.resolve(Promise.reject(new Error("offline")) as never); });
    expect(view.latest()).toBeNull();
  });
});
