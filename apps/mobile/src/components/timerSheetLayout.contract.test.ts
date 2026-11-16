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

  it("groups the time shortcuts with what they adjust", () => {
    expect(sheet.indexOf('testID="time-entry-start-time"')).toBeLessThan(sheet.indexOf('testID="time-entry-set-last-stop-time"'));
    expect(sheet.indexOf('testID="time-entry-end-time"')).toBeLessThan(sheet.indexOf('testID="time-entry-round-stop-time"'));
    const endShortcut = sheet.indexOf('testID="time-entry-round-stop-time"');
    const roundEnd = sheet.slice(sheet.lastIndexOf("<Pressable", endShortcut), sheet.indexOf("</Pressable>", endShortcut));
    expect(roundEnd).toContain("sheetStyles.timeShortcut, sheetStyles.roundEndShortcut");
    expect(roundEnd).toContain("color: busy ? theme.textSecondary : theme.textPrimary");
    expect(roundEnd).toContain('accessibilityLabel="Round end time"');
    expect(roundEnd).not.toMatch(/backgroundColor|DayframeIcon/);
    expect(sheet).toMatch(/timeShortcutText: \{[^}]*textTransform: "uppercase"/);
    expect(nativeDial).toContain('roundDurationTitle = "ROUND DURATION"');
    expect(nativeDial).toContain("roundDurationButton.setTitle(Self.roundDurationTitle, for: .normal)");
    expect(dial).toContain("roundTimeEntryDialDuration({ startMs, endMs }, mode, endMs)");
    expect(dial).toContain("nativeEvent.revision !== revision");
    expect(dial).not.toContain("Spin the ring");
    expect(theme).not.toContain("durationDialHintRow");
  });

  it("shows Start and End as the prototype's filled time cards above the dial", () => {
    expect(sheet).toContain("styles.activeEditTimeCardMain");
    expect(theme).toMatch(/activeEditTimeGroup:\s*\{[\s\S]*?borderRadius: 14,[\s\S]*?backgroundColor: theme.surfaceMuted/);
    expect(sheet).toContain('testID="time-entry-start-date"');
    expect(sheet).toContain('testID="time-entry-start-time"');
    expect(sheet).toContain('testID="time-entry-end-date"');
    expect(sheet).toContain('testID="time-entry-end-time"');
    // A four-digit time keeps its room at the largest input size; the date truncates first.
    expect(sheet).toContain("const timeCardMinWidth = 18 + Math.ceil((clockFormat === \"12h\" ? 64 : 52) * Math.min(windowDimensions.fontScale, 1.35));");
    expect(sheet).toContain("{ minWidth: timeCardMinWidth }");
    // The date keeps a 44-point target: the cards stack before it would get less (Codex r1 on #447).
    expect(theme).toMatch(/activeEditCompactDate:\s*\{\s*flexShrink: 1,[^}]*minWidth: 44/);
    // Stacking stays at 1.6× text; a 12-hour time shrinks to fit instead (Codex r2 on #447).
    expect(sheet).toContain("const timeCardsStacked = windowDimensions.fontScale >= 1.6;");
    expect(sheet.match(/adjustsFontSizeToFit\s+minimumFontScale=\{0\.7\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the stopped dial's range handle inside the view and guards its centre action", () => {
    expect(nativeDial).toContain("DayframeDurationDialCore.baseRadius(");
    expect(nativeDial).toContain("DayframeDurationDialCore.rangeHandleFits(");
    expect(nativeDial).toContain("roundDurationButton.isEnabled = enabled");
    expect(nativeDial).toContain("activeInteractionId == nil");
    expect(nativeDial).toContain("isDescendant(of: roundDurationButton)");
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
    expect(nativeDial).toContain('includesRangeHandle: showsRangeHandle(record: record)');
    expect(dial).toContain("blocksExternalGesture(sheetDismissGestureRef)");
    expect(dial).toContain('pointerEvents="box-none"');
  });
});
