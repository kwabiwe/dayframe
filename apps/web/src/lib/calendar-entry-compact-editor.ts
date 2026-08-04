import { parseTimeInput } from "@/lib/calendar-grid";
import { dateTimeLocal, dateTimeLocalInputToIsoCandidates } from "@/lib/format";
import type { TimeEntryRow } from "@/lib/queries";

export type CalendarEntryCompactTemporalOwner = "source" | "start" | "finish" | "duration";

export type CalendarEntryCompactDraft = {
  categoryId: string;
  description: string;
  tagNames: string[];
  startedAtDate: string;
  startedAtTime: string;
  stoppedAtDate: string;
  stoppedAtTime: string;
  duration: string;
  temporalOwner: CalendarEntryCompactTemporalOwner;
};

export type CalendarEntryCompactEditableKey = Exclude<keyof CalendarEntryCompactDraft, "temporalOwner">;
export type CalendarEntryCompactDirty = Record<CalendarEntryCompactEditableKey, boolean>;

export type CalendarEntryCompactPatch = {
  categoryId?: string | null;
  description?: string | null;
  tagNames?: string[];
  startedAt?: string;
  stoppedAt?: string;
};

export type CalendarEntryCompactSavePlan = {
  durationSeconds: number;
  payload: CalendarEntryCompactPatch;
  resolved: {
    categoryId: string | null;
    description: string | null;
    tagNames: string[];
    startedAt: string;
    stoppedAt: string | null;
  };
};

export type CalendarEntryCompactCreateSource = {
  startedAt: string;
  stoppedAt: string;
};

export type CalendarEntryCompactCreatePlan = {
  durationSeconds: number;
  input: {
    categoryId?: string;
    description?: string;
    tagNames: string[];
    startedAt: string;
    stoppedAt: string;
  };
  resolved: {
    categoryId: string | null;
    description: string | null;
    tagNames: string[];
    startedAt: string;
    stoppedAt: string;
  };
};

export type CalendarEditorRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

export type CalendarEditorPosition = {
  left: number;
  maxHeight: number;
  placement: "above" | "below" | "phone";
  top: number;
  width: number;
};

export const emptyCalendarEntryCompactDirty: CalendarEntryCompactDirty = {
  categoryId: false,
  description: false,
  tagNames: false,
  startedAtDate: false,
  startedAtTime: false,
  stoppedAtDate: false,
  stoppedAtTime: false,
  duration: false
};

export function calendarEntryCompactInitialDraft(entry: TimeEntryRow): CalendarEntryCompactDraft {
  return initialDraft({
    categoryId: entry.categoryId ?? "",
    description: entry.description ?? "",
    tagNames: entry.tagNames,
    durationSeconds: entry.stoppedAt
      ? elapsedSeconds(entry.startedAt, entry.stoppedAt)
      : Math.max(0, entry.durationSeconds),
    startedAt: entry.startedAt,
    stoppedAt: entry.stoppedAt
  });
}

export function calendarEntryCompactCreateInitialDraft(
  source: CalendarEntryCompactCreateSource
): CalendarEntryCompactDraft {
  return initialDraft({
    categoryId: "",
    description: "",
    tagNames: [],
    durationSeconds: elapsedSeconds(source.startedAt, source.stoppedAt),
    startedAt: source.startedAt,
    stoppedAt: source.stoppedAt
  });
}

export function calendarEntryCompactDraftHasChanges(
  entry: TimeEntryRow,
  draft: CalendarEntryCompactDraft
) {
  const initial = calendarEntryCompactInitialDraft(entry);
  return editableDraftHasChanges(initial, entry.stoppedAt ? draft : { ...draft, duration: initial.duration });
}

export function calendarEntryCompactCreateDraftHasChanges(
  source: CalendarEntryCompactCreateSource,
  draft: CalendarEntryCompactDraft
) {
  return editableDraftHasChanges(calendarEntryCompactCreateInitialDraft(source), draft);
}

