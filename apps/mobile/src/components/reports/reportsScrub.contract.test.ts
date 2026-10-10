import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Reports donut scrub owns the finger", () => {
  it("turns the Reports scroll view off while the donut is scrubbed", () => {
    const dashboard = readFileSync(new URL("../DayframeDashboard.tsx", import.meta.url), "utf8");
    const reports = dashboard.slice(dashboard.indexOf("styles.reportsScrollContent"), dashboard.indexOf("<ReportsTab") + 600);
    expect(reports).toContain("scrollEnabled={!reportsScrubbing}");
    expect(reports).toContain("onScrubbingChange={setReportsScrubbing}");
  });
});
