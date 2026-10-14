import { describe, expect, it } from "vitest";
import {
  COVERED_ACTIVITY_OTHER_KEY,
  coveredActivityBars,
  coveredActivityTotals,
  type CoveredActivityEntry,
  type CoveredActivityTotal
} from "./coveredActivityTotals";

// The fixtures below are web #409's (`apps/web/src/lib/today-view.test.ts`, "Where today went
// (covered, overlaps shared)"), so web and iPhone are held to the same numbers. Local wall-clock
// times, so the tests hold in any time zone.
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const iso = (day: number, hour: number, minute = 0) => new Date(at(day, hour, minute)).toISOString();

function entry(id: string, from: string, to: string | null, categoryId: string | null = "focus"): CoveredActivityEntry {
  return {
    id,
    startedAt: from,
    stoppedAt: to,
    categoryId,
    categoryName: categoryId ? categoryId[0].toUpperCase() + categoryId.slice(1) : null,
    categoryColor: categoryId ? "mint" : null
  };
}

const day = at(10, 0);
const nextDay = at(11, 0);
const named = (totals: CoveredActivityTotal[]) => totals.map((total) => [total.name, total.seconds]);
const sum = (totals: CoveredActivityTotal[]) => totals.reduce((total, item) => total + item.seconds, 0);

/** The hero: the union of every clipped block, floored to seconds (web `buildGoalFrame().totalSeconds`). */
function heroSeconds(entries: readonly CoveredActivityEntry[], startMs: number, endMs: number, nowMs: number) {
  const clips = entries
    .map((item) => ({
      from: Math.max(Date.parse(item.startedAt), startMs),
      to: Math.min(item.stoppedAt ? Date.parse(item.stoppedAt) : nowMs, endMs, nowMs)
    }))
    .filter((clip) => clip.to > clip.from)
    .sort((a, b) => a.from - b.from);
  let covered = 0;
  let until = Number.NEGATIVE_INFINITY;
  for (const clip of clips) {
    covered += Math.max(0, clip.to - Math.max(clip.from, until));
    until = Math.max(until, clip.to);
  }
  return Math.floor(covered / 1000);
}

function bruteForceShares(entries: readonly CoveredActivityEntry[], startMs: number, endMs: number, nowMs: number) {
  const clips = entries.flatMap((item) => {
    const from = Math.max(Date.parse(item.startedAt), startMs);
    const to = Math.min(item.stoppedAt ? Date.parse(item.stoppedAt) : nowMs, endMs, nowMs);
    return to > from ? [{ key: item.categoryId ?? "none", from, to }] : [];
  });
  const points = [...new Set(clips.flatMap((clip) => [clip.from, clip.to]))].sort((a, b) => a - b);
  const shares = new Map<string, number>();
  for (let index = 1; index < points.length; index += 1) {
    const keys = new Set(clips.filter((clip) => clip.from <= points[index - 1] && clip.to >= points[index]).map((clip) => clip.key));
    for (const key of keys) shares.set(key, (shares.get(key) ?? 0) + (points[index] - points[index - 1]) / keys.size);
  }
  return shares;
}

