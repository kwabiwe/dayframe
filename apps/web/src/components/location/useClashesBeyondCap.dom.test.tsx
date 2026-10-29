// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItemRow } from "@/lib/queries";

vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: vi.fn() }));
const { useClashesBeyondCap } = await import("./useClashesBeyondCap");

// Web parity with #622: when the read runs, and what of it may ever show (Codex r1 on #623). Synthetic ids only.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const full = Array.from({ length: 100 }, (_, n) => ({ id: id(n), type: "suggestion" }) as ReviewItemRow);
const record = (n: number) => ({
  kind: "review", reviewItemId: id(1_000 + n), eventId: null, locationSegmentId: null, sourceKind: "generic", eventSource: "location_learning",
  eventType: "timer_trip_clash", title: "Block ran 20m into your trip", category: { id: null, name: null, color: null }, place: { id: null, label: null },
  interval: { start: "2026-10-27T08:00:00.000Z", end: "2026-10-27T10:00:00.000Z" }, confidence: "high", status: "open",
  createdAt: "2026-10-27T11:00:00.000Z", updatedAt: "2026-10-27T11:00:00.000Z", proposalHash: "e".repeat(64), canonicalEntryIds: [],
  semanticRevision: null, timerTripClash: { timeEntryId: id(9_000 + n), tripId: "trip", tripStartedAt: "2026-10-27T10:00:00.000Z",
    tripStoppedAt: "2026-10-27T11:00:00.000Z", overlapSeconds: 1_200 }
});
const page = (records: unknown[]) => new Response(JSON.stringify({
  version: 1, scope: { mode: "window", timeZone: "UTC" }, snapshotToken: "s", capturedAt: "2026-10-28T09:00:00.000Z", nextCursor: null,
  completeness: { records: true, outstandingCounts: true, completedToday: false, partialReason: null },
  outstanding: { globalCount: 0, todayCount: 0, openReviewItemIds: [] }, records, links: [], lookup: { reviewItems: [], entries: [] }
}));
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
/** A fetcher whose replies the test releases one by one. */
function heldFetcher(replies: unknown[][]) {
  const pending: Array<{ release: () => void; aborted: () => boolean }> = [];
  const fetcher = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const records = replies[pending.length] ?? [];
    let aborted = false;
    init.signal?.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); });
    pending.push({ release: () => resolve(page(records)), aborted: () => aborted });
  }));
  return { fetcher, pending };
}

function Probe({ items, owner, version, fetcher }: { items: readonly ReviewItemRow[]; owner: string; version: number; fetcher: Fetcher }) {
  const found = useClashesBeyondCap({ bootstrapItems: items, dataVersion: version, fetcher, owner, todayStartMs: new Date(2026, 9, 28).getTime() });
  return <output data-testid="found">{found.map((item) => item.id).join(",")}</output>;
}
const found = () => screen.getByTestId("found").textContent;

describe("useClashesBeyondCap", () => {
  afterEach(() => cleanup());

  it("reads only when the bootstrap reached its cap, at most once a minute on refreshes", async () => {
    const fetcher = vi.fn(async () => page([record(1)]));
    const view = render(<Probe fetcher={fetcher} items={full.slice(0, 50)} owner="w1:u1" version={1} />);
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full} owner="w1:u1" version={2} />));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(found()).toBe(id(1_001));
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full} owner="w1:u1" version={3} />));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("100 → 99 → 100 within a minute: the complete bootstrap clears the cache and a read from before it restores nothing", async () => {
    const { fetcher, pending } = heldFetcher([[record(1)], [record(1)], []]);
    const view = render(<Probe fetcher={fetcher} items={full} owner="w1:u1" version={1} />);
    await act(async () => pending[0].release());
    expect(found()).toBe(id(1_001));
    // A refresh a minute later starts a read; before it answers, a complete bootstrap (99 items) arrives.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full} owner="w1:u1" version={2} />));
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full.slice(0, 99)} owner="w1:u1" version={3} />));
    expect(found()).toBe("");
    expect(pending[1].aborted()).toBe(true);
    // Back at 100: the old cache does not return, and the old read (had it answered) applies nowhere; a fresh read runs.
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full} owner="w1:u1" version={4} />));
    expect(found()).toBe("");
    await act(async () => pending[1].release());
    expect(found()).toBe("");
    expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => pending[2].release());
    expect(found()).toBe("");
    vi.restoreAllMocks();
  });

  it("A → B → A with B's read unfinished: A's old cache is not shown, and B's late reply applies nowhere", async () => {
    const { fetcher, pending } = heldFetcher([[record(1)], [record(2)], []]);
    const view = render(<Probe fetcher={fetcher} items={full} owner="wA:u" version={1} />);
    await act(async () => pending[0].release());
    expect(found()).toBe(id(1_001));
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full} owner="wB:u" version={2} />));
    expect(found()).toBe("");
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full} owner="wA:u" version={3} />));
    expect(found()).toBe("");
    // A's new lifetime reads at once (no throttle carried over); B's reply never shows.
    expect(fetcher).toHaveBeenCalledTimes(3);
    await act(async () => pending[1].release());
    expect(found()).toBe("");
    await act(async () => pending[2].release());
    expect(found()).toBe("");
  });

  it("a refresh of the same owner (a Calendar date load) neither aborts nor throttles away the read in flight", async () => {
    const { fetcher, pending } = heldFetcher([[record(3)]]);
    const view = render(<Probe fetcher={fetcher} items={full} owner="w1:u1" version={1} />);
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full} owner="w1:u1" version={2} />));
    expect(pending[0].aborted()).toBe(false);
    await act(async () => pending[0].release());
    expect(found()).toBe(id(1_003));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("the shell feeds it the stable canonical bootstrap, never the selected period's data (Codex r1 on #623)", () => {
    const shell = readFileSync(`${process.cwd()}/src/components/AppShell.tsx`, "utf8");
    expect(shell).toContain("useClashesBeyondCap({ bootstrapItems: canonicalItems, dataVersion: canonical, owner: canonicalOwner, todayStartMs })");
    expect(shell).toContain("const canonicalOwner = canonical ? `${canonical.workspace.id}:${canonical.user.id}` : \"\";");
  });
});
