import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./location/LocationReviewCorrectionEditor.tsx", import.meta.url)),
  "utf8"
);

describe("automatic Location Evidence time editor", () => {
  it("keeps detected dates internal and exposes only start, end and duration", () => {
    expect(source).not.toContain("FloatingDatePicker");
    expect(source).not.toContain("Edit start date");
    expect(source).not.toContain("Edit end date");
    expect(source).toContain('accessibilityLabel="Start time"');
    expect(source).toContain('accessibilityLabel="End time"');
    expect(source).toContain("accessibilityLabel={`Duration ${editableDuration}`}");
    expect(source).toContain("startDateText: formatLocationReviewDateInput(startAt)");
    expect(source).toContain("stopDateText: formatLocationReviewDateInput(stopAt)");
  });
});
