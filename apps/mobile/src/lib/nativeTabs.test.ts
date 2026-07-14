import { describe, expect, it } from "vitest";
import { DAYFRAME_NATIVE_TABS, DAYFRAME_NATIVE_TAB_MINIMIZE_BEHAVIOR } from "./nativeTabs";

describe("native tab configuration", () => {
  it("maps the three dashboard experiences to stable native routes", () => {
    expect(Object.values(DAYFRAME_NATIVE_TABS).map((tab) => ({
      route: tab.route,
      dashboardTab: tab.dashboardTab,
      label: tab.label
    }))).toEqual([
      { route: "today", dashboardTab: "timer", label: "Today" },
      { route: "calendar", dashboardTab: "calendar", label: "Calendar" },
      { route: "reports", dashboardTab: "reports", label: "Reports" }
    ]);
  });

  it("uses system symbols and the iOS scroll-minimizing tab behavior", () => {
    expect(DAYFRAME_NATIVE_TABS.today.symbol).toEqual({ default: "clock", selected: "clock.fill" });
    expect(DAYFRAME_NATIVE_TABS.calendar.symbol).toBe("calendar");
    expect(DAYFRAME_NATIVE_TABS.reports.symbol).toEqual({
      default: "chart.bar",
      selected: "chart.bar.fill"
    });
    expect(DAYFRAME_NATIVE_TAB_MINIMIZE_BEHAVIOR).toBe("onScrollDown");
  });
});
