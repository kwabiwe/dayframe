import { DAYFRAME_APP_ICONS, timerTripClashQuestion, type DayframeGlyph, type ListCheck, type ReviewMutation, type TimelinePlace } from "@dayframe/shared";

import type { MobileReviewItem } from "./api";
import { isLocationReviewItem } from "./review";

export type CalendarReviewLog = {
  // Until existing persisted trip receipts have aged out, an omitted kind is a trip.
  kind?: "trip" | "place" | "check";
  check: ListCheck & { startedAt: string; stoppedAt: string };
  title: string;
  glyph?: DayframeGlyph;
  entryIds: readonly string[];
};

export type CalendarReviewHandover = CalendarReviewLog & { observedAt: number };

export function calendarReviewRowKey(log: CalendarReviewLog): string {
  return log.check.segmentId ? `${log.kind ?? "trip"}-${log.check.segmentId}` : `check-${log.check.id}`;
}

export function reviewActionLogsBlock(action: ReviewMutation["action"]) {
  return action === "accept" || action === "confirm" || action === "confirm_outing"
    || action === "record_poi_once" || action === "edit_and_confirm" || action === "save_place_and_confirm";
}

/** A positive answer through its Undo hold and outbox, from the same proposal that was confirmed. */
export function calendarReviewLog(
  item: MobileReviewItem | undefined,
  entryIds: readonly string[] = [],
  title?: string
): CalendarReviewLog | null {
  if (!item || timerTripClashQuestion(item) || !item.suggestedStartedAt || !item.suggestedStoppedAt
    || !(Date.parse(item.suggestedStoppedAt) > Date.parse(item.suggestedStartedAt))) return null;
  const segment = item.rawPayload?.clientSegmentId;
  const segmentId = isLocationReviewItem(item) && typeof segment === "string" && segment ? segment : null;
  return {
    kind: segmentId ? item.eventType === "commute_detected" ? "trip" : "place" : "check",
    check: { id: item.id, segmentId, startedAt: item.suggestedStartedAt, stoppedAt: item.suggestedStoppedAt },
    title: title?.trim() || item.title,
    ...(item.eventType?.startsWith("health_") || item.eventSource?.startsWith("health_")
      ? { glyph: DAYFRAME_APP_ICONS.sourceHealth } : {}),
    entryIds
  };
}

export function calendarPlaceLog(place: TimelinePlace, entryIds: readonly string[] = [], title?: string): CalendarReviewLog | null {
  if (!place.stoppedAt || !(Date.parse(place.stoppedAt) > Date.parse(place.startedAt))) return null;
  return {
    kind: "place",
    check: { id: `place-${place.id}`, segmentId: place.id, startedAt: place.startedAt, stoppedAt: place.stoppedAt },
    title: title?.trim() || place.name || (place.matchKind === "ambiguous" ? "Unclear place" : "Unknown place"),
    entryIds
  };
}
