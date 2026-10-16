import {
  ReviewMutationSchema,
  type LocationReviewAction,
  type ReviewMutation,
  type ReviewEntryEdit
} from "@dayframe/shared";
import type { MobileBootstrap, MobileReviewItem } from "./api";
import { isLocationReviewItem } from "./review";
import { mergeTimeEntryDialLocalDateTime } from "./timeEntryDurationDial";
import { formatLocaleDate } from "./localeDateFormat";

export type LocationReviewNewPlace = {
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
};

export type LocationReviewWindowDraft = {
  baselineStartedAt: string;
  baselineStoppedAt: string;
  startDateText: string;
  startTimeText: string;
  stopDateText: string;
  stopTimeText: string;
  /**
   * The exact instants the time wheel or VoiceOver chose (A11b), used while the text still shows
   * them: the second 01:30 when the clocks go back, or a step's cleared seconds (Codex r1 on #432).
   */
  startDraftMs?: number | null;
  stopDraftMs?: number | null;
};

export type ParsedLocationReviewWindow = {
  startedAt: string;
  stoppedAt: string;
};

/**
 * Journey-only editor copy. Time away is a commute row but never a journey:
 * no "Commute automatically" category, and its own action and result wording.
 */
export function locationReviewJourneyCopy(segment: { kind: "stay" | "commute"; timeAway?: boolean }) {
  if (segment.kind !== "commute") return null;
  return segment.timeAway
    ? { journey: false, primaryLabel: "Record trip", recorded: "The trip was recorded.", placeholder: "Add a name (optional)" }
    : { journey: true, primaryLabel: "Record trip", recorded: "The trip was recorded.", placeholder: "Add trip details (optional)" };
}

const GENERATED_UNNAMED_STAY_TITLES = new Set(["unknown place", "near saved places", "visit at an unknown place", "visit near saved places"]);

export function initialLocationReviewDescription({
  placeName,
  segmentKind,
  title
}: {
  placeName: string | null;
  segmentKind: "stay" | "commute";
  title: string;
}) {
  if (segmentKind === "commute") return "";
  const normalizedTitle = title.trim().replace(/\s+/g, " ").toLowerCase();
  // Dayframe's own titles for a stay it cannot name (PRD D19, and the older wording) are not a name.
  if (!placeName?.trim() && GENERATED_UNNAMED_STAY_TITLES.has(normalizedTitle)) return "";
  return title;
}

export function keyboardRevealScrollOffset({
  clearance = 16,
  controlHeight,
  controlTop,
  currentOffset,
  keyboardTop
}: {
  clearance?: number;
  controlHeight: number;
  controlTop: number;
  currentOffset: number;
  keyboardTop: number;
}) {
  const coveredBy = controlTop + controlHeight + clearance - keyboardTop;
  return coveredBy > 0 ? Math.max(0, currentOffset + coveredBy) : currentOffset;
}

export function parseLocationReviewWindow(
  draft: LocationReviewWindowDraft
): { value: ParsedLocationReviewWindow | null; error: string | null } {
  const baselineStart = Date.parse(draft.baselineStartedAt);
  const baselineStop = Date.parse(draft.baselineStoppedAt);
  if (!Number.isFinite(baselineStart) || !Number.isFinite(baselineStop)) {
    return { value: null, error: "This suggestion does not have a complete time range." };
  }

  const start = ownDraftInstant(draft.startDraftMs, draft.startDateText, draft.startTimeText) ?? mergeTimeEntryDialLocalDateTime({
    baseTimestampMs: baselineStart,
    dateText: draft.startDateText,
    timeText: draft.startTimeText
  });
  if (start.timestampMs === null) {
    return { value: null, error: start.error ?? "Enter a valid start time." };
  }

  const stop = ownDraftInstant(draft.stopDraftMs, draft.stopDateText, draft.stopTimeText) ?? mergeTimeEntryDialLocalDateTime({
    baseTimestampMs: baselineStop,
    dateText: draft.stopDateText,
    timeText: draft.stopTimeText
  });
  if (stop.timestampMs === null) {
    return { value: null, error: stop.error ?? "Enter a valid end time." };
  }
  if (stop.timestampMs <= start.timestampMs) {
    return { value: null, error: "End time must be after start time." };
  }

  return {
    value: {
      startedAt: new Date(start.timestampMs).toISOString(),
      stoppedAt: new Date(stop.timestampMs).toISOString()
    },
    error: null
  };
}

/** A chosen instant while the endpoint's date and time text still show it; otherwise null. */
function ownDraftInstant(draftMs: number | null | undefined, dateText: string, timeText: string) {
  if (draftMs === null || draftMs === undefined || !Number.isFinite(draftMs)) return null;
  const own = new Date(draftMs);
  if (formatLocationReviewDateInput(own) !== dateText || formatLocationReviewTimeInput(own) !== timeText) return null;
  return { error: null, timestampMs: draftMs };
}

/**
 * One endpoint's instant on the evidence's own day: the chosen instant while the text still shows
 * it, else the text merged as typing is (anchored on the detected endpoint); null while the text
 * isn't a valid time.
 */
export function locationReviewEndpointMs({
  baselineMs,
  draftMs,
  timeText
}: {
  baselineMs: number;
  draftMs: number | null;
  timeText: string;
}) {
  const dateText = formatLocationReviewDateInput(new Date(baselineMs));
  return (ownDraftInstant(draftMs, dateText, timeText) ?? mergeTimeEntryDialLocalDateTime({
    baseTimestampMs: baselineMs,
    dateText,
    timeText
  })).timestampMs;
}

