import { describe, expect, it } from "vitest";
import { activeLogAsCategoryId, reviewDeckDecisionName, reviewLogAsEdit, reviewLogAsEditorName } from "./reviewLogAs";

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

describe("reviewDeckDecisionName (staging feedback C2, Codex r1)", () => {
  const window = { startedAt: "2026-10-07T08:00:00.000Z", stoppedAt: "2026-10-07T08:25:00.000Z" };
  // A Location V2 commute card: heading "Commute detected", suggestion title "School run".
  const commute = {
    defaultName: "School run",
    suggestedCategoryId: "commute",
    isLocationV2: true,
    ...window
  };
  const commuteEdit = (draftName: string | undefined, draftCategoryId: string | undefined) =>
    reviewLogAsEdit({ ...commute, draftName, draftCategoryId });
  const commuteName = (edit: ReturnType<typeof reviewLogAsEdit>, activityName: string) =>
    reviewDeckDecisionName({
      logged: true,
      cardTitle: "Commute detected",
      edit,
      isLocationV2Commute: true,
      suggestionTitle: "School run",
      activityName
    });

  it("names an activity-only commute change by the activity the block shows (no description is stored)", () => {
    const edit = commuteEdit(undefined, "driving");
    expect(edit?.description).toBeUndefined();
    expect(commuteName(edit, "Driving")).toBe("Driving");
  });

  it("names a plain commute confirm by its activity, and a typed commute name by that name", () => {
    expect(commuteName(null, "Commute")).toBe("Commute");
    expect(commuteName(commuteEdit("  Drop-off  ", undefined), "Commute")).toBe("Drop-off");
    // Typing the default name back changes nothing, so nothing is sent.
    expect(commuteName(commuteEdit("School run", undefined), "Commute")).toBe("Commute");
  });

  it("names a stay or generic moment by the sent name, else the suggestion's title, never the detector heading", () => {
    const stay = { logged: true, cardTitle: "Visit at a place", isLocationV2Commute: false, suggestionTitle: "School run", activityName: "Errands" };
    expect(reviewDeckDecisionName({ ...stay, edit: null })).toBe("School run");
    const activityOnly = reviewLogAsEdit({ ...commute, draftName: undefined, draftCategoryId: "errands" });
    expect(reviewDeckDecisionName({ ...stay, edit: activityOnly })).toBe("School run");
    const generic = reviewLogAsEdit({ ...base, draftCategoryId: "exercise" });
    expect(reviewDeckDecisionName({ ...stay, cardTitle: "Outdoor Walk", suggestionTitle: "Outdoor Walk", activityName: "Exercise", edit: generic })).toBe(
      "Outdoor Walk"
    );
    expect(reviewDeckDecisionName({ ...stay, suggestionTitle: null, edit: null })).toBe("Errands");
  });

  it("names a skipped card by its heading, whatever was typed", () => {
    expect(
      reviewDeckDecisionName({
        logged: false,
        cardTitle: "Commute detected",
        edit: commuteEdit("Drop-off", "driving"),
        isLocationV2Commute: true,
        suggestionTitle: "School run",
        activityName: "Driving"
      })
    ).toBe("Commute detected");
  });
});