export function normalizeCalendarEntryCompactDuration(raw: string) {
  const value = raw.trim();
  let seconds: number | null = null;
  if (/^\d+$/.test(value)) {
    seconds = Number(value) * 60;
  } else {
    const parts = value.split(":");
    if (parts.length === 2 && parts.every((part) => /^\d+$/.test(part))) {
      const [minutes, remainderSeconds] = parts.map(Number);
      if (remainderSeconds < 60) seconds = minutes * 60 + remainderSeconds;
    } else if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
      const [hours, minutes, remainderSeconds] = parts.map(Number);
      if (minutes < 60 && remainderSeconds < 60) {
        seconds = hours * 3_600 + minutes * 60 + remainderSeconds;
      }
    }
  }
  if (seconds === null || !Number.isSafeInteger(seconds) || seconds < 1) {
    throw new Error("Enter a duration of at least 00:00:01.");
  }
  return { seconds, value: formatCalendarEntryCompactDuration(seconds) };
}

export function formatCalendarEntryCompactDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function synchronizeCalendarEntryCompactDraft({
  draft,
  originalStartedAt,
  originalStoppedAt,
  owner
}: {
  draft: CalendarEntryCompactDraft;
  originalStartedAt: string;
  originalStoppedAt: string | null;
  owner: Exclude<CalendarEntryCompactTemporalOwner, "source">;
}): CalendarEntryCompactDraft {
  const next = { ...draft, temporalOwner: owner };
  const initial = initialDraft({
    categoryId: draft.categoryId,
    description: draft.description,
    tagNames: draft.tagNames,
    durationSeconds: originalStoppedAt ? elapsedSeconds(originalStartedAt, originalStoppedAt) : 0,
    startedAt: originalStartedAt,
    stoppedAt: originalStoppedAt
  });
  if (originalStoppedAt && owner === "finish") {
    const window = resolveExplicitDraftWindow({
      draft: next,
      initial,
      originalStartedAt,
      originalStoppedAt
    });
    const normalizedStart = localParts(window.startedAt);
    const normalizedFinish = localParts(window.stoppedAt);
    next.startedAtDate = normalizedStart.date;
    next.startedAtTime = normalizedStart.time;
    next.stoppedAtDate = normalizedFinish.date;
    next.stoppedAtTime = normalizedFinish.time;
    next.duration = formatCalendarEntryCompactDuration(elapsedSeconds(window.startedAt, window.stoppedAt));
    return next;
  }

  const startedAt = resolveDraftEdge({
    date: next.startedAtDate,
    initialDate: initial.startedAtDate,
    initialTime: initial.startedAtTime,
    label: "start",
    original: originalStartedAt,
    time: next.startedAtTime
  });
  const normalizedStart = localParts(startedAt);
  next.startedAtDate = normalizedStart.date;
  next.startedAtTime = normalizedStart.time;

  if (!originalStoppedAt) return next;

  const duration = normalizeCalendarEntryCompactDuration(next.duration);
  const stoppedAt = new Date(new Date(startedAt).getTime() + duration.seconds * 1_000).toISOString();
  const normalizedFinish = localParts(stoppedAt);
  next.stoppedAtDate = normalizedFinish.date;
  next.stoppedAtTime = normalizedFinish.time;
  next.duration = duration.value;
  return next;
}