export function buildLocationReviewEdit({
  categoryTouched,
  description,
  selectedCategoryId,
  window
}: {
  categoryTouched: boolean;
  description: string;
  selectedCategoryId: string | null;
  window: ParsedLocationReviewWindow;
}): ReviewEntryEdit {
  const typed = description.trim();
  return {
    description: typed,
    // The editor starts a Move (and an unnamed stay) empty, so any name here was typed (PRD D19).
    ...(typed ? { descriptionTyped: true as const } : {}),
    startedAt: window.startedAt,
    stoppedAt: window.stoppedAt,
    ...(categoryTouched ? { categoryId: selectedCategoryId } : {})
  };
}

export function buildLocationReviewResolutionAction({
  baselinePlaceId,
  edit,
  newPlace,
  selectedSavedPlaceId
}: {
  baselinePlaceId: string | null;
  edit: ReviewEntryEdit;
  newPlace: LocationReviewNewPlace | null;
  selectedSavedPlaceId: string | null;
}): LocationReviewAction {
  if (newPlace) {
    return {
      action: "save_place_and_confirm",
      name: newPlace.name.trim(),
      latitude: newPlace.latitude,
      longitude: newPlace.longitude,
      radiusMeters: 80,
      edit
    };
  }
  if (selectedSavedPlaceId !== baselinePlaceId) {
    return {
      action: "change_place_and_confirm",
      placeId: selectedSavedPlaceId,
      learnedPlaceId: null,
      edit
    };
  }
  return { action: "edit_and_confirm", edit };
}

export function durableReviewMutationFromLocationAction(
  action: LocationReviewAction
): ReviewMutation | null {
  const parsed = ReviewMutationSchema.safeParse(action);
  return parsed.success ? parsed.data : null;
}

export type DurableLocationReviewCommand = {
  mutation: ReviewMutation;
  affectedReviewItemIds: string[];
  affectedItems: MobileReviewItem[];
  completion: "resolve_current" | "replace_current" | "resolve_current_and_adjacent";
  catalogueRefreshRequired: boolean;
};

export class LocationReviewDraftError extends Error {}

export function assertLocationReviewActionCompatible(
  mutation: ReviewMutation,
  item: Pick<MobileReviewItem, "eventType">
) {
  const isCommute = item.eventType === "commute_detected";
  if ((mutation.action === "split" || mutation.action === "split_and_confirm") && isCommute) {
    throw new LocationReviewDraftError("Only a detected visit can be split.");
  }
  if ((mutation.action === "merge" || mutation.action === "merge_and_confirm") && isCommute) {
    throw new LocationReviewDraftError("Only adjacent detected visits can be merged.");
  }
  if (
    (mutation.action === "record_poi_once" ||
      mutation.action === "save_place_and_confirm") &&
    isCommute
  ) {
    throw new LocationReviewDraftError("This place correction is only available for a detected visit.");
  }
}

export function buildDurableLocationReviewCommand(
  action: LocationReviewAction,
  current: MobileReviewItem,
  bootstrap: MobileBootstrap
): DurableLocationReviewCommand | null {
  const mutation = durableReviewMutationFromLocationAction(action);
  if (!mutation) return null;
  assertLocationReviewActionCompatible(mutation, current);
  const merge = mutation.action === "merge" || mutation.action === "merge_and_confirm";
  const ids = merge ? [current.id, mutation.adjacentReviewItemId] : [current.id];
  if (new Set(ids).size !== ids.length) throw new LocationReviewDraftError("Choose a different adjacent visit.");
  const affectedItems = ids.map((id) => {
    const item = bootstrap.reviewItems.find((candidate) => candidate.id === id && candidate.status === "open");
    if (!item || !isLocationReviewItem(item)) throw new LocationReviewDraftError(merge
      ? "Both visits must be available in saved Review data before merging. Go back and refresh Review."
      : "This visit is no longer available in saved Review data. Go back and refresh Review.");
    return item;
  });
  return {
    mutation, affectedReviewItemIds: [...ids].sort(), affectedItems,
    completion: merge ? "resolve_current_and_adjacent" : mutation.action === "split" ? "replace_current" : "resolve_current",
    catalogueRefreshRequired: mutation.action === "save_place_and_confirm"
  };
}

export function locationReviewActionRequiresConnection(
  action: LocationReviewAction
) {
  return durableReviewMutationFromLocationAction(action) === null;
}

export function formatLocationReviewDateInput(date: Date) {
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join("-");
}

export function formatLocationReviewDateLabel(date: Date) {
  const today = new Date();
  if (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  ) {
    return "Today";
  }
  return formatLocaleDate(date, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export function formatLocationReviewTimeInput(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export type LocationActivityGlyphName =
  | "commute"
  | "exercise"
  | "food"
  | "home"
  | "place"
  | "shopping"
  | "sleep"
  | "walk"
  | "work";

export function locationActivityGlyphName({
  categoryName,
  description,
  segmentKind,
  timeAway = false
}: {
  categoryName: string | null;
  description: string;
  segmentKind: "stay" | "commute";
  timeAway?: boolean;
}): LocationActivityGlyphName {
  if (segmentKind === "commute" && !timeAway) return "commute";
  const value = `${categoryName ?? ""} ${description}`.trim().toLowerCase();
  if (/\b(home|house)\b/.test(value)) return "home";
  if (/\b(work|office|school)\b/.test(value)) return "work";
  if (/\b(walk|walking|hike|hiking)\b/.test(value)) return "walk";
  if (/\b(run|running|workout|exercise|gym|training|cycle|cycling)\b/.test(value)) return "exercise";
  if (/\b(sleep|nap)\b/.test(value)) return "sleep";
  if (/\b(shop|shopping|grocer|groceries)\b/.test(value)) return "shopping";
  if (/\b(food|meal|breakfast|lunch|dinner|restaurant|cafe|coffee)\b/.test(value)) return "food";
  return "place";
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}
