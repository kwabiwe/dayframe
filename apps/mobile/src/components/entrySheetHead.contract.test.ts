import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sheet = readFileSync(new URL("./ActiveTimerEditSheet.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("./DayframeDashboard.tsx", import.meta.url), "utf8");

// Blocks parity step 4a: the prototype's sheet head and action row (design/blocks/ios.html openEntrySheet).
describe("time-entry sheet head and actions", () => {
  it("heads every sheet with an eyebrow, a title and Done", () => {
    expect(sheet).toContain('const headEyebrow = isRunningMode ? "RECORDING" : isAddMode ? "ADD PAST TIME" : formatSheetDay(new Date(entry?.startedAt ?? draftStartMs));');
    expect(sheet).toContain('const headTitle = isRunningMode ? "Running block" : isAddMode ? "New block" : "Edit block";');
    expect(sheet).not.toContain("timeEntryHero");
  });

  it("ends with Discard and Stop while running, Delete and Start again when stopped", () => {
    const start = sheet.indexOf(`testID="time-entry-sheet-actions"`);
    const actions = sheet.slice(start, sheet.indexOf("<HistoricalSuggestionsOverlay", start));
    expect(actions.indexOf('testID="time-entry-sheet-delete"')).toBeLessThan(actions.indexOf('testID="time-entry-sheet-stop"'));
    expect(actions.indexOf('testID="time-entry-sheet-stop"')).toBeLessThan(actions.indexOf('testID="time-entry-sheet-start-again"'));
    expect(actions).toContain('{isRunningMode || isAddMode ? "Discard" : "Delete"}');
    expect(sheet).toContain("const canStartAgain = !isRunningMode && !isAddMode && Boolean(onStartAgain) && Boolean(onSave);");
  });

  it("saves a stopped block's edits before starting it again, with the saved values", () => {
    const startAgain = sheet.slice(sheet.indexOf("function startAgainFromSheet()"), sheet.indexOf("async function stopFromSheet()"));
    expect(startAgain).toContain("void saveChanges((patch) => onStartAgain({");
    const save = sheet.slice(sheet.indexOf("async function saveChanges("), sheet.indexOf("function startAgainFromSheet()"));
    expect(save).toMatch(/if \(accepted && ok\) \{\s*requestCoordinatedDismiss\(\{ bypassDiscardConfirmation: true \}\);\s*afterSave\?\.\(patch\);/);
    // Done never hands its press event to saveChanges as a callback.
    expect(sheet).not.toContain("onPress={saveChanges}");
    // The Dashboard starts it only once the sheet has left (a second sheet over one still on screen
    // is refused by iOS), and starts a bare block directly, without the blank-timer editor.
    expect(dashboard).toMatch(/onStartAgain=\{\(values\) => \{[\s\S]*?pendingStartAgain\.current = values;\s*\}\}/);
    const exit = dashboard.slice(dashboard.indexOf("function completeCalendarEntryExit("), dashboard.indexOf("function startAgainFromSheet("));
    expect(exit).toMatch(/setCalendarEditEntry\(null\);\s*const startAgain = pendingStartAgain\.current;\s*pendingStartAgain\.current = null;\s*if \(startAgain\) startAgainFromSheet\(startAgain\);/);
    const start = dashboard.slice(dashboard.indexOf("function startAgainFromSheet("), dashboard.indexOf("function nextTimerMutationVersion("));
    expect(start).toMatch(/if \(categoryId \|\| description\) \{\s*startFromToday\(categoryId, description, tagNames\);/);
    expect(start).toContain('void startTaskWith({ categoryId: null, description: "", startedAt: null, tagNames })');
    // A stale request never fires: a new completed-entry sheet and logout both clear it.
    expect(dashboard.slice(dashboard.indexOf("function presentCompletedEntry("), dashboard.indexOf("function presentCompletedEntry(") + 400)).toContain("pendingStartAgain.current = null;");
    expect(dashboard.slice(dashboard.indexOf("const transitionToSignedOut = useCallback("), dashboard.indexOf("const syncQueuedEvents = useCallback("))).toContain("pendingStartAgain.current = null;");
  });
});
