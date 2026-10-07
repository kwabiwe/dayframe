import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overlay = readFileSync(
  new URL("./HistoricalSuggestionsOverlay.tsx", import.meta.url),
  "utf8"
);
const theme = readFileSync(
  new URL("../lib/mobileTheme.ts", import.meta.url),
  "utf8"
);

describe("running timer suggestion metadata", () => {
  it("renders every suggested tag and includes it in the accessible action name", () => {
    expect(overlay).toContain("suggestion.tagNames.map((tag) => `#${tag}`)");
    expect(overlay).toContain("style={styles.taskSuggestionTags}");
    expect(overlay).toContain("tagLabel ? `with ${tagLabel}` : null");
  });

  it("puts the same Done pill in the sheet head for every time-entry sheet", () => {
    const sheet = readFileSync(new URL("./ActiveTimerEditSheet.tsx", import.meta.url), "utf8");
    const head = sheet.indexOf('testID="time-entry-sheet-upper-dismiss-area"');
    const done = sheet.indexOf('testID="time-entry-sheet-done"');
    expect(head).toBeGreaterThan(-1);
    expect(done).toBeGreaterThan(head);
    expect(done).toBeLessThan(sheet.indexOf('testID="time-entry-sheet-form"'));
    expect(sheet).toMatch(/donePill: \{[\s\S]*?minHeight: 44/);
    expect(theme).not.toContain("sheetHeaderRunning:");
    expect(theme).not.toContain("sheetDoneButtonRunning:");
  });
});