export function buildCalendarEntryCompactSavePlan({
  draft,
  dirty,
  entry,
  now
}: {
  draft: CalendarEntryCompactDraft;
  dirty: CalendarEntryCompactDirty;
  entry: TimeEntryRow;
  now: Date;
}): CalendarEntryCompactSavePlan {
  const description = draft.description.trim() || null;
  const categoryId = draft.categoryId || null;
  const tagNames = [...draft.tagNames];
  const window = resolveDraftWindow({
    draft,
    originalStartedAt: entry.startedAt,
    originalStoppedAt: entry.stoppedAt
  });
  validateNotFuture(window.startedAt, window.stoppedAt, now);

  const payload: CalendarEntryCompactPatch = {};
  if (dirty.description && description !== entry.description) payload.description = description;
  if (dirty.categoryId && categoryId !== entry.categoryId) payload.categoryId = categoryId;
  if (dirty.tagNames && !sameTagNames(tagNames, entry.tagNames)) payload.tagNames = tagNames;
  if (window.startedAt !== entry.startedAt) payload.startedAt = window.startedAt;
  if (window.stoppedAt && window.stoppedAt !== entry.stoppedAt) payload.stoppedAt = window.stoppedAt;

  return {
    durationSeconds: window.stoppedAt
      ? elapsedSeconds(window.startedAt, window.stoppedAt)
      : Math.max(0, Math.floor((now.getTime() - new Date(window.startedAt).getTime()) / 1_000)),
    payload,
    resolved: { categoryId, description, tagNames, ...window }
  };
}

export function buildCalendarEntryCompactCreatePlan({
  draft,
  now = new Date(),
  source
}: {
  draft: CalendarEntryCompactDraft;
  now?: Date;
  source: CalendarEntryCompactCreateSource;
}): CalendarEntryCompactCreatePlan {
  const description = draft.description.trim() || null;
  const categoryId = draft.categoryId || null;
  const tagNames = [...draft.tagNames];
  const window = resolveDraftWindow({
    draft,
    originalStartedAt: source.startedAt,
    originalStoppedAt: source.stoppedAt
  });
  validateNotFuture(window.startedAt, window.stoppedAt, now);
  const stoppedAt = window.stoppedAt as string;

  return {
    durationSeconds: elapsedSeconds(window.startedAt, stoppedAt),
    input: {
      ...(categoryId ? { categoryId } : {}),
      ...(description ? { description } : {}),
      tagNames,
      startedAt: window.startedAt,
      stoppedAt
    },
    resolved: { categoryId, description, tagNames, startedAt: window.startedAt, stoppedAt }
  };
}

function initialDraft({
  categoryId,
  description,
  tagNames,
  durationSeconds,
  startedAt,
  stoppedAt
}: {
  categoryId: string;
  description: string;
  tagNames: string[];
  durationSeconds: number;
  startedAt: string;
  stoppedAt: string | null;
}): CalendarEntryCompactDraft {
  const start = localParts(startedAt);
  const finish = stoppedAt ? localParts(stoppedAt) : { date: "", time: "" };
  return {
    categoryId,
    description,
    tagNames: [...tagNames],
    startedAtDate: start.date,
    startedAtTime: start.time,
    stoppedAtDate: finish.date,
    stoppedAtTime: finish.time,
    duration: formatCalendarEntryCompactDuration(durationSeconds),
    temporalOwner: "source"
  };
}

function editableDraftHasChanges(initial: CalendarEntryCompactDraft, draft: CalendarEntryCompactDraft) {
  return (Object.keys(emptyCalendarEntryCompactDirty) as CalendarEntryCompactEditableKey[])
    .some((key) => key === "tagNames"
      ? !sameTagNames(draft.tagNames, initial.tagNames)
      : draft[key] !== initial[key]);
}

