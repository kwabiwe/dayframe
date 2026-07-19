import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./DashboardRealtime.tsx", import.meta.url)),
  "utf8"
);

describe("web task suggestion interaction", () => {
  it("opens compact suggestions from the task field, not the Play submission", () => {
    const descriptionInput = dashboardSource.slice(
      dashboardSource.indexOf("<InlineTagInput"),
      dashboardSource.indexOf("{suggestionsOpen && !hashtagSuggestionsOpen")
    );
    const submitHandler = dashboardSource.slice(
      dashboardSource.indexOf("async function submitTimerEntry("),
      dashboardSource.indexOf("function startTimerFromDescriptionKey(")
    );

    expect(descriptionInput).toContain("onFocus");
    expect(descriptionInput).toContain("onClick");
    expect(descriptionInput).toContain("setSuggestionsOpen(true)");
    expect(submitHandler).not.toContain("setSuggestionsOpen(true)");
    expect(dashboardSource).toContain("taskSuggestions.slice(0, 6)");
  });

  it("syncs tag-only changes and restores clean description plus persisted tag state after failure", () => {
    expect(dashboardSource).toContain(
      "JSON.stringify(nextNormalizedTagNames) === JSON.stringify(activeNormalizedTagNames)"
    );
    expect(dashboardSource).toContain(
      "setDescription(active.description ?? \"\")"
    );
    expect(dashboardSource).toContain("setSelectedTagNames(active.tagNames)");
    expect(dashboardSource).not.toContain("descriptionWithTagTokens");
  });
});
