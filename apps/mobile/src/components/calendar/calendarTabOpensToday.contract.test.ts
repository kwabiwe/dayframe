import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Owner bug (29 Oct 2026): the Calendar tab "always wants to jump to the 23rd" — with the badge showing, its tap opened
// the oldest "?" (6 days back), and the day stayed selected after. The tab now always opens today; the badge is a count.
const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const tabsLayout = source("../../../app/(tabs)/_layout.tsx");
const dashboard = source("../DayframeDashboard.tsx");

const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  expect(from, start).toBeGreaterThan(-1);
  return text.slice(from, text.indexOf(end, from + start.length));
};

describe("the Calendar tab opens today (owner bug, 29 Oct 2026)", () => {
  it("opens today on every tap, badge or not, and never the oldest question", () => {
    expect(tabsLayout).toContain("listeners={{ tabPress: () => openCalendarToday?.() }}");
    expect(tabsLayout).not.toMatch(/openOldestCheck|useDashboardOpenOldestCheck/);
    expect(dashboard).not.toMatch(/openOldestCheck|useDashboardOpenOldestCheck/);
    // The badge stays a count on the tab.
    expect(tabsLayout).toContain('<NativeTabs.Trigger.Badge hidden={checkCount <= 0}>{checkCount > 99 ? "99+" : String(checkCount)}</NativeTabs.Trigger.Badge>');
  });

  it("selects today and carries no earlier \"?\" or scroll request over", () => {
    const openToday = between(dashboard, "const openCalendarToday = useCallback(() => {", "}, [");
    expect(openToday).toContain("selectCalendarDay(formatDateKey(new Date()));");
    expect(openToday).toContain("setCalendarCheckTarget(null);");
    expect(openToday).toContain("setCalendarCheckScroll(0);");
    // It never picks a question's day, nor a stored one.
    expect(openToday).not.toMatch(/askingChecks|openCheckOn|AsyncStorage/);
    expect(dashboard).toContain("checkCount: checkCounts.week, openCalendarToday, openCheckLink }}");
  });

  it("keeps the deliberate ways to a question's day: \"N to check\" oldest first, the reminder, a link to one \"?\"", () => {
    const next = between(dashboard, "const openNextCheck = useCallback(", "}, [");
    expect(next).toContain("openCheckOn(askingChecks[(at + 1) % askingChecks.length].id)");
    expect(dashboard).toContain("onNextCheck={openNextCheck}");
    expect(dashboard).toContain("openTodayChecksRef.current = () => askingChecks[0] ? openCheckOn(askingChecks[0].id)");
    // A check's day is the day it started, unless a given day is kept.
    expect(between(dashboard, "const openCheckOn = useCallback(", "}, [")).toContain("selectCalendarDay(dayKey ?? formatDateKey(new Date(startedAtMs)));");
  });

  it("draws the header and the List from one selected day, so they always agree", () => {
    // The native header (week strip, date) and the List's own day both come from the bridge's model of selectedDayKey.
    expect(dashboard).toMatch(/selectedDayKey,\s*theme,\s*transitionDirection: calendarTransitionDirection/);
    expect(dashboard).toContain("dayStartMs={nativeCalendarModel.dayStartMs}");
    expect(dashboard).toContain("dayEndMs={nativeCalendarModel.dayEndMs}");
    // Swiping the List and picking a day in the header change that one day.
    expect(dashboard).toContain("onSwipeDay={shiftSelectedCalendarDay}");
    expect(dashboard).toContain("onSelectDay={(event) => selectCalendarDay(event.nativeEvent.dayKey)}");
    // No selected day is kept between launches.
    expect(dashboard).toContain("const [selectedDayKey, setSelectedDayKey] = useState(() => formatDateKey(new Date()));");
    expect(dashboard).not.toMatch(/AsyncStorage\.(?:get|set)Item\([^)]*(?:SELECTED_DAY|selectedDay)/);
  });
});
