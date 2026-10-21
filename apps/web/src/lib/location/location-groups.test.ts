import { describe, expect, it, vi } from "vitest";
import {
  getLocationGroups,
  groupNamedPatterns,
  sameEnd,
  withLocationGroups,
  type LocationGroupBlock,
  type StayEnd
} from "./location-groups";

const session = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "provider" as const,
  scopes: ["app:read"]
};
const at = (minutes: number) => Date.parse("2026-10-20T08:00:00.000Z") + minutes * 60_000;
const home: StayEnd = { placeId: "place-home", learnedPlaceId: null, latitude: 10, longitude: 20 };

function chain(overrides: { name?: string | null; backMinutes?: number } = {}): LocationGroupBlock[] {
  const back = overrides.backMinutes ?? 40;
  return [
    { id: "there", kind: "move", startedAtMs: at(0), stoppedAtMs: at(10), covers: [], fromStay: "home-before", toStay: "school", name: null },
    { id: "stay", kind: "stay", startedAtMs: at(10), stoppedAtMs: at(back - 10), covers: ["school"], fromStay: null, toStay: null,
      name: overrides.name === undefined ? "School run" : overrides.name },
    { id: "back", kind: "move", startedAtMs: at(back - 10), stoppedAtMs: at(back), covers: [], fromStay: "school", toStay: "home-after", name: null }
  ];
}
const ends = (map: Record<string, StayEnd>) => (segmentId: string) => map[segmentId] ?? null;

