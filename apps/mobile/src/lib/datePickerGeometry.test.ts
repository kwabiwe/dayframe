import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DATE_PICKER_CALENDAR_MAX_WIDTH,
  DATE_PICKER_HORIZONTAL_INSET,
  DATE_PICKER_SHELL_MAX_WIDTH,
} from "./datePickerGeometry";

const read = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

describe("shared date-picker geometry", () => {
  it("derives the 349-point calendar cap from the reference shell", () => {
    expect(DATE_PICKER_SHELL_MAX_WIDTH).toBe(361);
    expect(DATE_PICKER_HORIZONTAL_INSET).toBe(6);
    expect(DATE_PICKER_CALENDAR_MAX_WIDTH).toBe(349);
    expect(320 - DATE_PICKER_HORIZONTAL_INSET * 2).toBe(308);
    expect((320 - DATE_PICKER_HORIZONTAL_INSET * 2) / 7).toBe(44);
  });

  it("keeps the entry editor and Reports on the one shared date sheet and its caps", () => {
    const dateSheet = read("../components/DateSheet.tsx");
    expect(read("../components/ActiveTimerEditSheet.tsx")).toContain("<DateSheet");
    expect(read("../components/reports/ReportSheets.tsx")).toContain("<DateSheet");
    expect(dateSheet).toContain("DATE_PICKER_CALENDAR_MAX_WIDTH");
    expect(dateSheet).not.toMatch(/marginHorizontal:\s*-10/);
  });
});
