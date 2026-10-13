import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync("src/components/DayframeDashboard.tsx", "utf8");
const clock = readFileSync("src/lib/dashboardClock.ts", "utf8");
const reports = readFileSync("src/components/reports/ReportsTab.tsx", "utf8");
const orb = readFileSync("src/components/today/PlayOrb.tsx", "utf8");
const motion = readFileSync("src/lib/blocksMotion.ts", "utf8");
const hotPaths = [
  "src/components/reports/ReportsBlocks.tsx",
  "src/lib/reportsRanges.ts",
  "src/lib/reportPlot.ts",
  "src/lib/nativeCalendarPresentation.ts",
  "src/lib/earlierThisWeek.ts"
].map((path) => [path, readFileSync(path, "utf8")] as const);

// Investigation 2026-10-12 (Instruments on an iPhone 11): the Dashboard re-rendered every tab every
// second, also in the background, and Reports and Calendar built a new date formatter per day label.
describe("idle and background clock work", () => {
  it("ticks whole seconds only for live time, never in the background", () => {
    expect(dashboard).not.toMatch(/useEffect\(\(\) => \{\s*const interval = setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\);\s*return \(\) => clearInterval\(interval\);\s*\}, \[\]\);/);
    expect(clock).toMatch(/if \(!foreground\) return undefined;[\s\S]*?if \(needsSecondClock\) \{[\s\S]*?setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/);
    expect(clock).toContain("}, [foreground, needsSecondClock, setNow]);");
    expect(dashboard).toContain("useDashboardClockTicks({ foreground: appIsForeground, needsSecondClock, setNow });");
    expect(orb).toMatch(/if \(!foreground\) return undefined;[\s\S]*?setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1000\)/);
  });
  it("holds the breathing ring still in the background (the display link otherwise kept running)", () => {
    expect(motion).toMatch(/const foreground = useAppForeground\(\);[\s\S]*?if \(reduceMotion \|\| !foreground\) \{\s*opacity\.value = BREATHING_RING\.reducedOpacity;/);
    expect(motion).toContain("}, [foreground, live, opacity, reduceMotion]);");
  });
  it("gives Reports and Today's presentation minute time unless a live block needs seconds", () => {
    expect(dashboard).toContain("nowMs={isFocused ? now : minuteFloorNow}");
    // Codex r1 on #374: new data is shown against the time it arrived; zone changes reset formatters.
    expect(dashboard).toMatch(/useEffect\(\(\) => \{\s*if \(appIsForeground\) setNow\(Date\.now\(\)\);\s*\}, \[appIsForeground, data\]\);/);
    expect(dashboard).toMatch(/if \(appIsForeground\) clearLocaleDateFormats\(\);/);
    // Codex r2/r3 on #374: a zone change rebuilds Reports' range and labels without remounting it.
    expect(dashboard).toContain("timeZoneId={timeZoneId}");
    expect(dashboard).not.toContain(":${data.user.id}:${timeZoneId}`}");
    expect(reports).toContain("[choice, day, timeZoneId]");
    expect(dashboard).toMatch(/TodayReviewPresentationProvider[\s\S]*?nowMs=\{minuteFloorNow\}/);
    expect(reports).toContain("export const ReportsTab = memo(ReportsTabView);");
  });
  it("formats day labels with cached formatters in the per-day paths", () => {
    for (const [path, source] of hotPaths) expect(source, path).not.toContain("toLocaleDateString");
  });
});
