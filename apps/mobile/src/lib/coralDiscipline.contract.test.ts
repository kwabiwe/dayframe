import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const theme = readFileSync(resolve(__dirname, "mobileTheme.ts"), "utf8");
const reports = readFileSync(resolve(__dirname, "../components/reports/ReportsBlocks.tsx"), "utf8");
const editSheet = readFileSync(resolve(__dirname, "../components/ActiveTimerEditSheet.tsx"), "utf8");

function styleBlock(name: string) {
  const start = theme.indexOf(`    ${name}: {`);
  expect(start, name).toBeGreaterThan(-1);
  return theme.slice(start, theme.indexOf("\n    },", start));
}

describe("Coral discipline on iPhone (audit A4)", () => {
  it("keeps secondary buttons, Done and today markers neutral, and destructive text red", () => {
    expect(styleBlock("secondaryButtonText")).toContain("color: theme.textPrimary");
    expect(styleBlock("activeEditDeleteText")).toContain("color: theme.dangerText");
    expect(reports).toContain('<DayframeIcon color={theme.textPrimary} glyph="flame" size={22} />');
    expect(reports).toContain("borderColor: theme.textPrimary, borderWidth: 1.5");
  });

  it("passes the entry sheet's date limit through the tested helper", () => {
    expect(editSheet).toContain("const dateSheetMax = entryDatePickerMaxDate(new Date());");
    expect(editSheet).toMatch(/<DateSheet[\s\S]*?maxDate=\{formatLocalDateKey\(dateSheetMax\)\}/);
  });
});
