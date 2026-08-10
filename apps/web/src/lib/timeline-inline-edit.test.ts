import { describe, expect, it } from "vitest";
import type { TimeEntryRow } from "@/lib/queries";
import {
  buildTimelineInlineSavePlan,
  createTimelineInlineEditDraft,
  updateTimelineInlineDate,
  updateTimelineInlineDescription,
  updateTimelineInlineTime
} from "./timeline-inline-edit";

describe("Timeline inline entry editing", () => {
  it("builds the same trimmed description patch as the full compact editor", () => {
    const entry = timeEntry();
    const edit = updateTimelineInlineDescription(
      createTimelineInlineEditDraft(entry, "description"),
      "  Planning  "
    );

    expect(buildTimelineInlineSavePlan(edit, entry, localDate("2026-08-11T00:00")).payload)
      .toEqual({ description: "Planning" });
  });

  it("keeps Finish fixed and recalculates Duration when Start changes", () => {
    const entry = timeEntry();
    const edit = updateTimelineInlineTime(
      createTimelineInlineEditDraft(entry, "time"),
      entry,
      "start",
      "08:30"
    );
    const plan = buildTimelineInlineSavePlan(edit, entry, localDate("2026-08-11T00:00"));

    expect(edit.draft.startedAtTime).toBe("08:30");
    expect(edit.draft.stoppedAtTime).toBe("10:00");
    expect(edit.draft.duration).toBe("01:30");
    expect(plan.payload).toEqual({
      startedAt: localIso("2026-08-10T08:30")
    });
  });

  it("recalculates duration when Finish owns an inline time edit", () => {
    const entry = timeEntry();
    const edit = updateTimelineInlineTime(
      createTimelineInlineEditDraft(entry, "time"),
      entry,
      "finish",
      "10:15"
    );
    const plan = buildTimelineInlineSavePlan(edit, entry, localDate("2026-08-11T00:00"));

    expect(edit.draft.stoppedAtTime).toBe("10:15");
    expect(edit.draft.duration).toBe("01:15");
    expect(plan.payload).toEqual({ stoppedAt: localIso("2026-08-10T10:15") });
  });

  it("retains an incomplete picker value and rejects it at commit time", () => {
    const entry = timeEntry();
    const edit = updateTimelineInlineTime(
      createTimelineInlineEditDraft(entry, "time"),
      entry,
      "finish",
      ""
    );

    expect(edit.draft.stoppedAtTime).toBe("");
    expect(() => buildTimelineInlineSavePlan(edit, entry, localDate("2026-08-11T00:00")))
      .toThrow("Enter a valid finish date and time.");
  });

  it("opens a clipped cross-day interval without changing its time or duration", () => {
    const entry = timeEntry({
      startedAt: localIso("2026-08-02T17:33"),
      stoppedAt: localIso("2026-08-03T17:42"),
      durationSeconds: 86_940
    });
    const edit = createTimelineInlineEditDraft(entry, "time", {
      startedAt: localIso("2026-08-02T17:33"),
      stoppedAt: localIso("2026-08-03T00:00")
    });

    expect(edit.draft.startedAtTime).toBe("17:33");
    expect(edit.draft.stoppedAtTime).toBe("00:00");
    expect(edit.draft.duration).toBe("06:27");
    expect(buildTimelineInlineSavePlan(edit, entry, localDate("2026-08-04T00:00")).payload)
      .toEqual({});
  });

  it("emits no patch after a clipped time is changed and restored", () => {
    const entry = timeEntry({
      startedAt: localIso("2026-08-02T17:33"),
      stoppedAt: localIso("2026-08-03T17:42"),
      durationSeconds: 86_940
    });
    const opened = createTimelineInlineEditDraft(entry, "time", {
      startedAt: localIso("2026-08-02T17:33"),
      stoppedAt: localIso("2026-08-03T00:00")
    });
    const changed = updateTimelineInlineTime(opened, entry, "finish", "00:15");
    const restored = updateTimelineInlineTime(changed, entry, "finish", "00:00");

    expect(buildTimelineInlineSavePlan(restored, entry, localDate("2026-08-04T00:00")).payload)
      .toEqual({});
  });

  it("updates the displayed date independently through the themed picker", () => {
    const entry = timeEntry();
    const edit = updateTimelineInlineDate(
      createTimelineInlineEditDraft(entry, "time"),
      entry,
      "finish",
      "2026-08-11"
    );

    expect(edit.draft.stoppedAtDate).toBe("2026-08-11");
    expect(edit.draft.duration).toBe("25:00");
  });
});

function timeEntry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "44444444-4444-4444-8444-444444444444",
    categoryName: "Focus",
    categoryColor: "lime",
    placeId: null,
    placeName: null,
    description: "Deep work",
    startedAt: localIso("2026-08-10T09:00"),
    stoppedAt: localIso("2026-08-10T10:00"),
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    updatedAt: localIso("2026-08-10T10:01"),
    durationSeconds: 3_600,
    tagNames: [],
    tags: [],
    ...overrides
  };
}

function localIso(value: string) {
  return localDate(value).toISOString();
}

function localDate(value: string) {
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute);
}
