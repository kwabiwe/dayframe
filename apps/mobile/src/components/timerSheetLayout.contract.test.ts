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

  it("places field-specific actions above the dial and duration rounding inside it", () => {
    expect(dial).toContain('label={mode === "running" ? "SET TO LAST STOP TIME"');
    expect(dial).toContain('label="ROUND STOP TIME"');
    expect(dial).toContain('testID="time-entry-round-duration"');
    expect(dial).toContain('{mode === "stopped" ? (');
    expect(theme).toMatch(/durationDialFieldActions:\s*\{[\s\S]*?position: "absolute"/);
    expect(theme).toMatch(/durationDialInnerAction:\s*\{[\s\S]*?top: "50%"/);
    expect(dial).not.toContain("durationDialQuickActions");
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
