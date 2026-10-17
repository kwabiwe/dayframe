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
    expect(edit.draft.duration).toBe("1h 30m");
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
    expect(edit.draft.duration).toBe("1h 15m");
    expect(plan.payload).toEqual({ stoppedAt: localIso("2026-08-10T10:15") });
  });

  it.each([
    ["12h", "9:45 PM", "21:45"],
    ["24h", "9:45 PM", "21:45"],
    ["12h", "10:15 PM", "22:15"],
    ["12h", "1015pm", "22:15"],
    ["24h", "10:15 PM", "22:15"]
  ] as const)("keeps a typed PM while it is typed key by key in %s mode: %s (Codex r1/r2 on #446)", (_clock, typed, saved) => {
    const entry = timeEntry({ stoppedAt: localIso("2026-08-10T23:00") });
    let edit = updateTimelineInlineTime(createTimelineInlineEditDraft(entry, "time"), entry, "finish", "");
    // While typing, the field shows the draft's own text (EntriesTable): each key is that text plus
    // the new character, and the field holds at most 8 characters.
    for (const key of typed) {
      const shown = edit.draft.stoppedAtTime;
      expect(shown.length).toBeLessThan(8);
      edit = updateTimelineInlineTime(edit, entry, "finish", shown + key);
    }
    const plan = buildTimelineInlineSavePlan(edit, entry, localDate("2026-08-11T00:00"));
    expect(plan.payload).toEqual({ stoppedAt: localIso(`2026-08-10T${saved}`) });
  });

  it("clears a typed 12-hour time key by key with Backspace (Codex r2 on #446)", () => {
    const entry = timeEntry();
    let edit = updateTimelineInlineTime(createTimelineInlineEditDraft(entry, "time"), entry, "finish", "8:15 pm");
    for (let index = 0; index < 12; index += 1) {
      edit = updateTimelineInlineTime(edit, entry, "finish", edit.draft.stoppedAtTime.slice(0, -1));
    }
    expect(edit.draft.stoppedAtTime).toBe("");
  });

  it("does not insert a colon mid-entry before four compact digits are complete", () => {
    const entry = timeEntry();
    const partial = updateTimelineInlineTime(
      createTimelineInlineEditDraft(entry, "time"),
      entry,
      "finish",
      "102"
    );
    const complete = updateTimelineInlineTime(partial, entry, "finish", "1025");

    expect(partial.draft.stoppedAtTime).toBe("102");
    expect(complete.draft.stoppedAtTime).toBe("10:25");
    expect(buildTimelineInlineSavePlan(complete, entry, localDate("2026-08-11T00:00")).payload)
      .toEqual({ stoppedAt: localIso("2026-08-10T10:25") });
  });

  it("waits on a partial colon time while typing and saves its minute as tens (owner, 15 Oct 2026)", () => {
    const entry = timeEntry();
    const partial = updateTimelineInlineTime(
      createTimelineInlineEditDraft(entry, "time"),
      entry,
      "finish",
      "09:4"
    );

    // Not synchronised while typing: Duration still reflects the saved block.
    expect(partial.draft.stoppedAtTime).toBe("09:4");
    expect(partial.draft.duration).toBe("1h");
    // Saving reads it as 09:40, never 00:94 or 09:04.
    expect(buildTimelineInlineSavePlan(partial, entry, localDate("2026-08-11T00:00")).payload)
      .toEqual({ stoppedAt: localIso("2026-08-10T09:40") });
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
    expect(edit.draft.duration).toBe("6h 27m");
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
    expect(edit.draft.duration).toBe("25h");
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
