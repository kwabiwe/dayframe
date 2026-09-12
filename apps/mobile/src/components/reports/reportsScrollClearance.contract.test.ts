import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync("src/components/DayframeDashboard.tsx", "utf8");
const theme = readFileSync("src/lib/mobileTheme.ts", "utf8");

describe("Reports native tab clearance ownership", () => {
  it("reserves clearance once on the parent scroll content, not inside the chart", () => {
    expect(dashboard).toContain("contentContainerStyle={[styles.container, styles.reportsScrollContent]}");
    expect(dashboard.match(/styles\.reportsScrollContent/g)).toHaveLength(1);
    expect(theme).toMatch(/reportsScrollContent:\s*\{\s*paddingBottom: 112\s*\}/);
    const chart = readFileSync("src/components/reports/ReportActivityChart.tsx", "utf8");
    expect(chart).not.toContain("reportsScrollContent");
  });
});
