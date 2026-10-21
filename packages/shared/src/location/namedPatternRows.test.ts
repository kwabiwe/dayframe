import { describe, expect, it } from "vitest";
import { namedPatternBrackets, namedPatternRuns, type NamedPatternItem } from "./namedPatternRows";

const tag = { key: "named:stay", name: "School run", parts: 3 };
const item = (id: string, start: string, stop: string | null, locationGroup: NamedPatternItem["locationGroup"] = tag): NamedPatternItem =>
  ({ id, startedAt: `2026-10-20T${start}:00.000Z`, stoppedAt: stop ? `2026-10-20T${stop}:00.000Z` : null, locationGroup });

describe("named pattern rows (location v3 PR 14)", () => {
  it("joins adjacent members within three hours", () => {
    const runs = namedPatternRuns([item("back", "08:30", "08:40"), item("stay", "08:10", "08:30"), item("there", "08:00", "08:10")]);
    expect([...runs.entries()]).toEqual(["back", "stay", "there"].map((id) => [id, { key: "named:named:stay", name: "School run" }]));
  });

  it("does not join across another block, a running part, a lone member or a long span", () => {
    expect(namedPatternRuns([item("back", "08:30", "08:40"), item("other", "08:20", "08:25", null), item("stay", "08:10", "08:30")]).size).toBe(0);
    expect(namedPatternRuns([item("back", "08:30", null), item("stay", "08:10", "08:30")]).size).toBe(0);
    expect(namedPatternRuns([item("stay", "08:10", "08:30")]).size).toBe(0);
    const two = { ...tag, parts: 2 };
    expect(namedPatternRuns([item("back", "10:50", "11:00", two), item("there", "08:00", "08:10", two)]).size).toBe(2);
    expect(namedPatternRuns([item("back", "11:00", "11:10", two), item("there", "08:00", "08:10", two)]).size).toBe(0);
  });

  it("needs every part together: two of three never form the row (Codex r1 on #501)", () => {
    expect(namedPatternRuns([item("back", "08:30", "08:40"), item("other", "08:20", "08:25", null),
      item("stay", "08:10", "08:30"), item("there", "08:00", "08:10")]).size).toBe(0);
    expect(namedPatternRuns([item("back", "08:30", "08:40"), item("there", "08:00", "08:10")]).size).toBe(0);
  });
});

const at = (time: string) => Date.parse(`2026-10-20T${time}:00.000Z`);

describe("named pattern brackets on Calendar (location v3 PR 14b)", () => {
  it("spans a complete group from its first start to its last end, whatever order the blocks come in", () => {
    expect(namedPatternBrackets([item("stay", "08:10", "08:30"), item("back", "08:30", "08:40"), item("there", "08:00", "08:10")]))
      .toEqual([{ key: "named:named:stay", name: "School run", startMs: at("08:00"), endMs: at("08:40"), memberIds: ["there", "stay", "back"] }]);
  });

  it("draws nothing for a missing part, a block in between or a running part", () => {
    expect(namedPatternBrackets([item("back", "08:30", "08:40"), item("there", "08:00", "08:10")])).toEqual([]);
    expect(namedPatternBrackets([item("there", "08:00", "08:10"), item("other", "08:12", "08:20", null),
      item("stay", "08:10", "08:30"), item("back", "08:30", "08:40")])).toEqual([]);
    expect(namedPatternBrackets([item("there", "08:00", "08:10"), item("stay", "08:10", "08:30"), item("back", "08:30", null)])).toEqual([]);
  });

  it("keeps two trips apart and ignores blocks outside any group", () => {
    const later = { key: "named:pickup", name: "Pickup", parts: 2 };
    const brackets = namedPatternBrackets([
      item("there", "08:00", "08:10"), item("stay", "08:10", "08:30"), item("back", "08:30", "08:40"),
      item("work", "09:00", "12:00", null),
      item("out", "15:00", "15:10", later), item("home", "15:10", "15:20", later)
    ]);
    expect(brackets.map(({ name, memberIds }) => [name, memberIds])).toEqual([
      ["School run", ["there", "stay", "back"]],
      ["Pickup", ["out", "home"]]
    ]);
  });

  it("keeps only a trip wholly inside the day it is asked for: none across midnight", () => {
    const day = { startMs: at("00:00"), endMs: at("00:00") + 24 * 60 * 60 * 1000 };
    const trip = [item("there", "08:00", "08:10"), item("stay", "08:10", "08:30"), item("back", "08:30", "08:40")];
    expect(namedPatternBrackets(trip, day)).toHaveLength(1);
    expect(namedPatternBrackets(trip, { startMs: day.startMs, endMs: at("08:35") })).toEqual([]);
    expect(namedPatternBrackets(trip, { startMs: at("08:05"), endMs: day.endMs })).toEqual([]);
  });
});
