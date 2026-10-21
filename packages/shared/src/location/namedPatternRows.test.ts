import { describe, expect, it } from "vitest";
import { namedPatternRuns, type NamedPatternItem } from "./namedPatternRows";

const tag = { key: "named:stay", name: "School run" };
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
    expect(namedPatternRuns([item("back", "11:00", "11:10"), item("there", "08:00", "08:10")]).size).toBe(0);
    expect(namedPatternRuns([item("back", "10:50", "11:00"), item("there", "08:00", "08:10")]).size).toBe(2);
  });
});
