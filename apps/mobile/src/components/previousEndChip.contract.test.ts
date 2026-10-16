import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const sheet = source("./ActiveTimerEditSheet.tsx");
const dashboard = source("./DayframeDashboard.tsx");

// PRD D16 (owner idea 1, 14 Oct 2026): the running block's sheet offers "← From 10:15" under START
// (compact pill, owner 15 Oct 2026; VoiceOver: "Start from 10:15, after …").
describe("entry sheet start-at-the-previous-end chip", () => {
  it("is offered for the running block only, from today's last end before it started", () => {
    // Only the loaded blocks (owner decision: no new query, field or per-second work).
    expect(dashboard).toContain("previousEndOffer(data?.entries ?? [], { dayStartMs: day.getTime(), excludeId: active.id, startMs })");
    expect(dashboard).not.toContain("latestFinishedEntry");
    expect(dashboard).toMatch(/const startMs = Date\.parse\(active\.startedAt\);/);
    // Only the running sheet is given it.
    expect(dashboard.match(/previousEnd=\{previousEndForSheet\}/g)).toHaveLength(1);
    expect(dashboard).toMatch(/lastStoppedAt=\{recentStoppedAt\}\s*onApplySuggestion=\{applyRunningTimerSuggestion\}\s*previousEnd=\{previousEndForSheet\}/);
  });

  it("is fixed for each presentation, so it never appears or leaves while the sheet is up", () => {
    expect(sheet).toContain("setPresentedPreviousEnd(previousEndRef.current);");
    expect(sheet).toMatch(/setStartTimeEdited\(false\);\s*\/\/ Only the running block's sheet is given one \(Dashboard\)\.\s*setPresentedPreviousEnd/);
    expect(sheet).toContain("{presentedPreviousEnd ? (");
  });

  it("moves the draft start through the dial's path and toggles back to the block's own start", () => {
    const toggle = sheet.slice(sheet.indexOf("function togglePreviousEnd()"), sheet.indexOf("function dismissTransientEditingSurfaces()"));
    expect(toggle).toContain("if (busy || !Number.isFinite(previousEndMs)) return;");
    expect(toggle).toContain("const startMs = previousEndApplied ? ownStart : previousEndMs;");
    expect(toggle).toContain("applyDialInterval({ startMs, endMs: Date.now() });");
    // Applied means the draft start is exactly that end (seconds kept by the dial's merge).
    expect(sheet).toContain("parsedStart.date?.getTime() === previousEndMs");
  });

  it("checks the end still holds before moving the start and again on Done (Codex r1 on #419)", () => {
    const toggle = sheet.slice(sheet.indexOf("function togglePreviousEnd()"), sheet.indexOf("function dismissTransientEditingSurfaces()"));
    expect(toggle).toMatch(/if \(!previousEndApplied && !previousEndHolds\(\)\) \{\s*setValidationError\(PREVIOUS_END_CHANGED_MESSAGE\);\s*return;/);
    const save = sheet.slice(sheet.indexOf("async function saveChanges("), sheet.indexOf("const patch: TimeEntryUpdatePatch = {"));
    expect(save).toMatch(/if \(presentedPreviousEnd && parsed\.date\.getTime\(\) === previousEndMs && !previousEndHolds\(\)\) \{\s*setValidationError\(PREVIOUS_END_CHANGED_MESSAGE\);\s*return;/);
    // The block is recognised by its saved start (its optimistic id becomes the server's).
    expect(sheet).toContain("currentEntryStartedAt: entry?.startedAt,");
    expect(sheet).toContain("setPresentedPreviousEndEntryStart(previousEndRef.current ? previousEndEntryStartRef.current : null);");
  });

  it("keeps the draft's exact instant and gives the chip row one activity row", () => {
    expect(sheet).toMatch(/const startMs = draftInstantMs\(\{[\s\S]*?parse: \(\) => result\.timestampMs,/);
    expect(sheet).toMatch(/const endMs = draftInstantMs\(\{[\s\S]*?draftMs: draftEndMs,/);
    // Picking the same day in the date picker keeps the exact instant.
    expect(sheet).toMatch(/if \(formatDateInput\(date\) === \(datePickerTarget === "end" \? stoppedDateText : dateText\) && ownDraftMs > 0\) \{/);
    expect(sheet).toContain("const chipRowBudget = Math.max(1, ACTIVITY_CHIP_ROWS_BY_DENSITY[chipDensity] - (presentedPreviousEnd ? 1 : 0));");
  });

  it("is a compact filled pill under the START card: back arrow + time, the name spoken only (owner, 15 Oct)", () => {
    const chip = sheet.slice(sheet.indexOf('testID="time-entry-previous-end"') - 1200, sheet.indexOf('testID="time-entry-previous-end"') + 900);
    expect(chip).toContain("accessibilityLabel={`Start from ${formatClockTime(previousEndMs, clockFormat)}, after ${presentedPreviousEnd.previousName}`}");
    expect(chip).toContain("accessibilityState={{ disabled: busy, selected: previousEndApplied }}");
    expect(chip).toContain("hitSlop={{ top: 6, bottom: 6 }}");
    expect(chip).toContain("{ backgroundColor: theme.surfaceMuted }");
    // The registry's back arrow (a check once applied), then only "From HH:MM".
    expect(chip).toContain("glyph={previousEndApplied ? DAYFRAME_APP_ICONS.done : DAYFRAME_APP_ICONS.startFromPreviousEnd}");
    expect(chip).toMatch(/>\s*From \{formatClockTime\(previousEndMs, clockFormat\)\}\s*<\/Text>/);
    expect(chip).not.toContain("· after");
    expect(chip).not.toMatch(/\{presentedPreviousEnd\.previousName\}\s*</);
    expect(chip).not.toMatch(/theme\.(accent|primary|coral|live)/);
    expect(sheet).toMatch(/previousEndPill: \{[^}]*borderRadius: 999[^}]*minHeight: 32, minWidth: 44/);
  });

  it("sits in the START card's column, directly under the card", () => {
    const column = sheet.slice(sheet.indexOf("sheetStyles.startColumn"), sheet.indexOf("{hasStoppedTime ? ("));
    expect(column).toContain('testID="time-entry-start-card"');
    expect(column.indexOf('testID="time-entry-start-date"')).toBeLessThan(column.indexOf('testID="time-entry-previous-end"'));
    expect(sheet).toContain("startColumn: { flex: 1, gap: 6, minWidth: 0 },");
  });
});
