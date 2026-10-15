import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mergeTimeEntryDialLocalDateTime } from "./timeEntryDurationDial";
import { draftInstantMs, previousEndStillHolds } from "./previousEndChip";

const offer = (startedAt: string) => ({ previousId: "prev", previousName: "Write report", startedAt });

describe("previousEndStillHolds (PRD D16, Codex r1/r2 on #419)", () => {
  const presented = offer("2026-10-14T09:15:00.000Z");
  const runStart = "2026-10-14T09:40:00.000Z";
  const holds = (current: ReturnType<typeof offer> | null, currentEntryStartedAt: string | null, shown = presented) =>
    previousEndStillHolds({ current, currentEntryStartedAt, presented: shown, presentedEntryStartedAt: runStart });
  it("holds only for the same end of the same running block", () => {
    expect(holds(offer(presented.startedAt), runStart)).toBe(true);
    // The same block after its optimistic id became the server's: same start, still holds.
    expect(holds(offer(presented.startedAt), "2026-10-14T09:40:00Z")).toBe(true);
    // The previous block now ends later (refresh, another device, a reconciled queued Stop).
    expect(holds(offer("2026-10-14T09:30:00.000Z"), runStart)).toBe(false);
    // No offer any more, or a different running block.
    expect(holds(null, runStart)).toBe(false);
    expect(holds(offer(presented.startedAt), "2026-10-14T09:50:00.000Z")).toBe(false);
    expect(previousEndStillHolds({ current: offer(presented.startedAt), currentEntryStartedAt: runStart, presented: null, presentedEntryStartedAt: null })).toBe(false);
  });
});

describe("draftInstantMs in the repeated hour (Codex r1/r2 on #419)", () => {
  const zone = process.env.TZ;
  beforeEach(() => { process.env.TZ = "Europe/London"; });
  afterEach(() => { process.env.TZ = zone; });

  const pad = (value: number) => String(value).padStart(2, "0");
  const formatDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const formatTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const instant = (draftMs: number, dateText: string, timeText: string) => draftInstantMs({
    dateText,
    draftMs,
    formatDate,
    formatTime,
    parse: () => mergeTimeEntryDialLocalDateTime({ baseTimestampMs: draftMs, dateText, timeText }).timestampMs,
    timeText
  });

  it("keeps the second 01:15 on 25 Oct 2026 instead of re-parsing it to the first", () => {
    // 01:15:45 GMT is the second 01:15 that night (the clocks went back at 02:00 BST).
    const second = Date.parse("2026-10-25T01:15:45.123Z");
    expect(formatTime(new Date(second))).toBe("01:15");
    // Parsing the fields alone picks the first 01:15 (BST), an hour earlier: the bug.
    expect(mergeTimeEntryDialLocalDateTime({ baseTimestampMs: second, dateText: "2026-10-25", timeText: "01:15" }).timestampMs)
      .toBe(Date.parse("2026-10-25T00:15:45.123Z"));
    expect(instant(second, "2026-10-25", "01:15")).toBe(second);
  });

  it("keeps a finished block in the second 01:00 hour whole, start and end (Codex r2 on #419)", () => {
    const start = Date.parse("2026-10-25T01:15:00.000Z");
    const end = Date.parse("2026-10-25T01:45:00.000Z");
    expect(instant(start, "2026-10-25", "01:15")).toBe(start);
    expect(instant(end, "2026-10-25", "01:45")).toBe(end);
    expect(instant(end, "2026-10-25", "01:45")! - instant(start, "2026-10-25", "01:15")!).toBe(30 * 60 * 1000);
  });

  it("parses the fields once they show another time, and keeps seconds on ordinary days", () => {
    const base = Date.parse("2026-10-14T09:15:30.000Z");
    expect(instant(base, "2026-10-14", "10:15")).toBe(base);
    expect(instant(base, "2026-10-14", "10:40")).toBe(Date.parse("2026-10-14T09:40:30.000Z"));
    expect(instant(0, "2026-10-14", "10:40")).toBe(new Date(2026, 9, 14, 10, 40, 0).getTime());
  });
});
