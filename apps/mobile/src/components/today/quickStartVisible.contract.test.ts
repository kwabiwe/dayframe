import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const dashboard = read("../DayframeDashboard.tsx");
const surface = read("../accessibility/TodayTimerSurface.tsx");
const settings = read("../../../app/settings.tsx");

// Trello 210 recurrence (20 Oct): the mosaic's tiles settle at rest on every return to Today.
describe("quick-start tiles always show", () => {
  it("tells the mosaic when Today is in front, from the same focus that pauses the live block", () => {
    expect(dashboard).toContain("motionPaused={!isFocused}");
    expect(surface).toMatch(/<QuickStartMosaic\s+columns=\{quickStartColumns\}\s+focused=\{!motionPaused\}/);
  });

  it("shows the local quick-start record in Sync help and in the support details", () => {
    expect(settings).toContain('testID="sync-help-quick-start"');
    expect(settings).toContain("quickStartDiagnosticsSummary(readQuickStartDiagnostics(),");
    expect(settings).toContain("quickStart: readQuickStartDiagnostics(),");
  });
});
