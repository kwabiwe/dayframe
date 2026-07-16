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
    expect(editSheetSource).toContain("const MAX_RUNNING_SUGGESTIONS = 6;");
    expect(editSheetSource).toContain("suggestions.slice(0, MAX_RUNNING_SUGGESTIONS)");
    expect(editSheetSource).toContain("isRunningMode &&");
    expect(dashboardSource).not.toContain("shouldShowTodaySuggestions");
    expect(dashboardSource).not.toContain("TodayTaskSuggestionRow");
    expect(editSheetSource).not.toContain("selected ? <CheckGlyph");
  });

  it("opens the running edit sheet after an empty timer starts", () => {
    const startTaskSource = dashboardSource.slice(
      dashboardSource.indexOf("async function startTask("),
      dashboardSource.indexOf("async function applyRunningTimerSuggestion(")
    );

    expect(startTaskSource).toContain("description: null");
    expect(startTaskSource.indexOf("setActiveEditVisible(true)")).toBeLessThan(
      startTaskSource.indexOf("await startTaskWith")
    );
    expect(startTaskSource).toContain("setActiveEditVisible(true)");
    expect(dashboardSource).toContain("pendingEntryFromStartInput");
    expect(dashboardSource).toContain("onApplySuggestion={applyRunningTimerSuggestion}");
    expect(dashboardSource).toContain("if (latestData.current?.activeEntry)");
    expect(dashboardSource).toContain("setActiveEditVisible(true)");
  });

  it("keeps destructive running-timer deletion inside the edit sheet instead of the active timer card", () => {
    const activeTimerCardSource = dashboardSource.slice(
      dashboardSource.indexOf("<Text style={styles.label}>Active timer</Text>"),
      dashboardSource.indexOf("accessibilityLabel=\"Open start task sheet\"")
    );

    expect(activeTimerCardSource).not.toContain("Delete running timer");
    expect(activeTimerCardSource).not.toContain("deleteTimerButton");
    expect(editSheetSource).toContain("accessibilityLabel=\"Delete entry\"");
  });

  it("keeps timer mutations visually immediate and confirms deletion without replacing sheet content", () => {
    expect(dashboardSource).not.toContain("timerActionPending");
    expect(dashboardSource).not.toContain("timerProgressSlot");
    expect(editSheetSource).not.toContain("SheetMutationProgress");
    expect(editSheetSource).toContain("sheetDeleteConfirmationOverlay");
    expect(editSheetSource).toContain("accessibilityViewIsModal");
  });
});
