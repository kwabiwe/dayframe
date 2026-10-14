/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./ActiveTimerEditSheet.tsx", import.meta.url)),
  "utf8"
);

describe("edit entry date picker contract", () => {
  it("uses the shared date sheet for both start and end dates", () => {
    expect(source).toContain('useState<"start" | "end">("start")');
    expect(source).toContain('openDateSheet("start", parsedStart.date ?? fallbackStartAt())');
    expect(source).toContain('openDateSheet("end", parsedStop.date ?? parsedStart.date ?? fallbackStartAt())');
    expect(source).toContain('datePickerTarget === "end"');
    expect(source).toContain("onPress={openStartPicker}");
    expect(source).toContain("onPress={openEndPicker}");
    expect(source).not.toContain("FloatingDatePicker");
    expect(source).not.toContain('accessibilityLabel="End date"\n                        blurOnSubmit');
  });

  // Owner decisions D1/D2 (14 Oct 2026): a day tap only changes the date sheet's draft; Done
  // applies it with the card's own time; no day after today; Today · Yesterday quick picks.
  it("applies the drafted day only on Done, inline over the entry sheet", () => {
    const sheet = source.slice(source.indexOf("<DateSheet"), source.indexOf('testID="entry-date-sheet"'));
    expect(sheet).toContain("inline");
    expect(sheet).toContain("onSelectDay={(date) => setDateDraftKey(formatLocalDateKey(date))}");
    expect(sheet).toContain("onDone={() => (dateSheetDraftDate ? selectDate(dateSheetDraftDate) : false)}");
    expect(sheet).toContain('label: "Today"');
    expect(sheet).toContain('label: "Yesterday"');
    expect(sheet).toContain("maxDate={formatLocalDateKey(dateSheetMax)}");
    expect(sheet).toContain("notice={validationError}");
    // A stale presentation's exit never closes a newer date sheet.
    expect(sheet).toContain("if (id !== dateSheetPresentationRef.current) return;");
    // The cards show what Done would save; nothing previews the draft behind the sheet.
    expect(source).toContain("const previewStartAt = parsedStart.date;");
    expect(source).toContain("const parsed = parsedStart;");
  });
});
