import { describe, expect, it } from "vitest";
import { QUICK_START_PIN_LIMIT, activitiesPageGroups, activityNameProblem, activityWeekSeconds, formatActivityWeek, pinLimitReached } from "./activitiesPage";

const activity = (id: string, name: string, extra: { icon?: string | null; isPinned?: boolean } = {}) => ({ id, name, isPinned: false, ...extra });

describe("activitiesPageGroups", () => {
  it("puts your own activities first, then groups by icon, A–Z inside each", () => {
    const groups = activitiesPageGroups([
      activity("1", "Pottery"),
      activity("2", "Gym", { icon: "gym" }),
      activity("3", "Acme project"),
      activity("4", "Work", { icon: "work" })
    ]);
    expect(groups[0].rows.map((row) => row.name)).toEqual(["Acme project", "Pottery"]);
    expect(groups.map((group) => group.title)).toContain("Body and mind");
    expect(groups.map((group) => group.title)).toContain("Work and study");
    expect(groups.every((group) => group.rows.length > 0)).toBe(true);
  });
});

describe("pinLimitReached", () => {
  const pinned = Array.from({ length: QUICK_START_PIN_LIMIT }, (_, index) => activity(`p${index}`, `P${index}`, { isPinned: true }));
  it("stops a seventh pin but never an unpin", () => {
    expect(QUICK_START_PIN_LIMIT).toBe(6);
    expect(pinLimitReached([...pinned, activity("x", "X")], "x")).toBe(true);
    expect(pinLimitReached([...pinned, activity("x", "X")], "p0")).toBe(false);
    expect(pinLimitReached([...pinned.slice(1), activity("x", "X")], "x")).toBe(false);
  });
});

describe("activityNameProblem", () => {
  const all = [activity("a", "Reading"), activity("b", "Gym")];
  it("needs a name that no other activity has, in any case", () => {
    expect(activityNameProblem(all, "  ", null)).toBe("Give the activity a name.");
    expect(activityNameProblem(all, "reading", null)).toBe("reading already exists.");
    expect(activityNameProblem(all, "Reading ", "a")).toBeNull();
    expect(activityNameProblem(all, "Piano", null)).toBeNull();
  });
});

describe("activityWeekSeconds and formatActivityWeek", () => {
  const now = Date.parse("2026-10-09T12:00:00");
  const entry = (id: string, categoryId: string, start: string, stop: string | null) => ({ id, categoryId, startedAt: start, stoppedAt: stop });
  it("counts each completed entry once across the bootstrap's lists, without moments to review", () => {
    const a = entry("e1", "c1", "2026-10-09T09:00:00", "2026-10-09T10:30:00");
    const review = entry("e2", "c1", "2026-10-08T09:00:00", "2026-10-08T10:00:00");
    const running = entry("e3", "c2", "2026-10-09T11:00:00", null);
    const totals = activityWeekSeconds([[a, review], [a], null, [running]], now, (candidate) => candidate.id === "e2");
    expect(totals.get("c1")).toBe(90 * 60);
    expect(totals.has("c2")).toBe(false);
  });

  it("says plainly how much time an activity had", () => {
    expect(formatActivityWeek(0)).toBe("Not used in the last 7 days");
    expect(formatActivityWeek(45 * 60)).toBe("45m in the last 7 days");
    expect(formatActivityWeek(2 * 3600)).toBe("2h in the last 7 days");
    expect(formatActivityWeek(2 * 3600 + 30 * 60)).toBe("2h 30m in the last 7 days");
  });
});
