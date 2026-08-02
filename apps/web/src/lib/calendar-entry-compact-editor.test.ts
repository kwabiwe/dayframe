import { describe, expect, it } from "vitest";
import { dateTimeLocalInputToIso } from "@/lib/format";
import type { TimeEntryRow } from "@/lib/queries";
import {
  buildCalendarEntryCompactCreatePlan,
  buildCalendarEntryCompactSavePlan,
  calculateCalendarEditorPosition,
  calendarEditorOwnsPayloadKey,
  calendarEditorPointerIsInside,
  calendarEditorRectIsVisible,
  calendarEntryCompactCreateDraftHasChanges,
  calendarEntryCompactCreateInitialDraft,
  calendarEntryCompactDraftHasChanges,
  calendarEntryCompactInitialDraft,
  emptyCalendarEntryCompactDirty,
  type CalendarEntryCompactDirty,
  type CalendarEntryCompactDraft
} from "./calendar-entry-compact-editor";

describe("Calendar compact editor save plan", () => {
  it("builds completed and running drafts without exposing hidden metadata", () => {
    const completed = timeEntry({ stoppedAt: localIso("2026-01-03T09:20") });
    const running = timeEntry({ stoppedAt: null });

    expect(calendarEntryCompactInitialDraft(completed)).toEqual({
      categoryId: "focus",
      description: "Deep work",
      startedAt: "08:13",
      stoppedAt: "09:20"
    });
    expect(calendarEntryCompactInitialDraft(running).stoppedAt).toBe("");
    expect(Object.keys(calendarEntryCompactInitialDraft(completed))).toEqual([
      "categoryId",
      "description",
      "startedAt",
      "stoppedAt"
    ]);
  });

  it("closes as a no-op plan when nothing changed and preserves stored seconds", () => {
    const source = timeEntry();
    const draft = calendarEntryCompactInitialDraft(source);
    const plan = savePlan(source, draft, emptyCalendarEntryCompactDirty);

    expect(plan.payload).toEqual({});
    expect(plan.resolved.startedAt).toBe(source.startedAt);
    expect(plan.resolved.stoppedAt).toBe(source.stoppedAt);
    expect(calendarEntryCompactDraftHasChanges(source, draft)).toBe(false);
    expect(calendarEntryCompactDraftHasChanges(source, { ...draft, description: `${draft.description} ` })).toBe(true);
    expect(calendarEntryCompactDraftHasChanges(source, { ...draft, startedAt: "08:14" })).toBe(true);
  });

  it("emits only changed owned description and category fields, including clear-to-null", () => {
    const source = timeEntry({
      placeId: "office",
      projectId: "legacy-project",
      clientName: "Legacy client",
      tagNames: ["private"]
    });
    const plan = savePlan(
      source,
      { ...calendarEntryCompactInitialDraft(source), categoryId: "", description: "   " },
      dirty({ categoryId: true, description: true })
    );

    expect(plan.payload).toEqual({ categoryId: null, description: null });
    expect(Object.keys(plan.payload).every(calendarEditorOwnsPayloadKey)).toBe(true);
    expect(plan.payload).not.toHaveProperty("placeId");
    expect(plan.payload).not.toHaveProperty("projectId");
    expect(plan.payload).not.toHaveProperty("clientName");
    expect(plan.payload).not.toHaveProperty("tagNames");
  });

  it("normalizes an edited time to minute precision while leaving the other timestamp exact", () => {
    const source = timeEntry();
    const plan = savePlan(
      source,
      { ...calendarEntryCompactInitialDraft(source), startedAt: "8:13" },
      dirty({ startedAt: true })
    );

    expect(plan.payload).toEqual({ startedAt: localIso("2026-01-03T08:13") });
    expect(plan.resolved.stoppedAt).toBe(source.stoppedAt);
  });

  it("retains each original date when editing a cross-midnight entry", () => {
    const source = timeEntry({
      startedAt: localIso("2026-01-03T23:50", 37),
      stoppedAt: localIso("2026-01-04T00:20", 21)
    });
    const plan = savePlan(
      source,
      { ...calendarEntryCompactInitialDraft(source), startedAt: "23:45", stoppedAt: "00:30" },
      dirty({ startedAt: true, stoppedAt: true }),
      new Date(2026, 0, 5, 12)
    );

    expect(plan.payload).toEqual({
      startedAt: localIso("2026-01-03T23:45"),
      stoppedAt: localIso("2026-01-04T00:30")
    });
    expect(plan.durationSeconds).toBe(45 * 60);
  });

  it("validates malformed, future, and reversed times without mutating the draft", () => {
    const source = timeEntry();
    const malformed = { ...calendarEntryCompactInitialDraft(source), startedAt: "29:99" };
    expect(() => savePlan(source, malformed, dirty({ startedAt: true }))).toThrow("valid start time");
    expect(malformed.startedAt).toBe("29:99");

    const future = { ...calendarEntryCompactInitialDraft(source), startedAt: "23:59" };
    expect(() => savePlan(source, future, dirty({ startedAt: true }), new Date(2026, 0, 3, 10))).toThrow("future");

    const futureFinish = { ...calendarEntryCompactInitialDraft(source), stoppedAt: "23:59" };
    expect(() => savePlan(source, futureFinish, dirty({ stoppedAt: true }), new Date(2026, 0, 3, 10))).toThrow(
      "Finish time cannot be in the future."
    );

    const reversed = { ...calendarEntryCompactInitialDraft(source), stoppedAt: "07:00" };
    expect(() => savePlan(source, reversed, dirty({ stoppedAt: true }))).toThrow("after the start");
  });

  it("validates each partial timestamp combination against the canonical opposite edge", () => {
    const source = timeEntry();
    const finishOnly = savePlan(
      source,
      { ...calendarEntryCompactInitialDraft(source), stoppedAt: "09:45" },
      dirty({ stoppedAt: true })
    );
    expect(finishOnly.payload).toEqual({ stoppedAt: localIso("2026-01-03T09:45") });
    expect(finishOnly.resolved.startedAt).toBe(source.startedAt);

    const startAfterStoredFinish = { ...calendarEntryCompactInitialDraft(source), startedAt: "09:30" };
    expect(() => savePlan(source, startAfterStoredFinish, dirty({ startedAt: true }))).toThrow("after the start");

    const finishBeforeStoredStart = { ...calendarEntryCompactInitialDraft(source), stoppedAt: "08:00" };
    expect(() => savePlan(source, finishBeforeStoredStart, dirty({ stoppedAt: true }))).toThrow("after the start");
  });

  it("calculates live elapsed time from the resolved running start", () => {
    const source = timeEntry({ stoppedAt: null });
    const plan = savePlan(
      source,
      calendarEntryCompactInitialDraft(source),
      emptyCalendarEntryCompactDirty,
      new Date(2026, 0, 3, 9, 13, 42)
    );
    expect(plan.durationSeconds).toBe(3_600);
    expect(plan.resolved.stoppedAt).toBeNull();
  });
});

