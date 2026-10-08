import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const sheet = source("./ActiveTimerEditSheet.tsx");
const dial = source("./TimeEntryDurationDial.tsx");
const suggestions = source("./HistoricalSuggestionsOverlay.tsx");
const theme = source("../lib/mobileTheme.ts");
const nativeDial = source("../../modules/dayframe-duration-dial/ios/DayframeDurationDialExpoView.swift");

describe("fixed timer-sheet layout contract", () => {
  it("removes only the heading separators while retaining inset result-row dividers", () => {
    expect(sheet).not.toContain("styles.tagAutocompleteDivider");
    expect(suggestions).not.toContain("styles.historicalSuggestionsDivider");
    expect(sheet).toContain("styles.tagSuggestionDivider");
    expect(suggestions).toContain("styles.taskSuggestionRowDivider");
  });

  it("keeps the time shortcuts behind one toggle on the hint row under the dial (step 4e)", () => {
    expect(dial).toContain("One turn is an hour.");
    expect(dial).toContain('testID="time-entry-dial-shortcuts"');
    expect(dial).toContain('accessibilityState={{ disabled, expanded: showShortcuts }}');
    expect(dial).toContain('testID: "time-entry-set-last-stop-time"');
    expect(dial).toContain('testID: "time-entry-round-stop-time"');
    expect(dial).toContain('testID: "time-entry-round-duration"');
    // Rounding is for stopped blocks; the last stop only when it would move the start.
    expect(dial).toContain('if (mode === "stopped") {');
    expect(dial).toContain("Math.abs(lastStopMs - startMs) >= 60_000");
    // A turn of the dial, a shortcut or a new presentation closes the shortcuts.
    expect(dial).toMatch(/phase === "began"\) \{\s*setShortcutsOpen\(false\)/);
    expect(dial).toContain("entering={localPresenceEntering(reduceMotion, \"fade\")}");
    expect(theme).toMatch(/durationDialHintRow:\s*\{[\s\S]*?marginTop: -16/);
    expect(theme).not.toContain("durationDialFieldActions");
    expect(theme).not.toContain("durationDialInnerAction");
    expect(dial).not.toContain("durationDialQuickActions");
  });

  it("shows Start and End as the prototype's filled time cards above the dial", () => {
    expect(sheet).toContain("styles.activeEditTimeCardMain");
    expect(theme).toMatch(/activeEditTimeGroup:\s*\{[\s\S]*?borderRadius: 14,[\s\S]*?backgroundColor: theme.surfaceMuted/);
    expect(sheet).toContain('testID="time-entry-start-date"');
    expect(sheet).toContain('testID="time-entry-start-time"');
    expect(sheet).toContain('testID="time-entry-end-date"');
    expect(sheet).toContain('testID="time-entry-end-time"');
  });

  it("uses responsive fixed geometry and leaves the timer form non-scrolling", () => {
    expect(sheet).toContain("timeEntrySheetLayoutDensity({");
    expect(sheet).toContain('testID="time-entry-sheet-form"');
    expect(sheet).not.toContain("scrollEnabled={false}");
    expect(theme).toContain("durationDialNativeViewCompact");
    expect(theme).toContain("durationDialNativeViewCondensed");
  });

  it("returns only the visible circular dial region to native gesture ownership", () => {
    expect(nativeDial).toContain("override func point(inside point: CGPoint, with event: UIEvent?)");
    expect(nativeDial).toContain("DayframeDurationDialCore.ownsTouch(");
    expect(nativeDial).toContain('includesRangeHandle: record.mode != "running"');
    expect(dial).toContain("blocksExternalGesture(sheetDismissGestureRef)");
    expect(dial).toContain('pointerEvents="box-none"');
  });
});
