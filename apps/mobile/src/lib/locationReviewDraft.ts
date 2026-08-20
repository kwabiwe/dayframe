import {
  ReviewMutationSchema,
  type LocationReviewAction,
  type ReviewMutation,
  type ReviewEntryEdit
} from "@dayframe/shared";
import { mergeTimeEntryDialLocalDateTime } from "./timeEntryDurationDial";

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
};

export type ParsedLocationReviewWindow = {
  startedAt: string;
  stoppedAt: string;
};

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
  if (!placeName?.trim() && normalizedTitle === "visit at an unknown place") return "";
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

  const start = mergeTimeEntryDialLocalDateTime({
    baseTimestampMs: baselineStart,
    dateText: draft.startDateText,
    timeText: draft.startTimeText
  });
  if (start.timestampMs === null) {
    return { value: null, error: start.error ?? "Enter a valid start time." };
  }

  const stop = mergeTimeEntryDialLocalDateTime({
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
  return {
    description: description.trim(),
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
  if (action.action === "confirm" || action.action === "ignore_once_location") {
    return ReviewMutationSchema.parse(action);
  }
  if (
    action.action !== "edit_and_confirm" ||
    !action.edit.startedAt ||
    !action.edit.stoppedAt
  ) {
    return null;
  }
  const parsed = ReviewMutationSchema.safeParse(action);
  return parsed.success ? parsed.data : null;
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
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export function formatLocationReviewTimeInput(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatLocationReviewEditableTime(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  if (digits.length === 0) return "";
  if (digits.length === 1) {
    const hour = Number(digits);
    return hour > 2 ? `0${hour}:` : digits;
  }
  if (digits.length === 2) {
    const hour = Number(digits);
    if (hour > 23) return `0${digits[0]}:${digits[1]}`;
    return value.includes(":") ? `${digits}:` : digits;
  }
  if (digits.length === 3) {
    const hour = Number(digits.slice(0, 2));
    return hour > 23
      ? `0${digits[0]}:${digits.slice(1)}`
      : `${digits.slice(0, 2)}:${digits[2]}`;
  }
  const hour = Math.min(Number(digits.slice(0, 2)), 23);
  const minute = Math.min(Number(digits.slice(2)), 59);
  return `${pad2(hour)}:${pad2(minute)}`;
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
  segmentKind
}: {
  categoryName: string | null;
  description: string;
  segmentKind: "stay" | "commute";
}): LocationActivityGlyphName {
  if (segmentKind === "commute") return "commute";
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