describe("Calendar compact editor create plan", () => {
  const source = {
    startedAt: localIso("2026-01-03T10:00"),
    stoppedAt: localIso("2026-01-03T10:30")
  };

  it("starts blank and uncategorized while remaining a valid no-edit creation", () => {
    const draft = calendarEntryCompactCreateInitialDraft(source);
    const plan = buildCalendarEntryCompactCreatePlan({ draft, source });

    expect(draft).toEqual({
      categoryId: "",
      description: "",
      startedAt: "10:00",
      stoppedAt: "10:30"
    });
    expect(calendarEntryCompactCreateDraftHasChanges(source, draft)).toBe(false);
    expect(plan).toEqual({
      durationSeconds: 1_800,
      input: {
        tagNames: [],
        startedAt: source.startedAt,
        stoppedAt: source.stoppedAt
      },
      resolved: {
        categoryId: null,
        description: null,
        startedAt: source.startedAt,
        stoppedAt: source.stoppedAt
      }
    });
  });

  it("trims owned values, omits blanks, and never leaks hidden fields", () => {
    const draft = {
      ...calendarEntryCompactCreateInitialDraft(source),
      categoryId: "focus",
      description: "  Plan release  "
    };
    const plan = buildCalendarEntryCompactCreatePlan({ draft, source });

    expect(calendarEntryCompactCreateDraftHasChanges(source, draft)).toBe(true);
    expect(plan.input).toEqual({
      categoryId: "focus",
      description: "Plan release",
      tagNames: [],
      startedAt: source.startedAt,
      stoppedAt: source.stoppedAt
    });
    expect(plan.input).not.toHaveProperty("placeId");
    expect(plan.input).not.toHaveProperty("projectId");
    expect(plan.input).not.toHaveProperty("clientId");
  });

  it("normalizes edited times on their displayed local dates", () => {
    const plan = buildCalendarEntryCompactCreatePlan({
      source,
      draft: {
        ...calendarEntryCompactCreateInitialDraft(source),
        startedAt: "10:15",
        stoppedAt: "11:05"
      }
    });
    expect(plan.resolved.startedAt).toBe(localIso("2026-01-03T10:15"));
    expect(plan.resolved.stoppedAt).toBe(localIso("2026-01-03T11:05"));
    expect(plan.durationSeconds).toBe(3_000);
  });

  it("retains next-day Finish context for a cross-midnight draft", () => {
    const crossMidnight = {
      startedAt: localIso("2026-01-03T23:45"),
      stoppedAt: localIso("2026-01-04T00:15")
    };
    const plan = buildCalendarEntryCompactCreatePlan({
      source: crossMidnight,
      draft: {
        ...calendarEntryCompactCreateInitialDraft(crossMidnight),
        startedAt: "23:30",
        stoppedAt: "00:20"
      }
    });
    expect(plan.resolved.startedAt).toBe(localIso("2026-01-03T23:30"));
    expect(plan.resolved.stoppedAt).toBe(localIso("2026-01-04T00:20"));
    expect(plan.durationSeconds).toBe(3_000);
  });

  it("rejects malformed and reversed times without mutating the draft", () => {
    const malformed = { ...calendarEntryCompactCreateInitialDraft(source), startedAt: "25:99" };
    expect(() => buildCalendarEntryCompactCreatePlan({ draft: malformed, source })).toThrow("valid start time");
    expect(malformed.startedAt).toBe("25:99");

    const reversed = { ...calendarEntryCompactCreateInitialDraft(source), stoppedAt: "09:45" };
    expect(() => buildCalendarEntryCompactCreatePlan({ draft: reversed, source })).toThrow("after the start");
  });
});

