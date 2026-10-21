import { afterEach, describe, expect, it } from "vitest";
import { inferTypedFinishDate, TYPED_BLOCK_LIMIT_MESSAGE } from "@/lib/calendar-entry-compact-editor";
import type { TimeEntryRow } from "@/lib/queries";
import {
  buildTimelineInlineSavePlan,
  createTimelineInlineEditDraft,
  updateTimelineInlineDate,
  updateTimelineInlineTime
} from "@/lib/timeline-inline-edit";

// A typed End time reads against Start's time of day (owner, 21 Oct 2026).
describe("inferTypedFinishDate", () => {
  const block = { startedAtDate: "2026-08-02", startedAtTime: "21:00", stoppedAtDate: "2026-08-03", stoppedAtTime: "06:04" };

  it("keeps an End after Start's time on Start's day", () => {
    expect(inferTypedFinishDate({ ...block, stoppedAtTime: "21:30" }).stoppedAtDate).toBe("2026-08-02");
    expect(inferTypedFinishDate({ ...block, stoppedAtTime: "9:30 pm" }).stoppedAtDate).toBe("2026-08-02");
  });

  it("puts an End at or before Start's time on the next day, so typing never passes 24 h", () => {
    expect(inferTypedFinishDate({ ...block, stoppedAtDate: "2026-08-02", stoppedAtTime: "06:04" }).stoppedAtDate).toBe("2026-08-03");
    expect(inferTypedFinishDate({ ...block, stoppedAtTime: "21:00" }).stoppedAtDate).toBe("2026-08-03");
    expect(inferTypedFinishDate({ ...block, stoppedAtDate: "2026-08-09", stoppedAtTime: "06:04" }).stoppedAtDate).toBe("2026-08-03");
  });

  it("rolls over month ends and leaves unreadable input alone", () => {
    expect(inferTypedFinishDate({ ...block, startedAtDate: "2026-08-31", stoppedAtTime: "01:00" }).stoppedAtDate).toBe("2026-09-01");
    const typing = { ...block, stoppedAtTime: "2x" };
    expect(inferTypedFinishDate(typing)).toBe(typing);
  });
});

describe("Calendar › List inline End time", () => {
  const entry = {
    id: "entry-1",
    startedAt: new Date(2026, 7, 2, 21, 0).toISOString(),
    stoppedAt: new Date(2026, 7, 3, 6, 4).toISOString(),
    durationSeconds: 9 * 3600 + 4 * 60,
    description: "Night shift",
    tagNames: [],
    categoryId: null
  } as unknown as TimeEntryRow;
  const now = new Date(2026, 7, 4, 12);

  it("saves 21:30 typed over a 21:00 → 06:04 (+1) block as 30m the same day", () => {
    const edit = updateTimelineInlineTime(createTimelineInlineEditDraft(entry, "time"), entry, "finish", "21:30");
    expect(edit.draft.stoppedAtDate).toBe("2026-08-02");
    expect(edit.draft.duration).toBe("30m");
    expect(buildTimelineInlineSavePlan(edit, entry, now).payload).toEqual({ stoppedAt: new Date(2026, 7, 2, 21, 30).toISOString() });
  });

  it("lets an End date chosen in the picker win over the typed time", () => {
    const picked = updateTimelineInlineDate(createTimelineInlineEditDraft(entry, "time"), entry, "finish", "2026-08-03");
    const edit = updateTimelineInlineTime(picked, entry, "finish", "21:30");
    expect(edit.draft.stoppedAtDate).toBe("2026-08-03");
    expect(edit.draft.duration).toBe("24h 30m");
  });
});

