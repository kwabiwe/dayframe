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
import type { TimeEntryRow } from "@/lib/queries";

export type TimelineInlineEditField = "description" | "time";
export type TimelineInlineTimeEdge = "start" | "finish";

export type TimelineInlineEditDraft = {
  field: TimelineInlineEditField;
  draft: CalendarEntryCompactDraft;
  dirty: CalendarEntryCompactDirty;
};

export function createTimelineInlineEditDraft(
  entry: TimeEntryRow,
  field: TimelineInlineEditField
): TimelineInlineEditDraft {
  return {
    field,
    draft: calendarEntryCompactInitialDraft(entry),
    dirty: { ...emptyCalendarEntryCompactDirty }
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
  entry: TimeEntryRow,
  edge: TimelineInlineTimeEdge,
  rawValue: string
): TimelineInlineEditDraft {
  const [date = "", time = ""] = rawValue.split("T");
  const dateKey = edge === "start" ? "startedAtDate" : "stoppedAtDate";
  const timeKey = edge === "start" ? "startedAtTime" : "stoppedAtTime";
  // Inline List editing treats both timestamps as fixed edges: moving either
  // edge recalculates Duration instead of moving the opposite edge.
  const owner = entry.stoppedAt ? "finish" : "start";
  const nextDraft: CalendarEntryCompactDraft = {
    ...edit.draft,
    [dateKey]: date,
    [timeKey]: time,
    temporalOwner: owner
  };
  const synchronized = /^\d{4}-\d{2}-\d{2}$/.test(date) && isCompleteCalendarEntryCompactTimeInput(time)
    ? trySynchronizeCalendarEntryCompactDraft({
        draft: nextDraft,
        originalStartedAt: entry.startedAt,
        originalStoppedAt: entry.stoppedAt,
        owner
      })
    : null;

  return {
    ...edit,
    draft: synchronized ?? nextDraft,
    dirty: { ...edit.dirty, [dateKey]: true, [timeKey]: true }
  };
}

export function buildTimelineInlineSavePlan(
  edit: TimelineInlineEditDraft,
  entry: TimeEntryRow,
  now = new Date()
): CalendarEntryCompactSavePlan {
  return buildCalendarEntryCompactSavePlan({
    draft: edit.draft,
    dirty: edit.dirty,
    entry,
    now
  });
}
