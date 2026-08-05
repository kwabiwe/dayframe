import { describe, expect, it } from "vitest";
import { dateTimeLocalInputToIso } from "@/lib/format";
import type { TimeEntryRow } from "@/lib/queries";
import {
  buildCalendarEntryCompactCreatePlan,
  buildCalendarEntryCompactSavePlan,
  calculateCalendarEditorPosition,
  calendarEditorOwnsPayloadKey,
  calendarEditorRectIsVisible,
  calendarEntryCompactCreateDraftHasChanges,
  calendarEntryCompactCreateInitialDraft,
  calendarEntryCompactDraftHasChanges,
  calendarEntryCompactInitialDraft,
  calendarEntryLocalDayOffset,
  emptyCalendarEntryCompactDirty,
  isCompleteCalendarEntryCompactDurationInput,
  normalizeCalendarEntryCompactDuration,
  synchronizeCalendarEntryCompactDraft,
  type CalendarEntryCompactDirty,
  type CalendarEntryCompactDraft
} from "./calendar-entry-compact-editor";

describe("Calendar compact editor temporal model", () => {
  it("shows explicit dates, full duration, and no hidden legacy metadata", () => {
    const completed = timeEntry({ stoppedAt: localIso("2026-01-03T09:20", 19) });
    const running = timeEntry({ stoppedAt: null });

    expect(calendarEntryCompactInitialDraft(completed)).toEqual({
      categoryId: "focus",
      description: "Deep work",
      tagNames: [],
      startedAtDate: "2026-01-03",
      startedAtTime: "08:13",
      stoppedAtDate: "2026-01-03",
      stoppedAtTime: "09:20",
      duration: "01:06",
      durationSeconds: 3_997,
      temporalOwner: "source"
    });
    expect(calendarEntryCompactInitialDraft(running).stoppedAtDate).toBe("");
    expect(calendarEntryCompactInitialDraft(running).stoppedAtTime).toBe("");
  });

  it("preserves untouched exact instants and stored seconds", () => {
    const source = timeEntry();
    const draft = calendarEntryCompactInitialDraft(source);
    const plan = savePlan(source, draft);

    expect(plan.payload).toEqual({});
    expect(plan.resolved.startedAt).toBe(source.startedAt);
    expect(plan.resolved.stoppedAt).toBe(source.stoppedAt);
    expect(plan.durationSeconds).toBe(3_997);
    expect(calendarEntryCompactDraftHasChanges(source, draft)).toBe(false);
  });

  it("preserves hidden seconds for metadata-only saves and untouched sub-minute entries", () => {
    const source = timeEntry();
    const descriptionPlan = savePlan(source, {
      ...calendarEntryCompactInitialDraft(source),
      description: "Updated"
    }, undefined, dirty({ description: true }));
    const tagPlan = savePlan(source, {
      ...calendarEntryCompactInitialDraft(source),
      tagNames: ["Planning"]
    }, undefined, dirty({ tagNames: true }));
    expect(descriptionPlan.payload).toEqual({ description: "Updated" });
    expect(tagPlan.payload).toEqual({ tagNames: ["Planning"] });
    for (const plan of [descriptionPlan, tagPlan]) {
      expect(plan.resolved.startedAt).toBe(source.startedAt);
      expect(plan.resolved.stoppedAt).toBe(source.stoppedAt);
      expect(plan.durationSeconds).toBe(3_997);
    }

    const subMinute = timeEntry({
      stoppedAt: localIso("2026-01-03T08:14", 11),
      durationSeconds: 29
    });
    const subMinuteDraft = calendarEntryCompactInitialDraft(subMinute);
    expect(subMinuteDraft.duration).toBe("00:00");
    expect(savePlan(subMinute, subMinuteDraft).durationSeconds).toBe(29);
  });

  it("makes Start the owner, preserves Duration, and moves Finish", () => {
    const source = timeEntry();
    const draft = synchronize(source, {
      ...calendarEntryCompactInitialDraft(source),
      startedAtTime: "08:00"
    }, "start");
    const plan = savePlan(source, draft);

    expect(draft.stoppedAtTime).toBe("09:06");
    expect(draft.duration).toBe("01:06");
    expect(draft.durationSeconds).toBe(3_997);
    expect(plan.resolved.startedAt).toBe(localIso("2026-01-03T08:00"));
    expect(plan.resolved.stoppedAt).toBe(localIso("2026-01-03T09:06", 37));
    expect(plan.payload).toEqual({
      startedAt: localIso("2026-01-03T08:00"),
      stoppedAt: localIso("2026-01-03T09:06", 37)
    });
  });

  it("makes Finish the owner and recalculates Duration", () => {
    const source = timeEntry();
    const draft = synchronize(source, {
      ...calendarEntryCompactInitialDraft(source),
      stoppedAtTime: "10:00"
    }, "finish");
    const plan = savePlan(source, draft);

    expect(draft.duration).toBe("01:46");
    expect(draft.durationSeconds).toBe(6_378);
    expect(plan.resolved.startedAt).toBe(source.startedAt);
    expect(plan.resolved.stoppedAt).toBe(localIso("2026-01-03T10:00"));
  });

  it.each([
    ["30", "00:30", 1_800],
    ["30m", "00:30", 1_800],
    ["90", "01:30", 5_400],
    ["90m", "01:30", 5_400],
    ["1:30", "01:30", 5_400],
    ["01:30", "01:30", 5_400],
    ["1h 30m", "01:30", 5_400],
    ["1h30m", "01:30", 5_400],
    ["1:30:00", "01:30", 5_400],
    ["27:01", "27:01", 97_260]
  ])("normalizes duration shorthand %s without a 24-hour cap", (raw, normalized, seconds) => {
    expect(normalizeCalendarEntryCompactDuration(raw)).toEqual({ seconds, value: normalized });
  });

  it("waits for both clock-minute digits before live Duration synchronization", () => {
    expect(isCompleteCalendarEntryCompactDurationInput("1:2")).toBe(false);
    expect(isCompleteCalendarEntryCompactDurationInput("1:20")).toBe(true);
    expect(isCompleteCalendarEntryCompactDurationInput("1h30m")).toBe(true);
  });

  it("makes Duration the owner, keeps Start, and moves Finish across days", () => {
    const source = timeEntry();
    const draft = synchronize(source, {
      ...calendarEntryCompactInitialDraft(source),
      duration: "49:30"
    }, "duration");
    const plan = savePlan(source, draft, new Date(2026, 0, 8));

    expect(draft.duration).toBe("49:30");
    expect(draft.stoppedAtDate).toBe("2026-01-05");
    expect(draft.stoppedAtTime).toBe("09:43");
    expect(plan.resolved.startedAt).toBe(source.startedAt);
    expect(plan.durationSeconds).toBe(178_200);
  });

  it("rejects zero and malformed duration while retaining the raw draft", () => {
    const source = timeEntry();
    const draft = {
      ...calendarEntryCompactInitialDraft(source),
      duration: "0",
      temporalOwner: "duration" as const
    };
    expect(() => savePlan(source, draft)).toThrow("at least 00:01 using HH:MM");
    expect(draft.duration).toBe("0");
    expect(() => normalizeCalendarEntryCompactDuration("1:60")).toThrow("at least 00:01 using HH:MM");
    expect(() => normalizeCalendarEntryCompactDuration("1:30:29")).toThrow("at least 00:01 using HH:MM");
    expect(normalizeCalendarEntryCompactDuration("00:01")).toEqual({ seconds: 60, value: "00:01" });
  });

  it("keeps an invalid Finish input and uses the exact agreed error", () => {
    const source = timeEntry();
    const draft = {
      ...calendarEntryCompactInitialDraft(source),
      stoppedAtTime: "07:00",
      temporalOwner: "finish" as const
    };
    expect(() => savePlan(source, draft)).toThrow("Finish must be after Start");
    expect(draft.stoppedAtTime).toBe("07:00");
  });

  it("supports same-day, cross-midnight, and multi-day explicit dates", () => {
    const source = timeEntry();
    const sameDay = savePlan(source, {
      ...calendarEntryCompactInitialDraft(source),
      stoppedAtTime: "11:00",
      temporalOwner: "finish"
    });
    const crossMidnight = savePlan(source, {
      ...calendarEntryCompactInitialDraft(source),
      stoppedAtDate: "2026-01-04",
      stoppedAtTime: "00:15",
      temporalOwner: "finish"
    }, new Date(2026, 0, 5));
    const multiDay = savePlan(source, {
      ...calendarEntryCompactInitialDraft(source),
      stoppedAtDate: "2026-01-06",
      stoppedAtTime: "10:15",
      temporalOwner: "finish"
    }, new Date(2026, 0, 7));

    expect(sameDay.durationSeconds).toBe(9_978);
    expect(crossMidnight.resolved.stoppedAt).toBe(localIso("2026-01-04T00:15"));
    expect(multiDay.durationSeconds).toBeGreaterThan(72 * 3_600);
  });

  it("keeps a running timer running while Start is editable and Duration stays live", () => {
    const source = timeEntry({ stoppedAt: null });
    const initial = savePlan(source, calendarEntryCompactInitialDraft(source), new Date(2026, 0, 3, 9, 13, 42));
    const editedDraft = synchronize(source, {
      ...calendarEntryCompactInitialDraft(source),
      startedAtTime: "08:00"
    }, "start");
    const edited = savePlan(source, editedDraft, new Date(2026, 0, 3, 9, 13, 42));

    expect(initial.durationSeconds).toBe(3_600);
    expect(edited.resolved.stoppedAt).toBeNull();
    expect(edited.payload).toEqual({ startedAt: localIso("2026-01-03T08:00") });
    expect(edited.durationSeconds).toBe(4_422);
    expect(edited.payload).not.toHaveProperty("stoppedAt");
  });

  it("does not treat a live running-duration refresh as an unsaved edit", () => {
    const opened = timeEntry({ durationSeconds: 3_997, stoppedAt: null });
    const refreshed = timeEntry({ durationSeconds: 4_012, stoppedAt: null });
    const draft = calendarEntryCompactInitialDraft(opened);

    expect(calendarEntryCompactDraftHasChanges(refreshed, draft)).toBe(false);
    expect(calendarEntryCompactDraftHasChanges(refreshed, { ...draft, description: "Updated" })).toBe(true);
    expect(calendarEntryCompactDraftHasChanges(refreshed, { ...draft, description: "Deep work" })).toBe(false);
  });

  it("rejects future Start and Finish after synchronization", () => {
    const source = timeEntry();
    const now = new Date(2026, 0, 3, 10);
    expect(() => savePlan(source, {
      ...calendarEntryCompactInitialDraft(source),
      startedAtTime: "11:00",
      temporalOwner: "start"
    }, now)).toThrow("Start time cannot be in the future.");
    expect(() => savePlan(source, {
      ...calendarEntryCompactInitialDraft(source),
      stoppedAtTime: "11:00",
      temporalOwner: "finish"
    }, now)).toThrow("Finish time cannot be in the future.");
  });

  it("emits only quick-editor-owned fields and never clears hidden Place metadata", () => {
    const source = timeEntry({ placeId: "office", projectId: "legacy", tagNames: ["private"] });
    const cases = [
      savePlan(source, {
        ...calendarEntryCompactInitialDraft(source),
        description: "Updated"
      }, new Date(2026, 0, 3, 12), dirty({ description: true })),
      savePlan(source, {
        ...calendarEntryCompactInitialDraft(source),
        tagNames: ["private", "planning"]
      }, new Date(2026, 0, 3, 12), dirty({ tagNames: true })),
      savePlan(source, {
        ...calendarEntryCompactInitialDraft(source),
        categoryId: ""
      }, new Date(2026, 0, 3, 12), dirty({ categoryId: true })),
      savePlan(source, {
        ...calendarEntryCompactInitialDraft(source),
        startedAtTime: "08:00",
        temporalOwner: "start"
      }),
      savePlan(source, {
        ...calendarEntryCompactInitialDraft(source),
        duration: "02:00",
        temporalOwner: "duration"
      })
    ];

    expect(cases[0].payload).toEqual({ description: "Updated" });
    expect(cases[1].payload).toEqual({ tagNames: ["private", "planning"] });
    expect(cases[2].payload).toEqual({ categoryId: null });
    for (const plan of cases) {
      expect(plan.payload).not.toHaveProperty("placeId");
      expect(Object.keys(plan.payload).every(calendarEditorOwnsPayloadKey)).toBe(true);
    }
  });

  it("hydrates tags, detects tag dirtiness, and emits one tag-only PATCH", () => {
    const source = timeEntry({ tagNames: ["planning"] });
    const initial = calendarEntryCompactInitialDraft(source);
    const draft = { ...initial, tagNames: ["planning", "deep work"] };

    expect(initial.tagNames).toEqual(["planning"]);
    expect(calendarEntryCompactDraftHasChanges(source, initial)).toBe(false);
    expect(calendarEntryCompactDraftHasChanges(source, draft)).toBe(true);
    expect(savePlan(source, draft, undefined, dirty({ tagNames: true })).payload).toEqual({
      tagNames: ["planning", "deep work"]
    });
  });

  it("calculates same-day, next-day and multi-day local offsets without DST arithmetic", () => {
    expect(calendarEntryLocalDayOffset("2026-03-28", "2026-03-28")).toBe(0);
    expect(calendarEntryLocalDayOffset("2026-03-28", "2026-03-29")).toBe(1);
    expect(calendarEntryLocalDayOffset("2026-03-28", "2026-04-02")).toBe(5);
  });
});

