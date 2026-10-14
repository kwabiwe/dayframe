import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(fileURLToPath(new URL("../DayframeDashboard.tsx", import.meta.url)), "utf8");
const ribbon = readFileSync(fileURLToPath(new URL("./TodayRibbon.tsx", import.meta.url)), "utf8");
const body = (start: string, end: string) => {
  const from = dashboard.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  return dashboard.slice(from, dashboard.indexOf(end, from) + end.length);
};

// "Where today went" on iPhone Today (PRD D15; motion.md).
describe("Today's \"Where today went\" wiring", () => {
  it("builds the strip on the per-minute clock from the goal frame's entries, never on the 1 s tick", () => {
    expect(dashboard).toMatch(
      /const todayWhereWent = useMemo\(\s*\(\) => buildTodayWhereWent\(\{ entries: loggedSourceEntries, nowMs: minuteNow \}\),\s*\[loggedSourceEntries, minuteNow\]\s*\);/
    );
    // The goal frame reads the same entries and clock, so the strip adds up to the hero.
    expect(dashboard).toMatch(/entries: loggedSourceEntries,\s*goalMinutes: data\?\.user\.dailyGoalMinutes,\s*nowMs: minuteNow,/);
    const section = body("<TodayRibbonSection", "/>");
    expect(section).toContain("nowMs={minuteNow}");
    expect(section).toContain("whereWent={todayWhereWent}");
    expect(section).toContain("onOpenWhereWent={openReportsToday}");
    expect(section).toContain("whereWentQuiet={todayWhereWentQuiet}");
    // Folded into the ribbon card, outside the strip's gesture, after the hour labels.
    const card = ribbon.slice(ribbon.indexOf("export const TodayRibbon = memo("), ribbon.indexOf("export function TodayRibbonSection("));
    expect(card.indexOf("<TodayWhereWent")).toBeGreaterThan(card.lastIndexOf("</GestureDetector>"));
    expect(card.indexOf("<TodayWhereWent")).toBeGreaterThan(card.indexOf("styles.hours"));
  });

  it("opens Reports on Today with the tick haptic through a tokenised in-memory request", () => {
    const open = body("const openReportsToday = useCallback(", "}, []);");
    expect(open).toContain('playHaptic("tick");');
    // A tap while a request is waiting reuses it (a double tap never asks twice).
    expect(open).toMatch(/setReportsRangeRequest\(\(current\) => \{\s*if \(current\) return current;\s*reportsRangeRequestToken\.current \+= 1;\s*return \{ choice: "today", token: reportsRangeRequestToken\.current \};\s*\}\);/);
    expect(open).toContain('router.navigate("/(tabs)/reports");');
    const acknowledge = body("const acknowledgeReportsRangeRequest = useCallback(", "}, []);");
    expect(acknowledge).toContain("current?.token === token ? null : current");
    const reports = body("<ReportsTab", "/>");
    expect(reports).toContain("rangeRequest={reportsRangeRequest}");
    expect(reports).toContain("onRangeRequestApplied={acknowledgeReportsRangeRequest}");
    // D9 unchanged: no initial choice is passed, so Reports opens on Week otherwise.
    expect(reports).not.toContain("initialChoice");
  });

  it("marks commits from a load, a recovered refresh and the cached launch as quiet, so the strip never fades in on them", () => {
    expect(dashboard).toContain("latestData.current = bootstrap;\n      loadedBootstrap.current = bootstrap;\n      setData(bootstrap);");
    expect(dashboard).toContain("latestData.current = next;\n    loadedBootstrap.current = next;\n    setData(next);");
    expect(dashboard).toContain("latestData.current = filtered;\n        loadedBootstrap.current = filtered;\n        setData(filtered);");
    expect(dashboard).toContain("const todayWhereWentQuiet = data !== previousTodayData.current && data === loadedBootstrap.current;");
    // Mutations (Start, Stop, edits) never mark the commit quiet.
    const mutation = body("    dashboardMutationRevision.current += 1;\n    const next = filterPendingDeletedTimeEntries(", "setData(next);");
    expect(mutation).not.toContain("loadedBootstrap");
  });
});
