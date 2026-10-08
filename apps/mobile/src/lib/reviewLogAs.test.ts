import { describe, expect, it } from "vitest";
import { activeLogAsCategoryId, reviewLogAsEdit, reviewLogAsEditorName } from "./reviewLogAs";

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

describe("activeLogAsCategoryId", () => {
  const categories = [{ id: "walk" }, { id: "read" }];

  it("keeps a drafted activity that is still active", () => {
    expect(activeLogAsCategoryId("walk", categories)).toBe("walk");
  });

  it("drops a drafted activity archived since it was picked", () => {
    expect(activeLogAsCategoryId("gym", categories)).toBeUndefined();
    expect(activeLogAsCategoryId("walk", undefined)).toBeUndefined();
  });

  it("leaves an untouched chip untouched", () => {
    expect(activeLogAsCategoryId(undefined, categories)).toBeUndefined();
  });
});

describe("reviewLogAsEditorName (details sheet hand-off)", () => {
  const base = { typedName: undefined, builtDescription: null, defaultName: "Possible journey", isLocationV2: false };

  it("starts from the card's default name when nothing was typed and the suggestion has none", () => {
    expect(reviewLogAsEditorName(base)).toBe("Possible journey");
    expect(reviewLogAsEditorName({ ...base, typedName: "   " })).toBe("Possible journey");
  });

  it("prefers a typed name, then the suggestion's own description", () => {
    expect(reviewLogAsEditorName({ ...base, typedName: "Drive to gym" })).toBe("Drive to gym");
    expect(reviewLogAsEditorName({ ...base, builtDescription: "Commute" })).toBe("Commute");
  });

  it("leaves a Location visit unnamed so the server names it", () => {
    expect(reviewLogAsEditorName({ ...base, isLocationV2: true })).toBeNull();
  });
});
