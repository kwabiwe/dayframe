import { afterEach, describe, expect, it } from "vitest";
import { entryLastStopDay, latestEntryLastStop } from "./entryLastStop";

const originalTimeZone = process.env.TZ;
afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

const entry = (id: string, stoppedAt: string) => ({ id, stoppedAt });

describe("Last stop on the selected Start date", () => {
  it("bounds the real local day across both DST changes", () => {
    process.env.TZ = "Europe/London";
    expect(entryLastStopDay(Date.parse("2026-10-25T12:00:00Z"))).toEqual({
      fromMs: Date.parse("2026-10-24T23:00:00Z"), throughMs: Date.parse("2026-10-25T23:59:59.999Z")
    });
    expect(entryLastStopDay(Date.parse("2026-03-29T12:00:00Z"))).toEqual({
      fromMs: Date.parse("2026-03-29T00:00:00Z"), throughMs: Date.parse("2026-03-29T22:59:59.999Z")
    });
  });

  it("takes the latest eligible stop, including a block that began the previous day", () => {
    process.env.TZ = "Europe/London";
    const startMs = Date.parse("2026-10-25T04:00:00Z");
    const day = entryLastStopDay(startMs)!;
    const crossMidnight = { ...entry("overnight", "2026-10-24T23:45:00Z"), startedAt: "2026-10-24T22:30:00Z" };
    const window = { ...day, throughMs: startMs, endMs: Date.parse("2026-10-25T05:00:00Z"), excludedIds: new Set(["same-block", "locally-deleted"]) };
    expect(latestEntryLastStop([
      crossMidnight,
      entry("after-start", "2026-10-25T04:30:00Z"),
      entry("same-block", "2026-10-25T03:00:00Z"),
      entry("locally-deleted", "2026-10-25T02:00:00Z"),
      entry("yesterday", "2026-10-24T22:55:00Z")
    ], window)).toEqual(crossMidnight);
    expect(latestEntryLastStop([entry("yesterday", "2026-10-24T22:55:00Z")], window)).toBeNull();
  });

  it("keeps the draft inside the existing duration limits", () => {
    const startMs = Date.parse("2026-10-24T17:00:00Z");
    const day = entryLastStopDay(startMs)!;
    const candidate = entry("earlier", "2026-10-24T14:00:00Z");
    const window = { ...day, throughMs: startMs, endMs: Date.parse("2026-10-25T16:00:00Z"), excludedIds: new Set<string>() };
    expect(latestEntryLastStop([candidate], window)).toBeNull();
    expect(latestEntryLastStop([candidate], { ...window, endMs: Number.NaN })).toBeNull();
  });
});
