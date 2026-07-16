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
    expect(editSheetSource).not.toContain("dismissSuggestionsOnOutsideTouch");
    expect(editSheetSource).not.toContain("hideSuggestionsForManualEdit");
    expect(editSheetSource).not.toContain("!entry.categoryId &&");
  });

  it("opens the running edit sheet after an empty timer starts", () => {
    const startTaskSource = dashboardSource.slice(
      dashboardSource.indexOf("async function startTask("),
      dashboardSource.indexOf("async function applyRunningTimerSuggestion(")
    );
    const blankStartSource = startTaskSource.slice(
      startTaskSource.indexOf("if (!categoryId && !description.trim())"),
      startTaskSource.indexOf("function startBlankTask()")
    );

    expect(blankStartSource).toContain("description: null");
    expect(blankStartSource.indexOf("await startTaskWith")).toBeLessThan(
      blankStartSource.indexOf("setActiveEditVisible(true)")
    );
    expect(blankStartSource).toContain("{ animateLayout: false }");
    expect(blankStartSource).toContain("requestAnimationFrame");
    expect(blankStartSource).toContain("setActiveEditVisible(true)");
    expect(dashboardSource.match(/onPress=\{startBlankTask\}/g)).toHaveLength(2);
    expect(dashboardSource).toContain("pendingEntryFromStartInput");
    expect(dashboardSource).toContain("onApplySuggestion={applyRunningTimerSuggestion}");
    expect(dashboardSource).toContain("if (latestData.current?.activeEntry)");
    expect(dashboardSource).toContain("setActiveEditVisible(true)");
    expect(dashboardSource).not.toContain('mode="start"');
    expect(dashboardSource).toContain('accessibilityLabel="Add past time"');
    expect(dashboardSource).toContain('mode="add"');
  });

  it("resets suggestions by visible timer session rather than optimistic id replacement", () => {
    expect(editSheetSource).toContain("const editorSessionKey = entryStartedAt");
    expect(editSheetSource).not.toContain("const entryId = entry?.id");
    expect(editSheetSource).toContain("const editorSnapshot = useRef");
    expect(editSheetSource).toContain("descriptionEntryStarted.current = true");
    expect(editSheetSource).toContain("suggestionsProgress.setValue(shouldShowSuggestions ? 1 : 0)");
    expect(editSheetSource).toContain("snapshot.suggestionsAvailable");
  });

  it("keeps destructive running-timer deletion inside the edit sheet instead of the active timer card", () => {
    const activeTimerCardSource = dashboardSource.slice(
      dashboardSource.indexOf('accessibilityLabel={hasLiveActiveTimer ? "Edit running timer"'),
      dashboardSource.indexOf('accessibilityLabel="Start timer and add details"')
    );

    expect(activeTimerCardSource.length).toBeGreaterThan(0);
    expect(activeTimerCardSource).not.toContain("Active timer</Text>");
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
