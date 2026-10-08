import { describe, expect, it } from "vitest";
import { reviewLogAsEdit } from "./reviewLogAs";

const base = {
  draftName: undefined,
  draftCategoryId: undefined,
  defaultName: "Outdoor Walk",
  suggestedCategoryId: "walking",
  isLocationV2: false,
  startedAt: "2026-10-07T13:00:00.000Z",
  stoppedAt: "2026-10-07T13:45:00.000Z"
};

describe("reviewLogAsEdit", () => {
  it("sends nothing when nothing really changed", () => {
    expect(reviewLogAsEdit(base)).toBeNull();
    expect(reviewLogAsEdit({ ...base, draftName: " Outdoor Walk " })).toBeNull();
    expect(reviewLogAsEdit({ ...base, draftName: "" })).toBeNull();
    expect(reviewLogAsEdit({ ...base, draftCategoryId: "walking" })).toBeNull();
  });

  it("keeps the card's name on an activity-only change for a generic item", () => {
    expect(reviewLogAsEdit({ ...base, draftCategoryId: "exercise" })).toEqual({
      categoryId: "exercise",
      description: "Outdoor Walk",
      startedAt: base.startedAt,
      stoppedAt: base.stoppedAt
    });
  });

  it("lets a Location visit keep the server's naming on an activity-only change", () => {
    expect(reviewLogAsEdit({ ...base, isLocationV2: true, draftCategoryId: "exercise" })).toEqual({
      categoryId: "exercise",
      startedAt: base.startedAt,
      stoppedAt: base.stoppedAt
    });
  });

  it("sends a renamed moment with the suggested activity", () => {
    expect(reviewLogAsEdit({ ...base, draftName: "  Lunch walk " })).toEqual({
      categoryId: "walking",
      description: "Lunch walk",
      startedAt: base.startedAt,
      stoppedAt: base.stoppedAt
    });
  });

  it("falls back to a plain confirm without a valid suggested window", () => {
    expect(reviewLogAsEdit({ ...base, draftName: "Lunch", stoppedAt: null })).toBeNull();
    expect(reviewLogAsEdit({ ...base, draftName: "Lunch", stoppedAt: base.startedAt })).toBeNull();
  });
});
