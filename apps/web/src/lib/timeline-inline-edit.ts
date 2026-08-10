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
  const key = edge === "start" ? "startedAtTime" : "stoppedAtTime";
  const owner = edge;
  const value = maskTimeInput(rawValue);
  const nextDraft: CalendarEntryCompactDraft = {
    ...edit.draft,
    [key]: value,
    temporalOwner: owner
  };
  const synchronized = isCompleteCalendarEntryCompactTimeInput(value)
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
    dirty: { ...edit.dirty, [key]: true }
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
