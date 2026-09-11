import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

  it("removes the native tab-bar gap while a Reports sheet owns the viewport", () => {
    const rootLayout = readFileSync(
      fileURLToPath(
        new URL("../../app/_layout.tsx", import.meta.url),
      ),
      "utf8",
    );
    const reports = readFileSync(
      fileURLToPath(
        new URL("../components/reports/ReportsTab.tsx", import.meta.url),
      ),
      "utf8",
    );
    const tabsLayout = readFileSync(
      fileURLToPath(
        new URL("../../app/(tabs)/_layout.tsx", import.meta.url),
      ),
      "utf8",
    );
    expect(rootLayout).toContain(
      "<ReportsSheetPortalContext.Provider value={reportsSheetPortal}>",
    );
    expect(rootLayout).toContain("{reportsSheet}");
    expect(reports).toContain("onSheetPortalChange(presentedSheet)");
    expect(reports).toContain("onSheetPortalChange ? null : presentedSheet");
    expect(tabsLayout).toContain(
      "hidden={reportsSheetPortal?.isPresented ?? false}",
    );
    expect(reports).toContain("rootHosted={Boolean(onSheetPortalChange)}");
  });
});