function resolveDraftWindow({
  draft,
  originalStartedAt,
  originalStoppedAt
}: {
  draft: CalendarEntryCompactDraft;
  originalStartedAt: string;
  originalStoppedAt: string | null;
}) {
  const initial = initialDraft({
    categoryId: draft.categoryId,
    description: draft.description,
    tagNames: draft.tagNames,
    durationSeconds: originalStoppedAt ? elapsedSeconds(originalStartedAt, originalStoppedAt) : 0,
    startedAt: originalStartedAt,
    stoppedAt: originalStoppedAt
  });
  const startChanged = draft.startedAtDate !== initial.startedAtDate || draft.startedAtTime !== initial.startedAtTime;
  const finishChanged = draft.stoppedAtDate !== initial.stoppedAtDate || draft.stoppedAtTime !== initial.stoppedAtTime;
  const durationChanged = draft.duration !== initial.duration;

  if (!startChanged && !finishChanged && !durationChanged) {
    return { startedAt: originalStartedAt, stoppedAt: originalStoppedAt };
  }

  if (draft.temporalOwner === "start" || draft.temporalOwner === "duration") {
    const startedAt = resolveDraftEdge({
      date: draft.startedAtDate,
      initialDate: initial.startedAtDate,
      initialTime: initial.startedAtTime,
      label: "start",
      original: originalStartedAt,
      time: draft.startedAtTime
    });
    if (!originalStoppedAt) return { startedAt, stoppedAt: null };
    const duration = normalizeCalendarEntryCompactDuration(draft.duration);
    return {
      startedAt,
      stoppedAt: new Date(new Date(startedAt).getTime() + duration.seconds * 1_000).toISOString()
    };
  }

  if (!originalStoppedAt) {
    const startedAt = resolveDraftEdge({
      date: draft.startedAtDate,
      initialDate: initial.startedAtDate,
      initialTime: initial.startedAtTime,
      label: "start",
      original: originalStartedAt,
      time: draft.startedAtTime
    });
    return { startedAt, stoppedAt: null };
  }
  return resolveExplicitDraftWindow({ draft, initial, originalStartedAt, originalStoppedAt });
}

function resolveExplicitDraftWindow({
  draft,
  initial,
  originalStartedAt,
  originalStoppedAt
}: {
  draft: CalendarEntryCompactDraft;
  initial: CalendarEntryCompactDraft;
  originalStartedAt: string;
  originalStoppedAt: string;
}) {
  const startedAtCandidates = draftEdgeCandidates({
    date: draft.startedAtDate,
    initialDate: initial.startedAtDate,
    initialTime: initial.startedAtTime,
    label: "start",
    original: originalStartedAt,
    time: draft.startedAtTime
  });
  const stoppedAtCandidates = draftEdgeCandidates({
    date: draft.stoppedAtDate,
    initialDate: initial.stoppedAtDate,
    initialTime: initial.stoppedAtTime,
    label: "finish",
    original: originalStoppedAt,
    time: draft.stoppedAtTime
  });
  const originalStartMs = new Date(originalStartedAt).getTime();
  const originalStopMs = new Date(originalStoppedAt).getTime();
  const valid = startedAtCandidates.flatMap((startedAt) => (
    stoppedAtCandidates
      .filter((stoppedAt) => new Date(stoppedAt).getTime() > new Date(startedAt).getTime())
      .map((stoppedAt) => ({ startedAt, stoppedAt }))
  ));
  if (!valid.length) throw new Error("Finish must be after Start");
  valid.sort((left, right) => {
    const leftDistance = candidateDistance(left.startedAt, originalStartMs) +
      candidateDistance(left.stoppedAt, originalStopMs);
    const rightDistance = candidateDistance(right.startedAt, originalStartMs) +
      candidateDistance(right.stoppedAt, originalStopMs);
    return leftDistance - rightDistance || left.startedAt.localeCompare(right.startedAt) ||
      left.stoppedAt.localeCompare(right.stoppedAt);
  });
  return valid[0];
}

function resolveDraftEdge({
  date,
  initialDate,
  initialTime,
  label,
  original,
  time
}: {
  date: string;
  initialDate: string;
  initialTime: string;
  label: "start" | "finish";
  original: string;
  time: string;
}) {
  const candidates = draftEdgeCandidates({ date, initialDate, initialTime, label, original, time });
  if (candidates.length === 1) return candidates[0];
  const originalMs = new Date(original).getTime();
  return [...candidates].sort((left, right) => (
    candidateDistance(left, originalMs) - candidateDistance(right, originalMs) || left.localeCompare(right)
  ))[0];
}

function draftEdgeCandidates({
  date,
  initialDate,
  initialTime,
  label,
  original,
  time
}: {
  date: string;
  initialDate: string;
  initialTime: string;
  label: "start" | "finish";
  original: string;
  time: string;
}) {
  if (date === initialDate && time === initialTime) return [original];
  const parsedTime = parseTimeInput(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parsedTime) {
    throw new Error(`Enter a valid ${label} date and time.`);
  }
  const candidates = dateTimeLocalInputToIsoCandidates(`${date}T${parsedTime}`);
  if (!candidates.length) throw new Error(`Enter a valid ${label} date and time.`);
  return candidates;
}

