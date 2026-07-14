/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const editSheetSource = readFileSync(
  fileURLToPath(new URL("./ActiveTimerEditSheet.tsx", import.meta.url)),
  "utf8"
);
const dashboardSource = readFileSync(
  fileURLToPath(new URL("./DayframeDashboard.tsx", import.meta.url)),
  "utf8"
);

describe("running timer suggestion placement", () => {
  it("keeps the compact suggestion list inside the running edit sheet above manual fields", () => {
    const suggestionsIndex = editSheetSource.indexOf(">SUGGESTIONS</Text>");
    const descriptionIndex = editSheetSource.indexOf(">Description</Text>");

    expect(suggestionsIndex).toBeGreaterThan(-1);
    expect(descriptionIndex).toBeGreaterThan(suggestionsIndex);
    expect(editSheetSource).toContain("suggestions.slice(0, 6)");
    expect(editSheetSource).toContain("isRunningMode &&");
    expect(dashboardSource).not.toContain("shouldShowTodaySuggestions");
    expect(dashboardSource).not.toContain("TodayTaskSuggestionRow");
  });

  it("opens the running edit sheet after an empty timer starts", () => {
    const startTaskSource = dashboardSource.slice(
      dashboardSource.indexOf("async function startTask("),
      dashboardSource.indexOf("async function applyRunningTimerSuggestion(")
    );

    expect(startTaskSource).toContain("description: null");
    expect(startTaskSource).toContain("setActiveEditVisible(true)");
    expect(dashboardSource).toContain("onApplySuggestion={applyRunningTimerSuggestion}");
  });
});
