import {
  buildCalendarEntryCompactSavePlan,
  calendarEntryCompactInitialDraft,
  emptyCalendarEntryCompactDirty,
  enforceTypedBlockLimit,
  inferTypedFinishDate,
  isCalendarEntryCompactTimeInputReadyToSynchronize,
  isCompleteCalendarEntryCompactTimeInput,
  keepTypedMeridiemTime,
  normalizeCalendarEntryCompactTypedTimes,
  trySynchronizeCalendarEntryCompactDraft,
  type CalendarEntryCompactDirty,
  type CalendarEntryCompactDraft,
  type CalendarEntryCompactSavePlan
} from "@/lib/calendar-entry-compact-editor";
import { maskTimeInput, parseTimeInput } from "@/lib/calendar-grid";
import { dateTimeLocalInputToIsoCandidates } from "@/lib/format";
import type { TimeEntryRow } from "@/lib/queries";

export type TimelineInlineEditField = "description" | "time";
export type TimelineInlineTimeEdge = "start" | "finish";

export type TimelineInlineEditDraft = {
  field: TimelineInlineEditField;
  draft: CalendarEntryCompactDraft;
  dirty: CalendarEntryCompactDirty;
  sourceStartedAt: string;
  sourceStoppedAt: string | null;
  /** The End date was chosen in the date picker, so a typed End time no longer infers its day. */
  finishDateChosen?: boolean;
  /** The End time was typed in this edit, so a later Start re-reads its day. */
  finishTyped?: boolean;
  /** The edge edited last: only a Start edited last may carry End on commit (Codex r6 on #504). */
  lastEdge?: TimelineInlineTimeEdge;
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
  const value = maskTimeInput(rawValue);
  const ready = isCalendarEntryCompactTimeInputReadyToSynchronize(value);
  if (edge === "start") {
    // An End typed in this edit re-reads its day against the new Start (owner, 21 Oct 2026).
    const reread = edit.finishTyped && !edit.finishDateChosen && ready
      ? inferTypedFinishDate({ ...edit.draft, startedAtTime: value })
      : null;
    return updateTimelineInlineTemporalEdge({ ...edit, lastEdge: "start" }, edge, {
      startedAtTime: value,
      ...(reread && reread.stoppedAtDate !== edit.draft.stoppedAtDate ? { stoppedAtDate: reread.stoppedAtDate } : {})
    });
  }
  // A typed End reads against Start's time of day, as in the block editor (owner, 21 Oct 2026); only
  // a complete time moves the day.
  const inferred = edit.finishDateChosen || !ready ? null : inferTypedFinishDate({ ...edit.draft, stoppedAtTime: value });
  return updateTimelineInlineTemporalEdge({ ...edit, finishTyped: !edit.finishDateChosen, lastEdge: "finish" }, edge, {
    stoppedAtTime: value,
    ...(inferred && inferred.stoppedAtDate !== edit.draft.stoppedAtDate ? { stoppedAtDate: inferred.stoppedAtDate } : {})
  });
}

export function updateTimelineInlineDate(
  edit: TimelineInlineEditDraft,
  _entry: TimeEntryRow,
  edge: TimelineInlineTimeEdge,
  date: string
): TimelineInlineEditDraft {
  if (edge === "start") return updateTimelineInlineTemporalEdge({ ...edit, lastEdge: "start" }, edge, { startedAtDate: date });
  return updateTimelineInlineTemporalEdge({ ...edit, finishDateChosen: true, lastEdge: "finish" }, edge, { stoppedAtDate: date });
}

export function buildTimelineInlineSavePlan(
  typedEdit: TimelineInlineEditDraft,
  entry: TimeEntryRow,
  now = new Date()
): CalendarEntryCompactSavePlan {
  // Saving commits typed times with the shared reader (`15:1` → 15:10; owner, 15 Oct 2026).
  const normalized = normalizeCalendarEntryCompactTypedTimes(typedEdit.draft);
  // Shorthand ("21:3", "6", "23:3") reads its day, and a Start past End carries End, only once
  // committed (Codex r2/r3 on #504): the same rules as a complete time typed live.
  const inferred = typedEdit.finishTyped && !typedEdit.finishDateChosen ? inferTypedFinishDate(normalized) : normalized;
  const edit = { ...typedEdit, draft: committedInlineDraft(typedEdit, inferred) };
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

    // Typed times keep the block within 24 h unless the End date was chosen (Codex r1 on #504).
    // A running row has no End date to choose, so its live elapsed time is never limited (Codex r5).
    const typedTimes = Boolean(edit.sourceStoppedAt) && !edit.finishDateChosen && (edit.dirty.startedAtTime || edit.dirty.stoppedAtTime);
    const sourcePlan = enforceTypedBlockLimit(buildCalendarEntryCompactSavePlan({
      draft: edit.draft,
      dirty: edit.dirty,
      entry: sourceEntry,
      now
    }), typedTimes);
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

/**
 * A readable End that exists on the clock, so a Start past it may carry it; a blank, invalid or
 * skipped-hour End stays an error (Codex r4/r5 on #504).
 */
function hasReadableFinish(draft: CalendarEntryCompactDraft) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.stoppedAtDate) || !isCompleteCalendarEntryCompactTimeInput(draft.stoppedAtTime)) return false;
  const time = parseTimeInput(draft.stoppedAtTime);
  return Boolean(time) && dateTimeLocalInputToIsoCandidates(`${draft.stoppedAtDate}T${time}`).length > 0;
}

function committedInlineDraft(edit: TimelineInlineEditDraft, draft: CalendarEntryCompactDraft): CalendarEntryCompactDraft {
  if (edit.field !== "time" || !edit.sourceStoppedAt || edit.lastEdge !== "start" || !edit.dirty.startedAtTime || !hasReadableFinish(draft)) return draft;
  const source = { originalStartedAt: edit.sourceStartedAt, originalStoppedAt: edit.sourceStoppedAt };
  if (trySynchronizeCalendarEntryCompactDraft({ ...source, draft: { ...draft, temporalOwner: "finish" }, owner: "finish" })) return draft;
  return trySynchronizeCalendarEntryCompactDraft({ ...source, draft: { ...draft, temporalOwner: "start" }, owner: "start" }) ?? draft;
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
  const canSynchronize = /^\d{4}-\d{2}-\d{2}$/.test(edgeDate) && isCalendarEntryCompactTimeInputReadyToSynchronize(edgeTime);
  const fixedEdges = canSynchronize
    ? trySynchronizeCalendarEntryCompactDraft({
        draft: nextDraft,
        originalStartedAt: edit.sourceStartedAt,
        originalStoppedAt: edit.sourceStoppedAt,
        owner
      })
    : null;
  // A Start typed past End moves End forward, keeping the duration (owner, 21 Oct 2026).
  const synchronized = fixedEdges ?? (canSynchronize && edge === "start" && edit.sourceStoppedAt && hasReadableFinish(nextDraft)
    ? trySynchronizeCalendarEntryCompactDraft({
        draft: { ...nextDraft, temporalOwner: "start" },
        originalStartedAt: edit.sourceStartedAt,
        originalStoppedAt: edit.sourceStoppedAt,
        owner: "start"
      })
    : null);
  const dirty = { ...edit.dirty };
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    if (key in dirty) dirty[key] = true;
  }
  const edgeKey = edge === "start" ? "startedAtTime" : "stoppedAtTime";
  const draft = synchronized && edgeKey in patch ? keepTypedMeridiemTime(synchronized, edgeKey, edgeTime) : synchronized;
  return { ...edit, draft: draft ?? nextDraft, dirty };
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
