import { describe, expect, it } from "vitest";
import {
  categoryDisplay,
  timeEntryAccentColor,
  timeEntryCategoryLabel,
  timeEntryContextLabel,
  timeEntryTitle
} from "./display";

describe("time entry display helpers", () => {
  it("uses the description as the main title when present", () => {
    expect(
      timeEntryTitle({
        description: "Draft hosted auth notes",
        categoryName: "Work"
      })
    ).toBe("Draft hosted auth notes");
  });

  it("uses the category as the main title for blank-description starts", () => {
    const entry = {
      description: "   ",
      categoryName: "Health",
      source: "manual_app"
    };

    expect(timeEntryTitle(entry)).toBe("Health");
    expect(timeEntryContextLabel(entry)).toBe("Web app");
  });

  it("names a blank uncategorized entry explicitly", () => {
    expect(timeEntryTitle({ description: " ", categoryName: null })).toBe("Uncategorized");
  });

  it("keeps uncategorized wording quiet for category columns", () => {
    expect(timeEntryCategoryLabel({ categoryName: null })).toBe("Uncategorized");
    expect(categoryDisplay(null, null)).toEqual({
      label: "Uncategorized",
      color: "var(--uncategorized-color)",
      isUncategorized: true
    });
  });

  it("keeps named categories on the shared palette", () => {
    expect(categoryDisplay("Work", "lime")).toEqual({
      label: "Work",
      color: "light-dark(#4BCE97, #4BCE97)",
      isUncategorized: false
    });
  });

  it("falls back to the category colour when no project colour exists", () => {
    expect(
      timeEntryAccentColor({
        projectColor: null,
        categoryColor: "lime",
        categoryName: "Work"
      })
    ).toBe("light-dark(#4BCE97, #4BCE97)");
  });
});
