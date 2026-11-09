import { readFileSync } from "node:fs";
import { useMemo, useState } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@dayframe/shared";
import type { MobileReviewItem } from "./api";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../node_modules/react/index.js");
});
vi.mock("./reviewSyncStore", () => ({ mobileReviewItemFromPresentation: (record: unknown) => record }));

const { keepScopedReviewItems } = await import("./calendarScopedReview");
const { useCalendarTimelineSnapshot } = await import("./useCalendarTimeline");

// Request-storm fix (30 Oct 2026), iPhone part: Calendar › List reads the selected day's location timeline again
// whenever the Calendar's data changes. With the bootstrap's Review list at its cap, that data folds in the scoped Review
// items, re-read on every Review store change (each bootstrap, each sync pass, each cached Today window); each read
// made a fresh array, so the timeline was read again for nothing. Synthetic items only.

const item = (id: string): MobileReviewItem => ({ id, status: "open", title: `Item ${id}`, suggestedStartedAt: "2026-10-30T09:00:00.000Z" }) as unknown as MobileReviewItem;
const day = (date: string): LocationTimeline =>
  ({ date, timeZone: "UTC", dayStart: `${date}T00:00:00.000Z`, dayEnd: `${date}T23:59:59.999Z`, gaps: [], openTrip: null, items: [] }) as LocationTimeline;

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 30, 12) });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Calendar › List request budget on iPhone (request-storm fix, 30 Oct 2026)", () => {
  it("keeps the same scoped items array when a read finds the same items", () => {
    const first = [item("a"), item("b")];
    expect(keepScopedReviewItems(first, [item("a"), item("b")])).toBe(first);
    const empty: MobileReviewItem[] = [];
    expect(keepScopedReviewItems(empty, [])).toBe(empty);
    const changed = [item("a"), item("c")];
    expect(keepScopedReviewItems(first, changed)).toBe(changed);
  });

  it("reads the day's timeline once over five minutes of Review store changes and clock re-renders, with a block running", async () => {
    const fetchTimeline = vi.fn(async (dayKey: string) => day(dayKey));
    const bootstrap = { workspace: { id: "w" }, user: { id: "u" }, reviewItems: [] as MobileReviewItem[] };
    let emit: () => void = () => undefined;
    let tick: () => void = () => undefined;
    // The dashboard's wiring: scoped items from each Review store change, the Calendar's data, its timeline refresh key.
    function Probe() {
      const [scoped, setScoped] = useState<MobileReviewItem[]>([]);
      const [, setNow] = useState(0);
      emit = () => setScoped((current) => keepScopedReviewItems(current, [item("a"), item("b")]));
      tick = () => setNow((value) => value + 1);
      const calendarData = useMemo(() => ({ ...bootstrap, reviewItems: [...bootstrap.reviewItems, ...scoped] }), [scoped]);
      const refreshKey = useMemo(() => ({ calendarData, delivered: 0, checkTimelineReads: 0 }), [calendarData]);
      useCalendarTimelineSnapshot({ dayKey: "2026-10-30", enabled: true, fetchTimeline, owner: "w:u", refreshKey });
      return null;
    }
    act(() => { create(<Probe />); });
    // The first read of the scoped items (one real change), then 100 store changes and a clock tick each second.
    await act(async () => { emit(); });
    const afterFirst = fetchTimeline.mock.calls.length;
    for (let second = 0; second < 300; second += 1) {
      await act(async () => {
        tick();
        if (second % 3 === 0) emit();
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(afterFirst).toBeLessThanOrEqual(2);
    expect(fetchTimeline.mock.calls.length).toBe(afterFirst);
  });

  it("the dashboard keeps the scoped items through keepScopedReviewItems", () => {
    const dashboard = readFileSync(new URL("../components/DayframeDashboard.tsx", import.meta.url), "utf8");
    const writes = dashboard.match(/setScopedReviewItems\([^\n]*/g) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) expect(write).toContain("keepScopedReviewItems(");
  });
});
