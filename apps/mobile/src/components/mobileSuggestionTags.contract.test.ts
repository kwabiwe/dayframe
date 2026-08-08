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

  it("uses the same outer-edge Done action for every time-entry sheet", () => {
    expect(theme).toContain("const TIME_ENTRY_SHEET_TOP_ACTION_INSET = 16;");
    expect(theme).toContain("top: TIME_ENTRY_SHEET_TOP_ACTION_INSET");
    expect(theme).toContain("right: TIME_ENTRY_SHEET_TOP_ACTION_INSET");
    expect(theme).toContain("minWidth: TIME_ENTRY_SHEET_TOP_ACTION_MIN_TARGET");
    expect(theme).toContain("minHeight: TIME_ENTRY_SHEET_TOP_ACTION_MIN_TARGET");
    expect(theme).not.toContain("sheetHeaderRunning:");
    expect(theme).not.toContain("sheetDoneButtonRunning:");
  });
});