describe("typed edits stay within 24 h (Codex r1 on #504)", () => {
  const originalTimeZone = process.env.TZ;
  afterEach(() => {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  });

  function block(startedAt: Date, stoppedAt: Date) {
    return {
      id: "entry-1",
      startedAt: startedAt.toISOString(),
      stoppedAt: stoppedAt.toISOString(),
      durationSeconds: (stoppedAt.getTime() - startedAt.getTime()) / 1000,
      description: "Night shift",
      tagNames: [],
      categoryId: null
    } as unknown as TimeEntryRow;
  }

  it("refuses a typed next-day End that the clocks going back make longer than 24 h", () => {
    process.env.TZ = "Europe/London";
    const entry = block(new Date(2025, 9, 25, 21, 0), new Date(2025, 9, 25, 22, 0));
    const edit = updateTimelineInlineTime(createTimelineInlineEditDraft(entry, "time"), entry, "finish", "20:30");
    expect(edit.draft.stoppedAtDate).toBe("2025-10-26");
    expect(() => buildTimelineInlineSavePlan(edit, entry, new Date(2025, 9, 28))).toThrow(TYPED_BLOCK_LIMIT_MESSAGE);
    // The date picker lifts the limit.
    const picked = updateTimelineInlineDate(edit, entry, "finish", "2025-10-26");
    expect(buildTimelineInlineSavePlan(picked, entry, new Date(2025, 9, 28)).resolved.stoppedAt).toBe(new Date(2025, 9, 26, 20, 30).toISOString());
  });

  it("moves End with a List Start typed past it, keeping the duration", () => {
    const entry = block(new Date(2026, 7, 2, 21, 0), new Date(2026, 7, 2, 22, 0));
    const edit = updateTimelineInlineTime(createTimelineInlineEditDraft(entry, "time"), entry, "start", "23:30");
    expect(edit.draft.stoppedAtDate).toBe("2026-08-03");
    expect(edit.draft.stoppedAtTime).toBe("00:30");
    expect(edit.draft.duration).toBe("1h");
  });

  it("re-reads a typed End's day when Start then moves, so End 20:00 then Start 19:00 is 1h, not 25h", () => {
    const entry = block(new Date(2026, 7, 2, 21, 0), new Date(2026, 7, 2, 22, 0));
    const typedEnd = updateTimelineInlineTime(createTimelineInlineEditDraft(entry, "time"), entry, "finish", "20:00");
    expect(typedEnd.draft.stoppedAtDate).toBe("2026-08-03");
    const edit = updateTimelineInlineTime(typedEnd, entry, "start", "19:00");
    expect(edit.draft.stoppedAtDate).toBe("2026-08-02");
    expect(edit.draft.duration).toBe("1h");
  });

  it("refuses a typed Start that leaves an untouched overnight End more than 24 h away", () => {
    const entry = block(new Date(2026, 7, 2, 21, 0), new Date(2026, 7, 3, 6, 4));
    const edit = updateTimelineInlineTime(createTimelineInlineEditDraft(entry, "time"), entry, "start", "05:00");
    expect(() => buildTimelineInlineSavePlan(edit, entry, new Date(2026, 7, 4))).toThrow(TYPED_BLOCK_LIMIT_MESSAGE);
  });

  it("moves no day while an End is half typed", () => {
    const entry = block(new Date(2026, 7, 2, 21, 0), new Date(2026, 7, 3, 6, 4));
    const edit = updateTimelineInlineTime(createTimelineInlineEditDraft(entry, "time"), entry, "finish", "21:3");
    expect(edit.draft.stoppedAtDate).toBe("2026-08-03");
  });

  it("reads a committed shorthand End's day on save (Codex r2 on #504)", () => {
    const overnight = block(new Date(2026, 7, 2, 21, 0), new Date(2026, 7, 3, 6, 4));
    const halfTyped = updateTimelineInlineTime(createTimelineInlineEditDraft(overnight, "time"), overnight, "finish", "21:3");
    expect(buildTimelineInlineSavePlan(halfTyped, overnight, new Date(2026, 7, 4)).payload).toEqual({ stoppedAt: new Date(2026, 7, 2, 21, 30).toISOString() });

    const hour = block(new Date(2026, 7, 2, 21, 0), new Date(2026, 7, 2, 22, 0));
    const six = updateTimelineInlineTime(createTimelineInlineEditDraft(hour, "time"), hour, "finish", "6");
    expect(buildTimelineInlineSavePlan(six, hour, new Date(2026, 7, 4)).payload).toEqual({ stoppedAt: new Date(2026, 7, 3, 6, 0).toISOString() });
  });

  it("carries End with a committed shorthand Start past it (Codex r3 on #504)", () => {
    const hour = block(new Date(2026, 7, 2, 21, 0), new Date(2026, 7, 2, 22, 0));
    const edit = updateTimelineInlineTime(createTimelineInlineEditDraft(hour, "time"), hour, "start", "23:3");
    expect(buildTimelineInlineSavePlan(edit, hour, new Date(2026, 7, 4)).payload).toEqual({
      startedAt: new Date(2026, 7, 2, 23, 30).toISOString(),
      stoppedAt: new Date(2026, 7, 3, 0, 30).toISOString()
    });
  });

  it("never lets a Start carry a blank or unreadable End (Codex r4 on #504)", () => {
    const hour = block(new Date(2026, 7, 2, 21, 0), new Date(2026, 7, 2, 22, 0));
    for (const end of ["", "99:99"]) {
      const start = updateTimelineInlineTime(createTimelineInlineEditDraft(hour, "time"), hour, "start", "21:3");
      const edit = updateTimelineInlineTime(start, hour, "finish", end);
      expect(() => buildTimelineInlineSavePlan(edit, hour, new Date(2026, 7, 4)), end || "blank").toThrow();
    }
  });

  it("keeps a skipped-hour End an error rather than carrying it (Codex r5 on #504)", () => {
    process.env.TZ = "Europe/London";
    const early = block(new Date(2026, 2, 29, 0, 0), new Date(2026, 2, 29, 0, 30));
    const start = updateTimelineInlineTime(createTimelineInlineEditDraft(early, "time"), early, "start", "00:1");
    const edit = updateTimelineInlineTime(start, early, "finish", "01:30");
    expect(() => buildTimelineInlineSavePlan(edit, early, new Date(2026, 2, 30))).toThrow();
  });

  it("never limits a running row's elapsed time (Codex r5 on #504)", () => {
    const running = { ...block(new Date(2026, 7, 3, 9, 0), new Date(2026, 7, 3, 10, 0)), stoppedAt: null } as unknown as TimeEntryRow;
    const edit = updateTimelineInlineTime(createTimelineInlineEditDraft(running, "time"), running, "start", "09:30");
    expect(buildTimelineInlineSavePlan(edit, running, new Date(2026, 7, 4, 12)).payload).toEqual({ startedAt: new Date(2026, 7, 3, 9, 30).toISOString() });
  });

  it("lets a later End choice stand: a reversed End after a Start edit stays an error (Codex r6 on #504)", () => {
    const hour = block(new Date(2026, 7, 2, 21, 0), new Date(2026, 7, 2, 22, 0));
    const start = updateTimelineInlineTime(createTimelineInlineEditDraft(hour, "time"), hour, "start", "21:30");
    const picked = updateTimelineInlineDate(start, hour, "finish", "2026-08-02");
    const edit = updateTimelineInlineTime(picked, hour, "finish", "20:00");
    expect(() => buildTimelineInlineSavePlan(edit, hour, new Date(2026, 7, 4))).toThrow();
  });
});
