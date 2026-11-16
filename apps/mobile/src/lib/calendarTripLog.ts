import type { ListCheck } from "@dayframe/shared";

import type { MobileReviewItem } from "./api";

export type CalendarTripLog = {
  check: ListCheck & { segmentId: string; startedAt: string; stoppedAt: string };
  title: string;
  entryIds: readonly string[];
};

/** One direct trip answer through its hold and outbox, from the same proposal that was confirmed. */
export function calendarTripLog(
  item: MobileReviewItem | undefined,
  entryIds: readonly string[] = []
): CalendarTripLog | null {
  const segmentId = item?.rawPayload?.clientSegmentId;
  if (item?.eventType !== "commute_detected" || typeof segmentId !== "string" || !segmentId
    || !item.suggestedStartedAt || !item.suggestedStoppedAt
    || !(Date.parse(item.suggestedStoppedAt) > Date.parse(item.suggestedStartedAt))) return null;
  return {
    check: { id: item.id, segmentId, startedAt: item.suggestedStartedAt, stoppedAt: item.suggestedStoppedAt },
    title: item.title,
    entryIds
  };
}
