import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DAYFRAME_APP_ICONS } from "@dayframe/shared";
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

  it("draws Dayframe's own icons as template images inside the system Liquid Glass tab bar", () => {
    expect(Object.fromEntries(Object.entries(DAYFRAME_NATIVE_TABS).map(([tab, config]) => [tab, config.glyph]))).toEqual({
      today: DAYFRAME_APP_ICONS.today,
      calendar: DAYFRAME_APP_ICONS.calendar,
      reports: DAYFRAME_APP_ICONS.reports
    });
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../assets/tab-icons/manifest.json", import.meta.url)), "utf8")) as Record<string, { glyph: string }>;
    expect(Object.fromEntries(Object.entries(manifest).map(([tab, entry]) => [tab, entry.glyph]))).toEqual({
      today: DAYFRAME_NATIVE_TABS.today.glyph,
      calendar: DAYFRAME_NATIVE_TABS.calendar.glyph,
      reports: DAYFRAME_NATIVE_TABS.reports.glyph
    });

    const tabsLayout = readFileSync(fileURLToPath(new URL("../../app/(tabs)/_layout.tsx", import.meta.url)), "utf8");
    expect(tabsLayout).not.toContain("sf=");
    for (const tab of ["today", "calendar", "reports"]) {
      expect(tabsLayout).toContain(`require("../../assets/tab-icons/${tab}.png")`);
      expect(tabsLayout).toContain(`<NativeTabs.Trigger.Icon src={DAYFRAME_TAB_ICON_IMAGES.${tab}} renderingMode="template" />`);
    }
    // UIKit owns the glass material, so the layout must not set a background or blur of its own.
    expect(tabsLayout).not.toMatch(/backgroundColor=|blurEffect=|disableTransparentOnScrollEdge/);
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
