import { act, create } from "react-test-renderer";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LocationTimeline } from "@dayframe/shared";
import { useCalendarTimelineSnapshot } from "../../lib/useCalendarTimeline";
import { useCheckLinks, useCompletedLoadCount } from "./useCheckLinks";

vi.mock("react", async () => {
  // @ts-expect-error Renderer peer lives at the repository root.
  return import("../../../../../node_modules/react/index.js");
});

const ID = "30000000-0000-4000-8000-000000000001";
const OWNER = { backendId: "b", workspaceId: "w", userId: "u" };
const timelineFor = (dayKey: string, withTarget: boolean) => ({
  date: dayKey, timeZone: "UTC", dayStart: `${dayKey}T00:00:00.000Z`, dayEnd: `${dayKey}T23:59:59.999Z`, gaps: [], openTrip: null,
  items: withTarget ? [{ id: "seg-target" }] : []
}) as unknown as LocationTimeline;

describe("a named \"?\" waits for completed loads only (Codex r5 on #615)", () => {
  it("opens it on the second completed load of its day; the day switch's empty render spends nothing", async () => {
    const responses: Array<{ dayKey: string; resolve: (timeline: LocationTimeline) => void }> = [];
    const fetchTimeline = vi.fn((dayKey: string) => new Promise<LocationTimeline>((resolve) => { responses.push({ dayKey, resolve }); }));
    const openCheck = vi.fn((id: string, _dayKey?: string) => false);
    const result: { open: (check: string) => void; refresh: () => void } = { open: () => undefined, refresh: () => undefined };
    const bootstrap = { id: "bootstrap" };
    function Harness() {
      const [day, setDay] = useState("2026-10-29");
      const [refreshKey, setRefreshKey] = useState(0);
      const { timeline, requestedAt } = useCalendarTimelineSnapshot({ dayKey: day, enabled: true, fetchTimeline, owner: "o", refreshKey });
      const loads = useCompletedLoadCount(bootstrap, requestedAt);
      // The List has the "?" once its day's places include its segment.
      const has = Boolean(timeline?.items.some((item) => item.id === "seg-target"));
      openCheck.mockImplementation((id) => id === ID && has);
      result.open = useCheckLinks({
        ready: true, owner: OWNER, todayKey: "2026-10-29", selectedDayKey: day, loads,
        openCheck: (id, dayKey) => openCheck(id, dayKey), openDay: setDay, openTodayFirst: vi.fn(),
        lookupItem: async () => ({ startedAt: "2026-10-27T09:00:00.000Z", asks: true }), dayKeyOf: (instant) => instant.slice(0, 10)
      });
      result.refresh = () => setRefreshKey((key) => key + 1);
      return null;
    }
    act(() => { create(<Harness />); });
    // Today's places land: a completed load before the link.
    await act(async () => { responses.shift()!.resolve(timelineFor("2026-10-29", false)); });
    act(() => result.open(ID));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // The link's day is shown (its places reset to null while they load: no load counted).
    await vi.waitFor(() => expect(responses.at(-1)?.dayKey).toBe("2026-10-27"));
    // First completed load of that day: the item isn't there yet.
    await act(async () => { responses.shift()!.resolve(timelineFor("2026-10-27", false)); });
    expect(openCheck.mock.results.some((each) => each.value === true)).toBe(false);
    // Second completed load brings it: it opens, by its id, on its day.
    act(() => result.refresh());
    await act(async () => { responses.shift()!.resolve(timelineFor("2026-10-27", true)); });
    expect(openCheck).toHaveBeenLastCalledWith(ID, "2026-10-27");
    expect(openCheck.mock.results.at(-1)?.value).toBe(true);
  });
});
