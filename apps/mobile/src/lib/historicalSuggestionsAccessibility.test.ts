import { describe, expect, it } from "vitest";
import {
  HISTORICAL_SUGGESTION_ROLLBACK_ANNOUNCEMENT,
  historicalSuggestionAppliedAnnouncement
} from "./historicalSuggestionsAccessibility";

describe("historical suggestion accessibility announcements", () => {
  it("announces the applied Description and metadata", () => {
    expect(historicalSuggestionAppliedAnnouncement({
      categoryName: "Research",
      description: "Bauhaus references",
      tagNames: ["design", "reading"]
    })).toBe(
      "Applied suggestion: Bauhaus references. category Research; tags design, reading."
    );
  });

  it("keeps an unclassified suggestion concise", () => {
    expect(historicalSuggestionAppliedAnnouncement({
      categoryName: null,
      description: "Plan tomorrow",
      tagNames: []
    })).toBe("Applied suggestion: Plan tomorrow.");
  });

  it("uses an explicit rollback message rather than a false success", () => {
    expect(HISTORICAL_SUGGESTION_ROLLBACK_ANNOUNCEMENT).toMatch(/could not be applied/i);
    expect(HISTORICAL_SUGGESTION_ROLLBACK_ANNOUNCEMENT).toMatch(/restored/i);
    expect(HISTORICAL_SUGGESTION_ROLLBACK_ANNOUNCEMENT).not.toMatch(/^Applied/);
  });
});