describe("Calendar compact editor create plan", () => {
  it("keeps the initial click-created cross-midnight rollover exact", () => {
    const source = {
      startedAt: localIso("2026-01-03T23:45"),
      stoppedAt: localIso("2026-01-04T00:15")
    };
    const draft = calendarEntryCompactCreateInitialDraft(source);
    const plan = buildCalendarEntryCompactCreatePlan({ draft, now: new Date(2026, 0, 5), source });

    expect(draft.startedAtDate).toBe("2026-01-03");
    expect(draft.stoppedAtDate).toBe("2026-01-04");
    expect(draft.duration).toBe("00:30");
    expect(plan.resolved).toMatchObject(source);
    expect(calendarEntryCompactCreateDraftHasChanges(source, draft)).toBe(false);
  });

  it("uses the same three-way synchronization and owned create payload", () => {
    const source = {
      startedAt: localIso("2026-01-03T10:00"),
      stoppedAt: localIso("2026-01-03T10:30")
    };
    const draft = synchronizeCalendarEntryCompactDraft({
      draft: {
        ...calendarEntryCompactCreateInitialDraft(source),
        categoryId: "focus",
        description: "  Plan release  ",
        tagNames: ["planning"],
        duration: "1:30"
      },
      originalStartedAt: source.startedAt,
      originalStoppedAt: source.stoppedAt,
      owner: "duration"
    });
    const plan = buildCalendarEntryCompactCreatePlan({ draft, now: new Date(2026, 0, 4), source });

    expect(draft.duration).toBe("01:30");
    expect(plan.input).toEqual({
      categoryId: "focus",
      description: "Plan release",
      tagNames: ["planning"],
      startedAt: source.startedAt,
      stoppedAt: localIso("2026-01-03T11:30")
    });
    expect(plan.input).not.toHaveProperty("placeId");
  });
});

