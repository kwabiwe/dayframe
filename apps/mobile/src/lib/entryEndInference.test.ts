import { afterEach, describe, expect, it } from "vitest";
import { endAfterStartMove, endFollowingStart, inferEndOnStartDay } from "./entryEndInference";

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 7, day, hours, minutes).getTime();

describe("entry sheet End inference (owner, 21 Oct 2026)", () => {
  const originalTimeZone = process.env.TZ;
  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  it("reads 21:30 over a 21:00 → 06:04 (+1) block as 30m the same day", () => {
    expect(inferEndOnStartDay(at(2, 21), at(3, 21, 30))).toBe(at(2, 21, 30));
  });

  it("puts an End at or before Start's time on the next day, never further", () => {
    expect(inferEndOnStartDay(at(2, 21), at(2, 6, 4))).toBe(at(3, 6, 4));
    expect(inferEndOnStartDay(at(2, 21), at(2, 21))).toBe(at(3, 21));
    expect(inferEndOnStartDay(at(2, 21), at(9, 6, 4))).toBe(at(3, 6, 4));
    expect(inferEndOnStartDay(new Date(2026, 7, 31, 23).getTime(), new Date(2026, 7, 31, 1).getTime())).toBe(new Date(2026, 8, 1, 1).getTime());
  });

  it("keeps the repeated hour's chosen occurrence when the clocks go back (Codex r1 on #506)", () => {
    process.env.TZ = "Europe/London";
    const startGmt = Date.parse("2026-10-25T01:30:00Z"); // 01:30 GMT, the second 01:30
    const endGmt = Date.parse("2026-10-25T01:45:00Z"); // 01:45 GMT
    expect(inferEndOnStartDay(startGmt, endGmt)).toBe(endGmt);
    const startBst = Date.parse("2026-10-25T00:30:00Z"); // 01:30 BST, the first 01:30
    expect(inferEndOnStartDay(startBst, endGmt)).toBe(endGmt);
    // An End from another day rebuilt into the repeated hour takes the occurrence after Start (Codex r2).
    const nextDay0135 = Date.parse("2026-10-26T01:35:00Z");
    expect(inferEndOnStartDay(startGmt, nextDay0135)).toBe(Date.parse("2026-10-25T01:35:00Z"));
  });

  it("finds the later occurrence when the clocks go back half an hour (Codex r3 on #506)", () => {
    process.env.TZ = "Australia/Lord_Howe";
    const start = Date.parse("2026-04-04T15:10:00Z"); // 5 Apr 01:40 +10:30, the second 01:40
    const fromNextDay = Date.parse("2026-04-05T15:15:00Z"); // 6 Apr 01:45 +10:30
    expect(inferEndOnStartDay(start, fromNextDay)).toBe(Date.parse("2026-04-04T15:15:00Z")); // 5 Apr 01:45 +10:30
  });

  it("moves End with a Start moved past it, keeping the duration", () => {
    expect(endFollowingStart(at(2, 21), at(2, 22), at(2, 23, 30))).toBe(at(3, 0, 30));
    expect(endFollowingStart(at(2, 21), at(2, 22), at(2, 21, 30))).toBeNull();
  });

  it("re-reads End's day when Start moves earlier, so wheeling never passes 24 h (Codex r1 on #506)", () => {
    // 20 Aug 23:00 → 21 Aug 01:00, Start wheeled back to 20 Aug 00:00: End becomes 20 Aug 01:00 (1h), not 25h.
    expect(endAfterStartMove({ endDateChosen: false, nextStartMs: at(20, 0), previousEndMs: at(21, 1), previousStartMs: at(20, 23) })).toBe(at(20, 1));
    // A chosen End date stays put (Save's 24 h limit still applies).
    expect(endAfterStartMove({ endDateChosen: true, nextStartMs: at(20, 0), previousEndMs: at(21, 1), previousStartMs: at(20, 23) })).toBe(at(21, 1));
    // An overnight End that still reads the same is unchanged.
    expect(endAfterStartMove({ endDateChosen: false, nextStartMs: at(2, 22), previousEndMs: at(3, 6, 4), previousStartMs: at(2, 21) })).toBe(at(3, 6, 4));
    // Past End: End follows, keeping the duration.
    expect(endAfterStartMove({ endDateChosen: true, nextStartMs: at(2, 23), previousEndMs: at(2, 22), previousStartMs: at(2, 21) })).toBe(at(3, 0));
  });
});

describe("the entry sheet uses it (contract)", () => {
  it("infers the End wheel's day unless the date sheet chose it, carries End with Start, and reads the latest interval", async () => {
    const { readFileSync } = await import("node:fs");
    const sheet = readFileSync(new URL("../components/ActiveTimerEditSheet.tsx", import.meta.url), "utf8");
    expect(sheet).toContain("const endMs = endDateChosenRef.current ? valueMs : inferEndOnStartDay(latest.startMs, valueMs);");
    expect(sheet).toContain("endAfterStartMove({");
    expect(sheet).toContain("const latest = cardIntervalRef.current ?? {");
    // Every End-date confirmation locks the day, the same-day one too; each sheet load unlocks it.
    expect(sheet.match(/endDateChosenRef\.current = (true|false);/g)).toEqual([
      "endDateChosenRef.current = false;",
      "endDateChosenRef.current = true;",
      "endDateChosenRef.current = true;"
    ]);
    // A time the wheel did not show re-aims the native wheel after the batch renders.
    expect(sheet).toContain("!== formatTimeInput(new Date(valueMs))) pendingEndReaimRef.current = true;");
    expect(sheet).toMatch(/useLayoutEffect\(\(\) => \{\s*cardIntervalRef\.current = null;\s*if \(!pendingEndReaimRef\.current\) return;\s*pendingEndReaimRef\.current = false;\s*bumpTimeWheelRevision\(\);/);
  });
});