function validateNotFuture(startedAt: string, stoppedAt: string | null, now: Date) {
  if (new Date(startedAt).getTime() > now.getTime()) throw new Error("Start time cannot be in the future.");
  if (stoppedAt && new Date(stoppedAt).getTime() > now.getTime()) {
    throw new Error("Finish time cannot be in the future.");
  }
}

function localParts(value: string) {
  const local = dateTimeLocal(value);
  return { date: local.slice(0, 10), time: local.slice(11) };
}

function elapsedSeconds(startedAt: string, stoppedAt: string) {
  return Math.max(0, Math.floor((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 1_000));
}

function candidateDistance(value: string, originalMs: number) {
  return Math.abs(new Date(value).getTime() - originalMs);
}

export function calculateCalendarEditorPosition({
  anchor,
  panelHeight,
  panelWidth,
  viewportHeight,
  viewportWidth
}: {
  anchor: CalendarEditorRect;
  panelHeight: number;
  panelWidth: number;
  viewportHeight: number;
  viewportWidth: number;
}): CalendarEditorPosition {
  const margin = 12;
  const gap = 8;
  const width = Math.min(panelWidth, Math.max(0, viewportWidth - margin * 2));
  const maxHeight = Math.max(0, viewportHeight - margin * 2);

  if (viewportWidth <= 640) {
    return {
      left: margin,
      maxHeight,
      placement: "phone",
      top: Math.max(margin, viewportHeight - panelHeight - margin),
      width: Math.max(0, viewportWidth - margin * 2)
    };
  }

  const left = clamp(anchor.left, margin, Math.max(margin, viewportWidth - width - margin));
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - panelHeight;
  if (below + panelHeight <= viewportHeight - margin) {
    return { left, maxHeight, placement: "below", top: below, width };
  }
  if (above >= margin) {
    return { left, maxHeight, placement: "above", top: above, width };
  }
  const roomAbove = anchor.top - gap - margin;
  const roomBelow = viewportHeight - margin - below;
  if (roomAbove >= roomBelow) {
    return { left, maxHeight, placement: "above", top: margin, width };
  }
  return {
    left,
    maxHeight,
    placement: "below",
    top: clamp(below, margin, Math.max(margin, viewportHeight - panelHeight - margin)),
    width
  };
}

export function calendarEditorRectIsVisible(
  anchor: CalendarEditorRect,
  viewport: Pick<CalendarEditorRect, "bottom" | "left" | "right" | "top">,
  scroller?: Pick<CalendarEditorRect, "bottom" | "left" | "right" | "top"> | null
) {
  return rectsIntersect(anchor, viewport) && (!scroller || rectsIntersect(anchor, scroller));
}

export function calendarEditorOwnsPayloadKey(key: string) {
  return key === "description" || key === "categoryId" || key === "tagNames" || key === "startedAt" || key === "stoppedAt";
}

export function calendarEntryLocalDayOffset(startDate: string, finishDate: string) {
  const start = parseLocalDateKey(startDate);
  const finish = parseLocalDateKey(finishDate);
  if (!start || !finish) return 0;
  return Math.round((finish - start) / 86_400_000);
}

function rectsIntersect(
  left: Pick<CalendarEditorRect, "bottom" | "left" | "right" | "top">,
  right: Pick<CalendarEditorRect, "bottom" | "left" | "right" | "top">
) {
  return left.bottom > right.top && left.top < right.bottom && left.right > right.left && left.left < right.right;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function sameTagNames(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function parseLocalDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const parsed = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const check = new Date(parsed);
  return check.getUTCFullYear() === Number(year) &&
    check.getUTCMonth() === Number(month) - 1 &&
    check.getUTCDate() === Number(day)
    ? parsed
    : null;
}
