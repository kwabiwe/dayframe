import { describe, expect, it } from "vitest";
import { withGoalExclusions } from "@dayframe/shared";
import { buildTodayGoalFrame } from "./todayGoalFrame";
import { buildTodayWhereWent, whereWentEntranceAllowed, whereWentSpokenLabel } from "./todayWhereWent";

const day = new Date(2026, 9, 14).getTime();
const at = (h: number, m = 0) => new Date(day + (h * 60 + m) * 60_000).toISOString();
const entry = (id: string, start: string, stop: string | null, activity: string | null = "work", color: string | null = "blue") => ({
  id,
  startedAt: start,
  stoppedAt: stop,
  categoryId: activity ? `cat-${activity}` : null,
  categoryName: activity ? activity[0].toUpperCase() + activity.slice(1) : null,
  categoryColor: activity ? color : null,
});
const rows = (model: ReturnType<typeof buildTodayWhereWent>) => model?.segments.map((segment) => [segment.name, segment.duration, segment.live]);

describe("buildTodayWhereWent", () => {
  it("shares overlapping time equally, so the strip adds up to the covered hero (web #409's case)", () => {
    const entries = [entry("inbox", at(9), at(10), "admin", "steel"), entry("deep", at(9, 30), null, "work", "blue")];
    const nowMs = day + 12 * 3_600_000;
    const model = buildTodayWhereWent({ entries, nowMs });
    // Inbox 09:00–10:00 and Deep work since 09:30: 45m and 2h 15m against a 3h hero.
    expect(rows(model)).toEqual([
      ["Work", "2h 15m", true],
      ["Admin", "45m", false],
    ]);
    expect(model?.totalSeconds).toBe(buildTodayGoalFrame({ entries, goalMinutes: 480, nowMs }).totalSeconds);
    expect(model?.segments.map((segment) => segment.color)).toEqual(["blue", "steel"]);
  });

  it("includes Sleep and other activities that don't count toward the goal", () => {
    const entries = [entry("night", at(0), at(7), "sleep", "blue-bold"), entry("work", at(9), at(10))];
    const nowMs = day + 12 * 3_600_000;
    const model = buildTodayWhereWent({ entries, nowMs });
    expect(rows(model)).toEqual([
      ["Sleep", "7h", false],
      ["Work", "1h", false],
    ]);
    const frame = buildTodayGoalFrame({
      categories: withGoalExclusions([{ id: "cat-sleep", countsTowardGoal: false }], []),
      entries,
      goalMinutes: 480,
      nowMs,
    });
    expect(model?.totalSeconds).toBe(frame.totalSeconds);
    expect(frame.goalSeconds).toBe(3600);
  });

  it("shows nothing until the day holds a whole minute", () => {
    expect(buildTodayWhereWent({ entries: [], nowMs: day + 3_600_000 })).toBeNull();
    // A block started 30 s before the minute tick: the hero reads "<1m", no strip yet.
    const live = [entry("live", new Date(day + 3_600_000 - 30_000).toISOString(), null)];
    expect(buildTodayWhereWent({ entries: live, nowMs: day + 3_600_000 })).toBeNull();
    // Yesterday's blocks and future blocks don't count.
    expect(buildTodayWhereWent({ entries: [entry("y", new Date(day - 7_200_000).toISOString(), new Date(day - 3_600_000).toISOString())], nowMs: day + 3_600_000 })).toBeNull();
  });

  it("grows a lone running block per minute as one live segment", () => {
    const live = [entry("live", at(9), null)];
    const first = buildTodayWhereWent({ entries: live, nowMs: day + (9 * 60 + 1) * 60_000 });
    const later = buildTodayWhereWent({ entries: live, nowMs: day + (9 * 60 + 2) * 60_000 });
    expect(rows(first)).toEqual([["Work", "1m", true]]);
    expect(rows(later)).toEqual([["Work", "2m", true]]);
    expect(later?.accessibilityLabel).toBe("Where today went. Work, 2 minutes, recording. 2 minutes in all.");
  });

  it("keeps the top three and gathers the rest into a neutral Other, last", () => {
    const names = ["work", "coding", "meals", "admin", "walk", "learning"];
    // Each activity has its own hour-long block; work is longest.
    const entries = names.map((name, index) => entry(name, at(6 + index * 2), at(6 + index * 2, 60 - index * 5), name, name));
    const model = buildTodayWhereWent({ entries, nowMs: day + 20 * 3_600_000 });
    expect(rows(model)).toEqual([
      ["Work", "1h", false],
      ["Coding", "55m", false],
      ["Meals", "50m", false],
      ["Other", "2h", false],
    ]);
    const other = model!.segments[3];
    expect(other).toMatchObject({ key: "__other", color: null, includes: ["Admin", "Walk", "Learning"] });
    expect(model?.accessibilityLabel).toBe(
      "Where today went. Work, 1 hour. Coding, 55 minutes. Meals, 50 minutes. Other: Admin, Walk and Learning, 2 hours. 4 hours 45 minutes in all."
    );
    // Four activities: every one shown, no Other.
    expect(buildTodayWhereWent({ entries: entries.slice(0, 4), nowMs: day + 20 * 3_600_000 })?.segments.map((segment) => segment.name)).toEqual([
      "Work",
      "Coding",
      "Meals",
      "Admin",
    ]);
  });

  it("marks Other live when it holds the running activity", () => {
    const entries = [
      entry("a", at(6), at(8), "work"),
      entry("b", at(8), at(9, 30), "coding"),
      entry("c", at(9, 30), at(10, 30), "meals"),
      entry("d", at(10, 30), at(11), "admin"),
      entry("e", at(11), null, "walk"),
    ];
    const model = buildTodayWhereWent({ entries, nowMs: day + (11 * 60 + 10) * 60_000 });
    expect(model?.segments.at(-1)).toMatchObject({ name: "Other", live: true, includes: ["Admin", "Walk"] });
    expect(model?.segments.slice(0, 3).some((segment) => segment.live)).toBe(false);
    expect(model?.accessibilityLabel).toContain("Other: Admin and Walk, 40 minutes, recording.");
  });

  it("names time without an activity \"No activity\" with a neutral colour", () => {
    const model = buildTodayWhereWent({ entries: [entry("bare", at(9), at(10), null)], nowMs: day + 12 * 3_600_000 });
    expect(model?.segments).toEqual([
      { key: "none", name: "No activity", color: null, seconds: 3600, duration: "1h", live: false },
    ]);
  });

  it("uses the activity id as the colour seed when an entry has no colour, as the goal cells do", () => {
    const model = buildTodayWhereWent({
      entries: [{ id: "a", startedAt: at(9), stoppedAt: at(10), categoryId: "cat-x", categoryName: "X", categoryColor: null }],
      nowMs: day + 12 * 3_600_000,
    });
    expect(model?.segments[0].color).toBe("cat-x");
  });

  it("always adds up to the goal frame's hero, minute by minute, across random days", () => {
    let seed = 1410;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const activities = ["work", "coding", "sleep", "meals", "walk", "admin", null] as const;
    for (let run = 0; run < 300; run += 1) {
      const nowMs = day + Math.floor(random() * 24 * 60) * 60_000;
      const entries = Array.from({ length: 1 + Math.floor(random() * 10) }, (_, index) => {
        const from = day - 3 * 3_600_000 + Math.floor(random() * 28 * 3_600_000);
        const to = random() < 0.15 ? null : new Date(from + 1 + Math.floor(random() * 4 * 3_600_000)).toISOString();
        return entry(`e${index}`, new Date(from).toISOString(), to, activities[Math.floor(random() * activities.length)]);
      });
      const hero = buildTodayGoalFrame({ entries, goalMinutes: 480, nowMs }).totalSeconds;
      const model = buildTodayWhereWent({ entries, nowMs });
      if (hero < 60) {
        expect(model).toBeNull();
        continue;
      }
      expect(model?.totalSeconds).toBe(hero);
      expect(model!.segments.reduce((sum, segment) => sum + segment.seconds, 0)).toBe(hero);
      // The legend's minutes add up to the hero's minutes.
      expect(model!.segments.reduce((sum, segment) => sum + Math.floor(segment.seconds / 60), 0)).toBe(Math.floor(hero / 60));
      expect(model!.segments.length).toBeLessThanOrEqual(4);
    }
  });

  it("counts only today's part of an overnight block on a clock-change day", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      const longDay = new Date(2026, 9, 25).getTime();
      const nowMs = new Date(2026, 9, 25, 9).getTime();
      const model = buildTodayWhereWent({
        entries: [
          entry("night", new Date(longDay - 2 * 3_600_000).toISOString(), new Date(2026, 9, 25, 7).toISOString(), "sleep"),
          entry("read", new Date(2026, 9, 25, 6).toISOString(), new Date(2026, 9, 25, 8).toISOString(), "reading"),
        ],
        nowMs,
      });
      // 00:00–07:00 is 8 real hours on the day clocks go back: 7h of Sleep alone, 06:00–07:00 shared
      // (30m each), then 1h of Reading alone.
      expect(rows(model)).toEqual([
        ["Sleep", "7h 30m", false],
        ["Reading", "1h 30m", false],
      ]);
      expect(model?.totalSeconds).toBe(9 * 3600);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });
});

describe("whereWentSpokenLabel", () => {
  it("reads one sentence per segment and the total", () => {
    expect(
      whereWentSpokenLabel(
        [
          { key: "w", name: "Work", color: "blue", seconds: 4 * 3600 + 17 * 60, duration: "4h 17m", live: true },
          { key: "c", name: "Coding", color: "violet", seconds: 75 * 60, duration: "1h 15m", live: false },
        ],
        7 * 3600 + 22 * 60
      )
    ).toBe("Where today went. Work, 4 hours 17 minutes, recording. Coding, 1 hour 15 minutes. 7 hours 22 minutes in all.");
  });
});

describe("whereWentEntranceAllowed", () => {
  it("fades in only when the strip appears mid-session, never on first paint, hydration or a refresh", () => {
    expect(whereWentEntranceAllowed({ painted: false, quiet: false })).toBe(false);
    expect(whereWentEntranceAllowed({ painted: false, quiet: true })).toBe(false);
    expect(whereWentEntranceAllowed({ painted: true, quiet: true })).toBe(false);
    expect(whereWentEntranceAllowed({ painted: true, quiet: false })).toBe(true);
  });
});
