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
    expect(source).toContain('const durationLabel = approximateArrival ? "Estimated duration" : "Duration"');
    expect(source).toContain("const approximateArrival = evidence.segment.approximateArrival");
    expect(source).toContain("accessibilityLabel={`${durationLabel} ${editableDuration}`}");
    expect(source).toContain("startDateText: formatLocationReviewDateInput(startAt)");
    expect(source).toContain("stopDateText: formatLocationReviewDateInput(stopAt)");
  });
});

describe("trip stops in Location Evidence", () => {
  it("lists a commute's recorded stops under its time range with positioned spoken labels and local motion", () => {
    expect(source).toContain('const stopsHeading = evidence.segment.kind === "commute" ? tripStopsHeading(evidence.stops) : null;');
    expect(source).toContain("const stopRows = tripStopRows(evidence.stops, formatTime);");
    expect(source).toContain("accessibilityLabel={`Stop ${index + 1} of ${stopRows.length}: ${row.accessibilityLabel}`}");
    const start = source.indexOf("{stopsHeading ? (");
    const block = source.slice(start, source.indexOf(") : null}", start));
    expect(block).toContain('accessibilityRole="header"');
    expect(block.match(/entering=\{localPresenceEntering\(reduceMotion\)\}/g)).toHaveLength(2);
    expect(block.match(/exiting=\{localPresenceExiting\(reduceMotion\)\}/g)).toHaveLength(2);
    expect(block.match(/layout=\{localLayoutTransition\(reduceMotion\)\}/g)).toHaveLength(2);
  });
});
