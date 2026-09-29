import type { LocationReviewAction } from "@dayframe/shared";
import type { LocationReviewWindowDraft } from "./locationReviewDraft";
import { mergeTimeEntryDialLocalDateTime } from "./timeEntryDurationDial";

export type CommuteInterruptionDraftResult =
  | { status: "valid"; mutation: Extract<LocationReviewAction, { action: "interrupt_commute" }>; error: null }
  | { status: "incomplete" | "invalid"; mutation: null; error: string };

export function parseCommuteInterruptionDraft(draft: LocationReviewWindowDraft): CommuteInterruptionDraftResult {
  if ([draft.startDateText, draft.startTimeText, draft.stopDateText, draft.stopTimeText].some((value) => !value.trim())) {
    return { status: "incomplete", mutation: null, error: "Enter both stop dates and times." };
  }
  const parentStart = Date.parse(draft.baselineStartedAt);
  const parentStop = Date.parse(draft.baselineStoppedAt);
  if (!Number.isFinite(parentStart) || !Number.isFinite(parentStop)) {
    return invalid("This commute does not have a complete time range.");
  }

  // These are new minute-resolution boundaries, not edits preserving parent seconds.
  const minutePrecisionBase = new Date(parentStart).setSeconds(0, 0);
  const start = mergeTimeEntryDialLocalDateTime({
    baseTimestampMs: minutePrecisionBase, dateText: draft.startDateText, timeText: draft.startTimeText
  });
  if (start.timestampMs === null) return invalid(start.error ?? "Enter a valid stop start time.");
  const stop = mergeTimeEntryDialLocalDateTime({
    baseTimestampMs: minutePrecisionBase, dateText: draft.stopDateText, timeText: draft.stopTimeText
  });
  if (stop.timestampMs === null) return invalid(stop.error ?? "Enter a valid journey resume time.");
  if (start.timestampMs >= stop.timestampMs) {
    return invalid("The stop must begin before the journey resumes.");
  }
  if (start.timestampMs <= parentStart || stop.timestampMs >= parentStop) {
    return invalid("Both stop times must be inside this commute.");
  }
  return {
    status: "valid",
    mutation: {
      action: "interrupt_commute",
      stopStartedAt: new Date(start.timestampMs).toISOString(),
      stopEndedAt: new Date(stop.timestampMs).toISOString()
    },
    error: null
  };
}

function invalid(error: string): CommuteInterruptionDraftResult {
  return { status: "invalid", mutation: null, error };
}