describe("coveredActivityTotals (web #409 parity)", () => {
  it("adds up to the covered hero when two activities overlap", () => {
    const now = at(10, 13);
    const entries = [entry("a", iso(10, 9), iso(10, 11)), entry("b", iso(10, 10), iso(10, 12), "admin")];
    expect(heroSeconds(entries, day, nextDay, now)).toBe(3 * 3600);
    // Shared 10:00–11:00 is split: 1h 30m each.
    expect(named(coveredActivityTotals(entries, day, nextDay, now))).toEqual([
      ["Admin", 5400],
      ["Focus", 5400]
    ]);
    expect(sum(coveredActivityTotals(entries, day, nextDay, now))).toBe(3 * 3600);
  });

  it("splits a shared slice equally among two and three activities running in it", () => {
    const now = at(10, 18);
    const totals = coveredActivityTotals(
      [
        entry("a", iso(10, 9), iso(10, 12)),
        entry("b", iso(10, 10), iso(10, 12), "admin"),
        entry("c", iso(10, 11), iso(10, 12), null)
      ],
      day,
      nextDay,
      now
    );
    // 09–10 Focus alone; 10–11 Focus + Admin (30m each); 11–12 all three (20m each).
    expect(named(totals)).toEqual([
      ["Focus", 3600 + 1800 + 1200],
      ["Admin", 1800 + 1200],
      ["No activity", 1200]
    ]);
    expect(totals[2]).toMatchObject({ key: "none", categoryId: null, color: null });
    expect(sum(totals)).toBe(3 * 3600);
  });

  it("counts two overlapping blocks of the same activity once", () => {
    const now = at(10, 18);
    const totals = coveredActivityTotals(
      [entry("a", iso(10, 9), iso(10, 11)), entry("b", iso(10, 10), iso(10, 12)), entry("c", iso(10, 10, 30), iso(10, 11), "admin")],
      day,
      nextDay,
      now
    );
    // Focus covers 09–12; Admin shares 10:30–11:00 with Focus only (two Focus blocks count as one).
    expect(named(totals)).toEqual([
      ["Focus", 3 * 3600 - 900],
      ["Admin", 900]
    ]);
  });

  it("runs a running block to now", () => {
    const now = at(10, 12, 30);
    const entries = [entry("a", iso(10, 9), iso(10, 11), "admin"), entry("live", iso(10, 10), null)];
    const totals = coveredActivityTotals(entries, day, nextDay, now);
    expect(named(totals)).toEqual([
      ["Focus", 1800 + 5400],
      ["Admin", 3600 + 1800]
    ]);
    expect(sum(totals)).toBe(heroSeconds(entries, day, nextDay, now));
  });

  it("clips blocks to local midnight", () => {
    const now = at(10, 2);
    const entries = [entry("night", iso(9, 22), iso(10, 1)), entry("late", iso(9, 23), iso(10, 0, 30), "admin")];
    // Only 00:00–01:00 is today: 00:00–00:30 shared, then Focus alone.
    expect(named(coveredActivityTotals(entries, day, nextDay, now))).toEqual([
      ["Focus", 900 + 1800],
      ["Admin", 900]
    ]);
  });

  it("rounds to the hero's whole minutes, so the displayed bars add up to the displayed hero", () => {
    const now = at(10, 18);
    const focusEnd = new Date(at(10, 10, 30) + 40_000).toISOString();
    const adminEnd = new Date(at(10, 11, 30) + 30_000).toISOString();
    const entries = [entry("a", iso(10, 9), focusEnd), entry("b", iso(10, 11), adminEnd, "admin")];
    // Exactly 1h 30m 40s and 30m 30s: floored bars would read 1h 30m + 30m against a 2h 1m hero.
    const totals = coveredActivityTotals(entries, day, nextDay, now);
    expect(named(totals)).toEqual([
      ["Focus", 91 * 60],
      ["Admin", 30 * 60 + 10]
    ]);
    expect(sum(totals)).toBe(heroSeconds(entries, day, nextDay, now));
  });

  it("names an activity without a name \"No activity\" and keeps its colour", () => {
    const totals = coveredActivityTotals(
      [{ id: "a", startedAt: iso(10, 9), stoppedAt: iso(10, 10), categoryId: "x", categoryName: "  ", categoryColor: "sky" }],
      day,
      nextDay,
      at(10, 12)
    );
    expect(totals).toEqual([{ key: "x", categoryId: "x", name: "No activity", color: "sky", seconds: 3600 }]);
  });

  it("ignores future, zero-length and unreadable blocks", () => {
    const totals = coveredActivityTotals(
      [entry("future", iso(10, 14), iso(10, 15)), entry("zero", iso(10, 8), iso(10, 8)), { ...entry("bad", "nope", null) }],
      day,
      nextDay,
      at(10, 12)
    );
    expect(totals).toEqual([]);
  });

  it("always sums to the hero across random days", () => {
    let seed = 20261014;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const activities = ["focus", "admin", "sleep", "gym", "reading", "cooking", "commute", "music", "family", "errands", "study", null] as const;
    let otherDays = 0;
    for (let run = 0; run < 400; run += 1) {
      const now = at(10, 0) + Math.floor(random() * 24 * 3_600_000);
      const dayStart = new Date(now);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const entries: CoveredActivityEntry[] = [];
      const count = 1 + Math.floor(random() * 16);
      for (let index = 0; index < count; index += 1) {
        // Some start yesterday, some run past now, some are still running; times to the millisecond.
        const from = dayStart.getTime() - 3 * 3_600_000 + Math.floor(random() * 30 * 3_600_000);
        const to = random() < 0.15 ? null : from + 1 + Math.floor(random() * 4 * 3_600_000);
        const activity = activities[Math.floor(random() * activities.length)];
        entries.push(entry(`e${index}`, new Date(from).toISOString(), to === null ? null : new Date(to).toISOString(), activity));
      }
      const totals = coveredActivityTotals(entries, dayStart.getTime(), dayEnd.getTime(), now);
      const hero = heroSeconds(entries, dayStart.getTime(), dayEnd.getTime(), now);
      expect(sum(totals)).toBe(hero);
      for (const limit of [4, 5]) {
        const bars = coveredActivityBars(totals, limit);
        expect(sum(bars)).toBe(hero);
        expect(bars.length).toBe(Math.min(totals.length, limit));
        if (totals.length > limit) {
          expect(bars[limit - 1].key).toBe(COVERED_ACTIVITY_OTHER_KEY);
          expect(bars[limit - 1].includes).toEqual(totals.slice(limit - 1).map((total) => total.name));
        } else {
          expect(bars).toEqual(totals);
        }
      }
      if (totals.length > 4) otherDays += 1;
      expect(totals.reduce((minutes, item) => minutes + Math.floor(item.seconds / 60), 0)).toBe(Math.floor(hero / 60));
      // Each bucket stays near its exact equal-split share (brute force over every boundary).
      const exact = bruteForceShares(entries, dayStart.getTime(), dayEnd.getTime(), now);
      for (const total of totals) expect(Math.abs(total.seconds - exact.get(total.key)! / 1000)).toBeLessThan(120);
      for (const [key, ms] of exact) if (ms >= 120_000) expect(totals.some((total) => total.key === key)).toBe(true);
      for (let index = 1; index < totals.length; index += 1) {
        const [before, after] = [totals[index - 1], totals[index]];
        expect(before.seconds > after.seconds || (before.seconds === after.seconds && before.name.localeCompare(after.name) <= 0)).toBe(true);
      }
    }
    expect(otherDays).toBeGreaterThan(50);
  });
});

