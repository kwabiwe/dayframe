// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewItemRow } from "@/lib/queries";

vi.mock("@/lib/client-auth-fetch", () => ({ clientFetch: vi.fn() }));
const { useClashesBeyondCap } = await import("./useClashesBeyondCap");

// Web parity with #622: when the read runs, and that one owner's read is never used for another. Synthetic ids only.
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

function Probe({ items, owner, version, fetcher }: { items: readonly ReviewItemRow[]; owner: string; version: number; fetcher: (url: string, init: RequestInit) => Promise<Response> }) {
  const found = useClashesBeyondCap({ bootstrapItems: items, dataVersion: version, fetcher, owner, todayStartMs: new Date(2026, 9, 28).getTime() });
  return <output data-testid="found">{found.map((item) => item.id).join(",")}</output>;
}

describe("useClashesBeyondCap", () => {
  afterEach(() => cleanup());

  it("reads only when the bootstrap reached its cap, at most once a minute on refreshes", async () => {
    const fetcher = vi.fn(async () => page([record(1)]));
    const view = render(<Probe fetcher={fetcher} items={full.slice(0, 50)} owner="w1:u1" version={1} />);
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full} owner="w1:u1" version={2} />));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("found").textContent).toBe(id(1_001));
    await act(async () => view.rerender(<Probe fetcher={fetcher} items={full} owner="w1:u1" version={3} />));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("an account switch mid-read: the first account's read is dropped and the next one reads its own", async () => {
    let release: (() => void) | undefined;
    const slow = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      release = () => resolve(page([record(1)]));
    }));
    const view = render(<Probe fetcher={slow} items={full} owner="w1:u1" version={1} />);
    const second = vi.fn(async () => page([record(2)]));
    await act(async () => view.rerender(<Probe fetcher={second} items={full} owner="w2:u2" version={2} />));
    await act(async () => release?.());
    expect(screen.getByTestId("found").textContent).toBe(id(1_002));
  });
});