describe("Calendar compact editor portal geometry and dismissal", () => {
  const anchor = { left: 100, right: 220, top: 100, bottom: 160, width: 120, height: 60 };

  it("prefers an eight-pixel below-anchor gap and clamps the horizontal edge", () => {
    expect(calculateCalendarEditorPosition({
      anchor: { ...anchor, left: 600, right: 720 },
      panelHeight: 240,
      panelWidth: 360,
      viewportHeight: 800,
      viewportWidth: 700
    })).toEqual({ left: 328, maxHeight: 776, placement: "below", top: 168, width: 360 });
  });

  it("flips above and falls back to a twelve-pixel phone card", () => {
    expect(calculateCalendarEditorPosition({
      anchor: { ...anchor, top: 620, bottom: 680 },
      panelHeight: 240,
      panelWidth: 360,
      viewportHeight: 720,
      viewportWidth: 900
    })).toEqual({ left: 100, maxHeight: 696, placement: "above", top: 372, width: 360 });

    expect(calculateCalendarEditorPosition({
      anchor,
      panelHeight: 400,
      panelWidth: 360,
      viewportHeight: 700,
      viewportWidth: 390
    })).toEqual({ left: 12, maxHeight: 676, placement: "phone", top: 288, width: 366 });
  });

  it("clamps to the roomier side when the panel barely fits neither side", () => {
    expect(calculateCalendarEditorPosition({
      anchor: { ...anchor, top: 462, bottom: 480 },
      panelHeight: 445,
      panelWidth: 360,
      viewportHeight: 720,
      viewportWidth: 1280
    })).toEqual({ left: 100, maxHeight: 696, placement: "above", top: 12, width: 360 });
  });

  it("distinguishes anchor/panel pointer paths from outside dismissal and detects removed visibility", () => {
    const panel = {};
    const anchorNode = {};
    expect(calendarEditorPointerIsInside([panel], panel, anchorNode)).toBe(true);
    expect(calendarEditorPointerIsInside([anchorNode], panel, anchorNode)).toBe(true);
    expect(calendarEditorPointerIsInside([{}], panel, anchorNode)).toBe(false);
    expect(calendarEditorRectIsVisible(
      anchor,
      { left: 0, right: 900, top: 0, bottom: 700 },
      { left: 0, right: 500, top: 50, bottom: 500 }
    )).toBe(true);
    expect(calendarEditorRectIsVisible(
      { ...anchor, top: 900, bottom: 960 },
      { left: 0, right: 900, top: 0, bottom: 700 },
      null
    )).toBe(false);
  });
});

function savePlan(
  entry: TimeEntryRow,
  draft: CalendarEntryCompactDraft,
  dirtyState: CalendarEntryCompactDirty,
  now = new Date(2026, 0, 3, 12)
) {
  return buildCalendarEntryCompactSavePlan({ entry, draft, dirty: dirtyState, now });
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
