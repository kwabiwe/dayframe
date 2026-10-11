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
    expect(styleBlock("activeEditDeleteText")).toContain("color: theme.danger");
    expect(styleBlock("datePickerDoneButton")).toContain("backgroundColor: theme.textPrimary");
    expect(styleBlock("datePickerDoneText")).toContain("color: theme.background");
    expect(reports).toContain('<DayframeIcon color={theme.textPrimary} glyph="flame" size={22} />');
    expect(reports).toContain("borderColor: theme.textPrimary, borderWidth: 1.5");
  });

  it("never offers later days for a block's start or end", () => {
    expect(editSheet).toMatch(/<FloatingDatePicker[\s\S]*?maxDate=\{new Date\(\)\}/);
  });
});