describe("named patterns on Today (location v3 PR 14)", () => {
  it("groups a Move into a named Stay and the Move back to the same place", () => {
    const groups = groupNamedPatterns(chain(), ends({ "home-before": home, "home-after": home }));
    expect([...groups.keys()].sort()).toEqual(["back", "stay", "there"]);
    expect(groups.get("there")).toEqual({ key: "named:stay", name: "School run", parts: 3 });
  });

  it("leaves an unnamed pattern, a trip that ends somewhere else, or one over three hours alone", () => {
    expect(groupNamedPatterns(chain({ name: null }), ends({ "home-before": home, "home-after": home })).size).toBe(0);
    expect(groupNamedPatterns(chain(), ends({ "home-before": home, "home-after": { ...home, placeId: "place-work" } })).size).toBe(0);
    expect(groupNamedPatterns(chain({ backMinutes: 181 }), ends({ "home-before": home, "home-after": home })).size).toBe(0);
    expect(groupNamedPatterns(chain({ backMinutes: 180 }), ends({ "home-before": home, "home-after": home })).size).toBe(3);
  });

  it("needs both Moves, logged, and one of each (an ambiguous chain does not group)", () => {
    const [there, stay, back] = chain();
    expect(groupNamedPatterns([there, stay], ends({ "home-before": home, "home-after": home })).size).toBe(0);
    expect(groupNamedPatterns([there, stay, back, { ...back, id: "back-2" }], ends({ "home-before": home, "home-after": home })).size).toBe(0);
  });

  it("groups a Stay corrected in Review: a split's two parts, or a merge standing for both stays (Codex r1 on #501)", () => {
    const [there, stay, back] = chain();
    const left = { ...stay, id: "left", stoppedAtMs: at(20), covers: ["school-left", "school"] };
    const right = { ...stay, id: "right", startedAtMs: at(20), covers: ["school-right", "school"], name: null };
    const split = groupNamedPatterns([there, left, right, back], ends({ "home-before": home, "home-after": home }));
    expect([...split.keys()].sort()).toEqual(["back", "left", "right", "there"]);
    expect(split.get("right")).toEqual({ key: "named:left", name: "School run", parts: 4 });
    // A merge of the stop with a second stop before the drive back: the Moves name either original.
    const merged = { ...stay, id: "merged", covers: ["school-merge", "school", "shop"] };
    const out = { ...back, fromStay: "shop" };
    expect(groupNamedPatterns([there, merged, out], ends({ "home-before": home, "home-after": home })).get("merged"))
      .toEqual({ key: "named:merged", name: "School run", parts: 3 });
  });

  it("leaves a split trip ungrouped while one of its parts is missing, never as a smaller group (Codex r2 on #501)", () => {
    const [there, stay, back] = chain();
    const left = { ...stay, id: "left", stoppedAtMs: at(20), covers: ["school-left", "school"] };
    const right = { ...stay, id: "right", startedAtMs: at(20), covers: ["school-right", "school"], name: null };
    const homeEnds = ends({ "home-before": home, "home-after": home });
    // Either half deleted (or never logged): the remaining blocks no longer meet.
    expect(groupNamedPatterns([there, left, back], homeEnds).size).toBe(0);
    expect(groupNamedPatterns([there, right, back], homeEnds).size).toBe(0);
    // A three-way split missing its middle part.
    const first = { ...left, stoppedAtMs: at(15) };
    const last = { ...right, startedAtMs: at(25) };
    expect(groupNamedPatterns([there, first, last, back], homeEnds).size).toBe(0);
    expect(groupNamedPatterns([there, first, { ...stay, id: "middle", startedAtMs: at(15), stoppedAtMs: at(25), covers: ["school-mid", "school"], name: null }, last, back], homeEnds).get("middle"))
      .toEqual({ key: "named:left", name: "School run", parts: 5 });
  });

  it("treats unsaved ends within 150 m as one place, and a saved end never as an unsaved one", () => {
    const unsaved = { placeId: null, learnedPlaceId: null, latitude: 10, longitude: 20 };
    expect(sameEnd(unsaved, { ...unsaved, latitude: 10.001 })).toBe(true); // about 111 m
    expect(sameEnd(unsaved, { ...unsaved, latitude: 10.002 })).toBe(false); // about 222 m
    expect(sameEnd(home, { ...home, placeId: null })).toBe(false);
    expect(sameEnd({ ...unsaved, learnedPlaceId: "l1" }, { ...unsaved, learnedPlaceId: "l1", latitude: 11 })).toBe(true);
    expect(sameEnd(null, home)).toBe(false);
  });

  it("tags only the members", () => {
    const groups = groupNamedPatterns(chain(), ends({ "home-before": home, "home-after": home }));
    expect(withLocationGroups([{ id: "stay" }, { id: "other" }], groups)).toEqual([
      { id: "stay", locationGroup: { key: "named:stay", name: "School run", parts: 3 } },
      { id: "other" }
    ]);
  });

  it("reads the blocks' events, the most used name and the Moves' ends, one query at a time", async () => {
    let active = 0;
    let most = 0;
    const query = vi.fn(async (sql: string, _values?: unknown[]) => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (sql.includes("from time_entries te")) {
        return { rows: [
          { id: "there", eventType: "commute_detected", segmentId: "m1", correctedSegmentId: null, fromStay: "home-before", toStay: "school", patternKey: "k-m1" },
          { id: "stay", eventType: "unknown_stay", segmentId: null, correctedSegmentId: "70000000-0000-4000-8000-000000000099", fromStay: null, toStay: null, patternKey: "k-school" },
          { id: "back", eventType: "commute_detected", segmentId: "m2", correctedSegmentId: null, fromStay: "school", toStay: "home-after", patternKey: "k-m2" }
        ] };
      }
      if (sql.includes("from location_name_patterns")) {
        // The database picks the most used name per pattern (distinct on … order by uses desc).
        expect(sql).toContain("order by pattern_key, uses desc, last_used_at desc nulls last, band");
        return { rows: [{ patternKey: "k-school", name: "School run" }] };
      }
      // A Stay corrected in Review stands for the stay it came from (Codex r1 on #501).
      if (sql.includes("with recursive lineage")) return { rows: [{ id: "70000000-0000-4000-8000-000000000099", covers: ["school-left", "school"] }] };
      if (sql.includes("from stay_segments")) {
        return { rows: [
          { segmentId: "home-before", placeId: "place-home", learnedPlaceId: null, latitude: 10, longitude: 20 },
          { segmentId: "home-after", placeId: "place-home", learnedPlaceId: null, latitude: 10, longitude: 20 }
        ] };
      }
      return { rows: [] };
    });
    const entry = (id: string, start: number, stop: number) => ({
      id, source: "location_learning", startedAt: new Date(at(start)).toISOString(), stoppedAt: new Date(at(stop)).toISOString()
    });
    const groups = await getLocationGroups({ query } as never, session,
      [entry("there", 0, 10), entry("stay", 10, 30), entry("back", 30, 40), { ...entry("manual", 50, 60), source: "manual_app" }]);
    expect(groups.get("stay")).toEqual({ key: "named:stay", name: "School run", parts: 3 });
    expect(groups.has("manual")).toBe(false);
    expect(most).toBe(1);
    // Only location blocks are read.
    expect(query.mock.calls[0][1]).toEqual([session.workspaceId, session.userId, ["there", "stay", "back"]]);
  });

  it("reads nothing without location blocks", async () => {
    const query = vi.fn();
    const groups = await getLocationGroups({ query } as never, session,
      [{ id: "manual", source: "manual_app", startedAt: new Date(at(0)).toISOString(), stoppedAt: new Date(at(5)).toISOString() }]);
    expect(groups.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
