import { describe, expect, it } from "vitest";
import {
  buildLocationReviewEdit,
  buildLocationReviewResolutionAction,
  formatLocationReviewEditableTime,
  initialLocationReviewDescription,
  keyboardRevealScrollOffset,
  locationActivityGlyphName,
  parseLocationReviewWindow
} from "./locationReviewDraft";

const baselineStartedAt = new Date(2026, 7, 12, 9, 8, 23, 126).toISOString();
const baselineStoppedAt = new Date(2026, 7, 12, 9, 22, 30, 4).toISOString();

const window = {
  baselineStartedAt,
  baselineStoppedAt,
  startDateText: "2026-08-12",
  startTimeText: "09:08",
  stopDateText: "2026-08-12",
  stopTimeText: "09:22"
};

describe("Location Review editor draft", () => {
  it("starts generated unmatched-visit and commute activity as an empty optional draft", () => {
    expect(initialLocationReviewDescription({
      placeName: null,
      segmentKind: "stay",
      title: "Visit at an unknown place"
    })).toBe("");
    expect(initialLocationReviewDescription({
      placeName: null,
      segmentKind: "commute",
      title: "Commute"
    })).toBe("");
  });

  it("preserves meaningful stay activity copy", () => {
    expect(initialLocationReviewDescription({
      placeName: null,
      segmentKind: "stay",
      title: "Visit library"
    })).toBe("Visit library");
    expect(initialLocationReviewDescription({
      placeName: "Riverside Leisure Centre",
      segmentKind: "stay",
      title: "Workout"
    })).toBe("Workout");
  });

  it("reveals only a keyboard-covered control with bounded clearance", () => {
    expect(keyboardRevealScrollOffset({
      controlHeight: 48,
      controlTop: 520,
      currentOffset: 120,
      keyboardTop: 550
    })).toBe(154);
    expect(keyboardRevealScrollOffset({
      controlHeight: 48,
      controlTop: 420,
      currentOffset: 120,
      keyboardTop: 550
    })).toBe(120);
  });

  it("preserves hidden seconds and milliseconds when merging visible date/time edits", () => {
    const result = parseLocationReviewWindow(window);
    expect(result.error).toBeNull();
    expect(result.value).toEqual({
      startedAt: baselineStartedAt,
      stoppedAt: baselineStoppedAt
    });
  });

  it("rejects a window whose end is not after its start", () => {
    const result = parseLocationReviewWindow({
      ...window,
      startTimeText: "10:00",
      stopTimeText: "09:59"
    });
    expect(result.value).toBeNull();
    expect(result.error).toBe("End time must be after start time.");
  });

  it("keeps an untouched category implicit so commute self-healing remains available", () => {
    expect(buildLocationReviewEdit({
      categoryTouched: false,
      description: " Train home ",
      selectedCategoryId: null,
      window: {
        startedAt: window.baselineStartedAt,
        stoppedAt: window.baselineStoppedAt
      }
    })).toEqual({
      description: "Train home",
      startedAt: window.baselineStartedAt,
      stoppedAt: window.baselineStoppedAt
    });
  });

  it("records an explicit Uncategorized choice", () => {
    expect(buildLocationReviewEdit({
      categoryTouched: true,
      description: "Walk",
      selectedCategoryId: null,
      window: {
        startedAt: window.baselineStartedAt,
        stoppedAt: window.baselineStoppedAt
      }
    })).toMatchObject({ categoryId: null });
  });

  it("chooses one atomic action for saved-place correction or a new POI", () => {
    const edit = {
      description: "Training",
      startedAt: window.baselineStartedAt,
      stoppedAt: window.baselineStoppedAt
    };
    expect(buildLocationReviewResolutionAction({
      baselinePlaceId: "10000000-0000-4000-8000-000000000001",
      edit,
      newPlace: null,
      selectedSavedPlaceId: "20000000-0000-4000-8000-000000000002"
    })).toEqual({
      action: "change_place_and_confirm",
      placeId: "20000000-0000-4000-8000-000000000002",
      learnedPlaceId: null,
      edit
    });
    expect(buildLocationReviewResolutionAction({
      baselinePlaceId: null,
      edit,
      newPlace: {
        name: "Melbourne Sports Centre",
        formattedAddress: "Salerno Way",
        latitude: 51.735,
        longitude: 0.45
      },
      selectedSavedPlaceId: null
    })).toMatchObject({
      action: "save_place_and_confirm",
      name: "Melbourne Sports Centre",
      edit
    });
  });

  it("formats numeric time entry and derives familiar display-only glyphs", () => {
    expect(formatLocationReviewEditableTime("930")).toBe("09:30");
    expect(locationActivityGlyphName({
      categoryName: "Workout",
      description: "Strength session",
      segmentKind: "stay"
    })).toBe("exercise");
    expect(locationActivityGlyphName({
      categoryName: null,
      description: "",
      segmentKind: "commute"
    })).toBe("commute");
  });
});
