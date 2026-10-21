import { describe, expect, it } from "vitest";
import { endFollowingStart, inferEndOnStartDay } from "./entryEndInference";

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 7, day, hours, minutes).getTime();

describe("entry sheet End inference (owner, 21 Oct 2026)", () => {
  it("reads 21:30 over a 21:00 → 06:04 (+1) block as 30m the same day", () => {
    expect(inferEndOnStartDay(at(2, 21), at(3, 21, 30))).toBe(at(2, 21, 30));
  });

  it("puts an End at or before Start's time on the next day, never further", () => {
    expect(inferEndOnStartDay(at(2, 21), at(2, 6, 4))).toBe(at(3, 6, 4));
    expect(inferEndOnStartDay(at(2, 21), at(2, 21))).toBe(at(3, 21));
    expect(inferEndOnStartDay(at(2, 21), at(9, 6, 4))).toBe(at(3, 6, 4));
    expect(inferEndOnStartDay(new Date(2026, 7, 31, 23).getTime(), new Date(2026, 7, 31, 1).getTime())).toBe(new Date(2026, 8, 1, 1).getTime());
  });

  it("moves End with a Start moved past it, keeping the duration", () => {
    expect(endFollowingStart(at(2, 21), at(2, 22), at(2, 23, 30))).toBe(at(3, 0, 30));
    expect(endFollowingStart(at(2, 21), at(2, 22), at(2, 21, 30))).toBeNull();
  });
});

describe("the entry sheet uses it (contract)", () => {
  it("infers the End wheel's day unless the date sheet chose it, and carries End with a later Start", async () => {
    const { readFileSync } = await import("node:fs");
    const sheet = readFileSync(new URL("../components/ActiveTimerEditSheet.tsx", import.meta.url), "utf8");
    expect(sheet).toContain("const endMs = endDateChosenRef.current ? valueMs : inferEndOnStartDay(startMs, valueMs);");
    expect(sheet).toContain("endFollowingStart(startMs, parsedStop.date?.getTime() ?? draftEndMs, valueMs)");
    expect(sheet.match(/endDateChosenRef\.current = (true|false);/g)).toEqual(["endDateChosenRef.current = false;", "endDateChosenRef.current = true;"]);
  });
});
