import { describe, expect, it } from "vitest";
import type { HistoryEntryGroup } from "./historyPresentation";
import { canDeleteGroup, canStartAgain, rowBlockHeight, rowDuration, rowMeta, rowSpokenLabel, rowTimeRange, rowTitle, todayBlocksCaption } from "./todayBlockRows";

const day = new Date(2026, 9, 7).getTime();
const at = (h: number, m = 0) => new Date(day + (h * 60 + m) * 60_000).toISOString();

function entry(id: string, start: string, stop: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    startedAt: start,
    stoppedAt: stop,
    description: "Deep work",
    categoryId: "cat-focus",
    categoryName: "Focus",
    categoryColor: "blue",
    ...extra,
  } as unknown as HistoryEntryGroup["representative"]["entry"];
}

function group(...entries: ReturnType<typeof entry>[]): HistoryEntryGroup {
  const items = entries.map((value) => ({ entry: value, overlapSeconds: 1800 }));
  return { entries: items, key: entries[0].id, representative: items[0], totalSeconds: items.length * 1800 };
}

describe("today block rows", () => {
  it("sizes the block by duration between 24 and 56 points", () => {
    expect(rowBlockHeight(0)).toBe(24);
    expect(rowBlockHeight(15 * 60)).toBe(24);
    expect(rowBlockHeight(3600)).toBe(40);
    expect(rowBlockHeight(90 * 60)).toBe(51);
    expect(rowBlockHeight(3 * 3600)).toBe(56);
  });

  it("writes the prototype's time range, with now for a running entry", () => {
    expect(rowTimeRange(entry("a", at(8, 13), at(10)), day)).toBe("08:13–10:00");
    expect(rowTimeRange(entry("b", at(9), null), day + 10 * 3_600_000)).toBe("09:00–now");
  });

  it("puts time, repeat count and activity on one line", () => {
    expect(rowMeta(group(entry("a", at(8), at(9))), day)).toBe("08:00–09:00 · Focus");
    expect(rowMeta(group(entry("a", at(8), at(9)), entry("b", at(10), at(11))), day)).toBe("08:00–09:00 · 2 entries · Focus");
    expect(rowMeta(group(entry("a", at(8), at(9), { categoryName: null, categoryId: null })), day)).toBe("08:00–09:00");
  });

  it("titles a row by description, else activity, else No activity", () => {
    expect(rowTitle(entry("a", at(8), at(9)))).toBe("Deep work");
    expect(rowTitle(entry("a", at(8), at(9), { description: "  " }))).toBe("Focus");
    expect(rowTitle(entry("a", at(8), at(9), { description: null, categoryName: null }))).toBe("No activity");
  });

  it("formats durations and the caption", () => {
    expect(rowDuration(59)).toBe("0m");
    expect(rowDuration(107 * 60)).toBe("1h 47m");
    expect(rowDuration(2 * 3600)).toBe("2h");
    expect(todayBlocksCaption([group(entry("a", at(8), at(9)), entry("b", at(10), at(11))), group(entry("c", at(12), at(13)))])).toBe("3 · swipe a row");
  });

  it("tells same-looking rows apart for VoiceOver by place and tags, reading times with 'to'", () => {
    const a = group(entry("a", at(9), at(10), { placeName: "Place A", tagNames: ["legs"] }));
    const b = group(entry("b", at(9), at(10), { placeName: "Place B" }));
    expect(rowSpokenLabel(a, day)).toBe("Deep work, 09:00 to 10:00, Focus, at Place A, tags: legs");
    expect(rowSpokenLabel(b, day)).toBe("Deep work, 09:00 to 10:00, Focus, at Place B");
    expect(rowSpokenLabel(group(entry("c", at(9), null)), day + 11 * 3_600_000)).toBe("Deep work, 09:00 to now, Focus");
    expect(rowSpokenLabel(group(entry("d", at(8), at(9)), entry("e", at(10), at(11))), day)).toBe("Deep work, 08:00 to 09:00, 2 entries, Focus");
  });

  it("does not start again a legacy placeholder description with no activity", () => {
    expect(canStartAgain(entry("p", at(8), at(9), { categoryId: null, description: "Start activity" }))).toBe(false);
  });

  it("starts again only with something to start and deletes only stopped time", () => {
    expect(canStartAgain(entry("a", at(8), at(9), { categoryId: null, description: " " }))).toBe(false);
    expect(canStartAgain(entry("a", at(8), at(9), { categoryId: null }))).toBe(true);
    expect(canDeleteGroup(group(entry("a", at(8), at(9)), entry("b", at(10), null)))).toBe(false);
    expect(canDeleteGroup(group(entry("a", at(8), at(9))))).toBe(true);
  });
});
