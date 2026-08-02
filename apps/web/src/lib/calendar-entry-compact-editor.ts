import { formatLocalDate, parseTimeInput } from "@/lib/calendar-grid";
import { dateTimeLocal, dateTimeLocalInputToIso } from "@/lib/format";
import type { TimeEntryRow } from "@/lib/queries";

export type CalendarEntryCompactDraft = {
  categoryId: string;
  description: string;
  startedAt: string;
  stoppedAt: string;
};

export type CalendarEntryCompactDirty = Record<keyof CalendarEntryCompactDraft, boolean>;

export type CalendarEntryCompactPatch = {
  categoryId?: string | null;
  description?: string | null;
  startedAt?: string;
  stoppedAt?: string;
};

export type CalendarEntryCompactSavePlan = {
  durationSeconds: number;
  payload: CalendarEntryCompactPatch;
  resolved: {
    categoryId: string | null;
    description: string | null;
    startedAt: string;
    stoppedAt: string | null;
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
  startedAt: false,
  stoppedAt: false
};

export function calendarEntryCompactInitialDraft(entry: TimeEntryRow): CalendarEntryCompactDraft {
  return {
    categoryId: entry.categoryId ?? "",
    description: entry.description ?? "",
    startedAt: dateTimeLocal(entry.startedAt).slice(11),
    stoppedAt: entry.stoppedAt ? dateTimeLocal(entry.stoppedAt).slice(11) : ""
  };
}

export function calendarEntryCompactDraftHasChanges(
  entry: TimeEntryRow,
  draft: CalendarEntryCompactDraft
) {
  const initial = calendarEntryCompactInitialDraft(entry);
  return (Object.keys(initial) as Array<keyof CalendarEntryCompactDraft>)
    .some((key) => draft[key] !== initial[key]);
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
  const startedAt = dirty.startedAt
    ? timeOnOriginalLocalDate(entry.startedAt, draft.startedAt, "Enter a valid start time.")
    : entry.startedAt;
  const stoppedAt = entry.stoppedAt
    ? dirty.stoppedAt
      ? timeOnOriginalLocalDate(entry.stoppedAt, draft.stoppedAt, "Enter a valid finish time.")
      : entry.stoppedAt
    : null;

  if (dirty.startedAt && new Date(startedAt).getTime() > now.getTime()) {
    throw new Error("Start time cannot be in the future.");
  }
  if (
    (dirty.startedAt || dirty.stoppedAt) &&
    stoppedAt &&
    new Date(stoppedAt).getTime() <= new Date(startedAt).getTime()
  ) {
    throw new Error("Finish time must be after the start time.");
  }

  const payload: CalendarEntryCompactPatch = {};
  if (dirty.description && description !== entry.description) payload.description = description;
  if (dirty.categoryId && categoryId !== entry.categoryId) payload.categoryId = categoryId;
  if (dirty.startedAt && startedAt !== entry.startedAt) payload.startedAt = startedAt;
  if (dirty.stoppedAt && stoppedAt && stoppedAt !== entry.stoppedAt) payload.stoppedAt = stoppedAt;

  return {
    durationSeconds: Math.max(
      0,
      Math.floor(((stoppedAt ? new Date(stoppedAt) : now).getTime() - new Date(startedAt).getTime()) / 1_000)
    ),
    payload,
    resolved: { categoryId, description, startedAt, stoppedAt }
  };
}

function timeOnOriginalLocalDate(original: string, rawTime: string, error: string) {
  const time = parseTimeInput(rawTime);
  if (!time) throw new Error(error);
  const localDate = formatLocalDate(new Date(original));
  const iso = dateTimeLocalInputToIso(`${localDate}T${time}`);
  if (!iso) throw new Error(error);
  return iso;
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

export function calendarEditorPointerIsInside(
  path: readonly unknown[],
  panel: unknown,
  anchor: unknown
) {
  return path.includes(panel) || path.includes(anchor);
}

export function calendarEditorOwnsPayloadKey(key: string) {
  return key === "description" || key === "categoryId" || key === "startedAt" || key === "stoppedAt";
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
