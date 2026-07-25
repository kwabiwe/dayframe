/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./ActiveTimerEditSheet.tsx", import.meta.url)),
  "utf8"
);

describe("edit entry date picker contract", () => {
  it("uses the shared floating date picker for both start and end dates", () => {
    expect(source).toContain('useState<"start" | "end">("start")');
    expect(source).toContain('setDatePickerTarget("start")');
    expect(source).toContain('setDatePickerTarget("end")');
    expect(source).toContain('datePickerTarget === "end"');
    expect(source).toContain("onPress={openStartPicker}");
    expect(source).toContain("onPress={openEndPicker}");
    expect(source).toContain("onSelect={selectDate}");
    expect(source).not.toContain('accessibilityLabel="End date"\n                        blurOnSubmit');
  });
});