describe("Calendar compact editor portal geometry and dismissal", () => {
  const anchor = { left: 100, right: 220, top: 100, bottom: 160, width: 120, height: 60 };

  it("prefers an eight-pixel below-anchor gap and clamps the horizontal edge", () => {
    expect(calculateCalendarEditorPosition({
      anchor: { ...anchor, left: 600, right: 720 }, panelHeight: 240, panelWidth: 420,
      viewportHeight: 800, viewportWidth: 700
    })).toEqual({ left: 268, maxHeight: 776, placement: "below", top: 168, width: 420 });
  });

  it("flips above and falls back to a twelve-pixel phone card", () => {
    expect(calculateCalendarEditorPosition({
      anchor: { ...anchor, top: 620, bottom: 680 }, panelHeight: 240, panelWidth: 420,
      viewportHeight: 720, viewportWidth: 900
    })).toEqual({ left: 100, maxHeight: 696, placement: "above", top: 372, width: 420 });
    expect(calculateCalendarEditorPosition({
      anchor, panelHeight: 400, panelWidth: 420, viewportHeight: 700, viewportWidth: 390
    })).toEqual({ left: 12, maxHeight: 676, placement: "phone", top: 288, width: 366 });
  });

  it("detects when an anchor leaves the viewport or Calendar scroller", () => {
    expect(calendarEditorRectIsVisible(anchor, { left: 0, right: 900, top: 0, bottom: 700 }, {
      left: 0, right: 500, top: 50, bottom: 500
    })).toBe(true);
    expect(calendarEditorRectIsVisible({ ...anchor, top: 900, bottom: 960 }, {
      left: 0, right: 900, top: 0, bottom: 700
    }, null)).toBe(false);
  });
});