describe("coveredActivityBars", () => {
  const now = at(10, 18);

  it("keeps the top four and gathers the rest into a neutral Other bar, last, at web's limit of five (#409)", () => {
    for (const count of [6, 10]) {
      const names = ["focus", "admin", "sleep", "gym", "reading", "cooking", "commute", "music", "family", "errands"].slice(0, count);
      // Every activity runs 09:00–10:00 together, plus one more lone minute each so the order is fixed.
      const entries = names.flatMap((name, index) => [
        entry(`${name}-shared`, iso(10, 9), iso(10, 10), name),
        entry(`${name}-own`, iso(10, 11, index * 2), iso(10, 11, index * 2 + count - index), name)
      ]);
      const totals = coveredActivityTotals(entries, day, nextDay, now);
      const bars = coveredActivityBars(totals, 5);
      expect(totals).toHaveLength(count);
      expect(bars).toHaveLength(5);
      expect(bars.slice(0, 4)).toEqual(totals.slice(0, 4));
      expect(bars[4]).toMatchObject({ key: "__other", name: "Other", categoryId: null, color: null });
      expect(bars[4].includes).toEqual(totals.slice(4).map((total) => total.name));
      expect(sum(bars)).toBe(heroSeconds(entries, day, nextDay, now));
    }
  });

  it("keeps the top three and Other at iPhone's limit of four, and every activity at four or fewer", () => {
    // Six activities all 09:00–10:00: 10m each against a 1h hero (#409's six-activity case).
    const six = coveredActivityTotals(
      ["focus", "admin", "sleep", "gym", "reading", "cooking"].map((name) => entry(name, iso(10, 9), iso(10, 10), name)),
      day,
      nextDay,
      now
    );
    expect(six.map((total) => total.seconds)).toEqual([600, 600, 600, 600, 600, 600]);
    const bars = coveredActivityBars(six, 4);
    expect(bars.map((bar) => [bar.name, bar.seconds])).toEqual([
      ["Admin", 600],
      ["Cooking", 600],
      ["Focus", 600],
      ["Other", 1800]
    ]);
    expect(bars[3].includes).toEqual(["Gym", "Reading", "Sleep"]);
    const four = six.slice(0, 4);
    expect(coveredActivityBars(four, 4)).toEqual(four);
    expect(coveredActivityBars([], 4)).toEqual([]);
  });
});
