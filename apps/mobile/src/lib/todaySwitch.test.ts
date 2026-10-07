import { describe, expect, it } from "vitest";
import type { MobileTimeEntry } from "./api";
import { LIVE_SWIPE_COMMIT, liveSwipeOffset, liveSwipeRawFor, switchRecentMeta, switchRecents } from "./todaySwitch";

function entry(id: string, overrides: Partial<MobileTimeEntry> = {}): MobileTimeEntry {
  return {
    categoryId: "work",
    categoryName: "Work",
    clientName: null,
    confidence: "high",
    description: "Deep work",
    durationSeconds: 3600,
    id,
    placeName: null,
    projectColor: null,
    projectId: null,
    projectName: null,
    reviewStatus: "confirmed",
    source: "manual_app",
    startedAt: "2026-10-07T08:00:00",
    stoppedAt: "2026-10-07T09:00:00",
    ...overrides,
  };
}

describe("live block swipe", () => {
  it("follows the finger left, never right, and rubber-bands past the commit point", () => {
    expect(liveSwipeOffset(30)).toBe(0);
    expect(liveSwipeOffset(-40)).toBe(-40);
    expect(liveSwipeOffset(-LIVE_SWIPE_COMMIT)).toBe(-90);
    expect(liveSwipeOffset(-190)).toBeCloseTo(-125);
  });

  it("re-grabs a card from the raw pull it shows, so the band applies once", () => {
    for (const raw of [0, -40, -90, -140, -260]) expect(liveSwipeRawFor(liveSwipeOffset(raw))).toBeCloseTo(raw);
    // Shown at -125 (a -190 pull), a further 8-point pull moves it 2.8 points, not back toward home.
    expect(liveSwipeOffset(liveSwipeRawFor(-125) - 8)).toBeCloseTo(-127.8);
  });
});

describe("switchRecents", () => {
  it("lists finished blocks with a description, newest first, one per activity and description", () => {
    const recents = switchRecents([
      entry("old", { stoppedAt: "2026-10-05T09:00:00" }),
      entry("new", { stoppedAt: "2026-10-07T09:00:00" }),
      entry("other-activity", { categoryId: "learn", categoryName: "Learning", stoppedAt: "2026-10-06T09:00:00" }),
      entry("case", { description: "  deep WORK ", stoppedAt: "2026-10-04T09:00:00" }),
      entry("blank", { description: "  ", stoppedAt: "2026-10-07T10:00:00" }),
      entry("placeholder", { description: "Start activity", stoppedAt: "2026-10-07T10:00:00" }),
      entry("running", { stoppedAt: null }),
    ], null);
    expect(recents.map((recent) => recent.entry.id)).toEqual(["new", "other-activity"]);
    expect(recents[0].title).toBe("Deep work");
  });

  it("leaves out what is recording now and stops at six", () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      entry(`e${index}`, { description: `Task ${index}`, stoppedAt: `2026-10-0${index + 1}T09:00:00` })
    );
    const recents = switchRecents(many, { categoryId: "x", description: "task 8", id: "live" });
    expect(recents.map((recent) => recent.entry.id)).toEqual(["e7", "e6", "e5", "e4", "e3", "e2"]);
  });
});

describe("switchRecentMeta", () => {
  it("names the activity and when it was last done", () => {
    const now = new Date("2026-10-07T21:00:00").getTime();
    expect(switchRecentMeta({ categoryName: "Work", startedAt: "2026-10-07T08:00:00" }, now)).toBe("Work · today");
    expect(switchRecentMeta({ categoryName: "Work", startedAt: "2026-10-06T23:30:00" }, now)).toBe("Work · yesterday");
    expect(switchRecentMeta({ categoryName: null, startedAt: "2026-10-03T08:00:00" }, now)).toBe("No activity · last Sat 3");
  });
});
