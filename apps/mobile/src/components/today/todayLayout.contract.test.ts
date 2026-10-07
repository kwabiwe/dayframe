import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(fileURLToPath(new URL("../DayframeDashboard.tsx", import.meta.url)), "utf8");

// Blocks parity 2a-2: Today lists only today's blocks, then "Earlier this week"; Calendar holds the rest.
describe("Today layout", () => {
  it("renders only today's section as rows and the earlier days as the footer", () => {
    expect(dashboard).toContain("const todaySections = useMemo(() => historySections.filter((section) => section.isToday), [historySections]);");
    expect(dashboard).toContain("data={todaySections}");
    expect(dashboard).toMatch(/renderItem=\{\(\{ item \}\) => \(\s*<TodayBlockRows/);
    expect(dashboard).toMatch(/ListFooterComponent=\{\([\s\S]*?<Reanimated\.View layout=\{localLayoutTransition\(reduceMotion\)\} style=\{styles\.todayListFooter\}>\s*<EarlierThisWeek days=\{earlierDays\} onOpenDay=\{openCalendarDay\}/);
    expect(dashboard).not.toContain("HistoryDayCard");
  });

  it("builds a week of sections, not sixty days", () => {
    expect(dashboard).toMatch(/buildHistoryDaySections\(\{\s*days: EARLIER_DAYS \+ 1,/);
    // Entries awaiting Review never count on Today's rows, ribbon or week rows.
    expect(dashboard).toMatch(/const loggedSourceEntries = useMemo\(\s*\(\) => historySourceEntries\.filter\(\(entry\) => !isReviewNeededEntry\(entry\)\),\s*\[historySourceEntries\]\s*\);/);
    expect(dashboard).toMatch(/days: EARLIER_DAYS \+ 1,\s*entries: loggedSourceEntries,/);
  });

  it("opens an earlier day in the Calendar tab through the shared provider state", () => {
    const start = dashboard.indexOf("const openCalendarDay = useCallback(");
    const body = dashboard.slice(start, dashboard.indexOf("}, [selectCalendarDay]);", start));
    expect(body).toContain("selectCalendarDay(dayKey);");
    expect(body).toContain('router.navigate("/(tabs)/calendar");');
  });
});
