import { describe, expect, it } from "vitest";
import {
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

  it("keeps uncategorized wording quiet for category columns", () => {
    expect(timeEntryCategoryLabel({ categoryName: null })).toBe("Uncategorized");
  });

  it("falls back to the category colour when no project colour exists", () => {
    expect(
      timeEntryAccentColor({
        projectColor: null,
        categoryColor: "lime",
        categoryName: "Work"
      })
    ).toBe("#BFE8D9");
  });
});
