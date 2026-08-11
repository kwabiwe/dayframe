import {
  buildCalendarEntryCompactSavePlan,
  calendarEntryCompactInitialDraft,
  emptyCalendarEntryCompactDirty,
  isCompleteCalendarEntryCompactTimeInput,
  trySynchronizeCalendarEntryCompactDraft,
  type CalendarEntryCompactDirty,
  type CalendarEntryCompactDraft,
  type CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import { maskTimeInput } from "@/lib/calendar-grid";
import type { TimeEntryRow } from "@/lib/queries";

export type TimelineInlineEditField = "description" | "time";
export type TimelineInlineTimeEdge = "start" | "finish";

export type TimelineInlineEditDraft = {
  field: TimelineInlineEditField;
  draft: CalendarEntryCompactDraft;
  dirty: CalendarEntryCompactDirty;
  sourceStartedAt: string;
  sourceStoppedAt: string | null;
};

export function createTimelineInlineEditDraft(
  entry: TimeEntryRow,
  field: TimelineInlineEditField,
  displayInterval: { startedAt: string; stoppedAt: string | null } = entry
): TimelineInlineEditDraft {
  const source = field === "time"
    ? { ...entry, startedAt: displayInterval.startedAt, stoppedAt: displayInterval.stoppedAt }
    : entry;
  return {
    field,
    draft: calendarEntryCompactInitialDraft(source),
    dirty: { ...emptyCalendarEntryCompactDirty },
    sourceStartedAt: source.startedAt,
    sourceStoppedAt: source.stoppedAt
  };
}

export function updateTimelineInlineDescription(
  edit: TimelineInlineEditDraft,
  description: string
): TimelineInlineEditDraft {
  return {
    ...edit,
    draft: { ...edit.draft, description },
    dirty: { ...edit.dirty, description: true }
  };
}

export function updateTimelineInlineTime(
  edit: TimelineInlineEditDraft,
  _entry: TimeEntryRow,
  edge: TimelineInlineTimeEdge,
  rawValue: string
): TimelineInlineEditDraft {
  const timeKey = edge === "start" ? "startedAtTime" : "stoppedAtTime";
  return updateTimelineInlineTemporalEdge(edit, edge, {
    [timeKey]: maskTimeInput(rawValue)
  });
}

export function updateTimelineInlineDate(
  edit: TimelineInlineEditDraft,
  _entry: TimeEntryRow,
  edge: TimelineInlineTimeEdge,
  date: string
): TimelineInlineEditDraft {
  const dateKey = edge === "start" ? "startedAtDate" : "stoppedAtDate";
  return updateTimelineInlineTemporalEdge(edit, edge, { [dateKey]: date });
}

export function buildTimelineInlineSavePlan(
  edit: TimelineInlineEditDraft,
  entry: TimeEntryRow,
  now = new Date()
): CalendarEntryCompactSavePlan {
  if (edit.field === "time") {
    const sourceEntry: TimeEntryRow = {
      ...entry,
      startedAt: edit.sourceStartedAt,
      stoppedAt: edit.sourceStoppedAt
    };
    const sourceDraft = calendarEntryCompactInitialDraft(sourceEntry);
    const timeChanged = edit.draft.startedAtDate !== sourceDraft.startedAtDate ||
      edit.draft.startedAtTime !== sourceDraft.startedAtTime ||
      edit.draft.stoppedAtDate !== sourceDraft.stoppedAtDate ||
      edit.draft.stoppedAtTime !== sourceDraft.stoppedAtTime;
    if (!timeChanged) return unchangedTimelineInlineSavePlan(entry, now);

    const sourcePlan = buildCalendarEntryCompactSavePlan({
      draft: edit.draft,
      dirty: edit.dirty,
      entry: sourceEntry,
      now
    });
    return {
      ...sourcePlan,
      payload: {
        ...(sourcePlan.resolved.startedAt !== entry.startedAt
          ? { startedAt: sourcePlan.resolved.startedAt }
          : {}),
        ...(sourcePlan.resolved.stoppedAt && sourcePlan.resolved.stoppedAt !== entry.stoppedAt
          ? { stoppedAt: sourcePlan.resolved.stoppedAt }
          : {})
      }
    };
  }

  return buildCalendarEntryCompactSavePlan({
    draft: edit.draft,
    dirty: edit.dirty,
    entry,
    now
  });
}

function updateTimelineInlineTemporalEdge(
  edit: TimelineInlineEditDraft,
  edge: TimelineInlineTimeEdge,
  patch: Partial<Pick<CalendarEntryCompactDraft,
    "startedAtDate" | "startedAtTime" | "stoppedAtDate" | "stoppedAtTime">>
): TimelineInlineEditDraft {
  // List editing treats both displayed timestamps as fixed edges: moving
  // either edge recalculates Duration instead of moving the opposite edge.
  const owner = edit.sourceStoppedAt ? "finish" : "start";
  const nextDraft: CalendarEntryCompactDraft = {
    ...edit.draft,
    ...patch,
    temporalOwner: owner
  };
  const edgeTime = edge === "start" ? nextDraft.startedAtTime : nextDraft.stoppedAtTime;
  const edgeDate = edge === "start" ? nextDraft.startedAtDate : nextDraft.stoppedAtDate;
  const synchronized = /^\d{4}-\d{2}-\d{2}$/.test(edgeDate) && isCompleteCalendarEntryCompactTimeInput(edgeTime)
    ? trySynchronizeCalendarEntryCompactDraft({
        draft: nextDraft,
        originalStartedAt: edit.sourceStartedAt,
        originalStoppedAt: edit.sourceStoppedAt,
        owner
      })
    : null;
  const dirty = { ...edit.dirty };
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    if (key in dirty) dirty[key] = true;
  }
  return { ...edit, draft: synchronized ?? nextDraft, dirty };
}

function unchangedTimelineInlineSavePlan(entry: TimeEntryRow, now: Date): CalendarEntryCompactSavePlan {
  const stoppedAt = entry.stoppedAt;
  return {
    durationSeconds: stoppedAt
      ? Math.max(0, Math.floor((Date.parse(stoppedAt) - Date.parse(entry.startedAt)) / 1_000))
      : Math.max(0, Math.floor((now.getTime() - Date.parse(entry.startedAt)) / 1_000)),
    payload: {},
    resolved: {
      categoryId: entry.categoryId,
      description: entry.description,
      tagNames: [...entry.tagNames],
      startedAt: entry.startedAt,
      stoppedAt
    }
  };
}