function savePlan(
  entry: TimeEntryRow,
  draft: CalendarEntryCompactDraft,
  now = new Date(2026, 0, 3, 12),
  dirtyState = emptyCalendarEntryCompactDirty
) {
  return buildCalendarEntryCompactSavePlan({ entry, draft, dirty: dirtyState, now });
}

function synchronize(
  entry: TimeEntryRow,
  draft: CalendarEntryCompactDraft,
  owner: "start" | "finish" | "duration"
) {
  return synchronizeCalendarEntryCompactDraft({
    draft,
    originalStartedAt: entry.startedAt,
    originalStoppedAt: entry.stoppedAt,
    owner
  });
}

function dirty(overrides: Partial<CalendarEntryCompactDirty>): CalendarEntryCompactDirty {
  return { ...emptyCalendarEntryCompactDirty, ...overrides };
}

function localIso(value: string, seconds = 0) {
  const iso = dateTimeLocalInputToIso(value);
  if (!iso) throw new Error(`Bad test date: ${value}`);
  return new Date(new Date(iso).getTime() + seconds * 1_000).toISOString();
}

function timeEntry(overrides: Partial<TimeEntryRow> = {}): TimeEntryRow {
  return {
    id: "entry-1",
    projectId: null,
    projectName: null,
    projectColor: null,
    clientName: null,
    categoryId: "focus",
    categoryName: "Focus",
    categoryColor: "coral",
    placeId: null,
    placeName: null,
    source: "manual_app",
    confidence: "high",
    reviewStatus: "confirmed",
    description: "Deep work",
    startedAt: localIso("2026-01-03T08:13", 42),
    stoppedAt: localIso("2026-01-03T09:20", 19),
    updatedAt: localIso("2026-01-03T09:21"),
    durationSeconds: 3_997,
    tagNames: [],
    tags: [],
    ...overrides
  };
}
