import { describe, expect, it } from "vitest";
import { inferTypedFinishDate } from "@/lib/calendar-entry-compact-editor";
import type { TimeEntryRow } from "@/lib/queries";
import {
  buildTimelineInlineSavePlan,
  createTimelineInlineEditDraft,
  updateTimelineInlineDate,
  updateTimelineInlineTime
} from "@/lib/timeline-inline-edit";

// A typed End time reads against Start's time of day, as Toggl does (owner, 21 Oct 2026).
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
