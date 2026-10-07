import { createHash } from "node:crypto";
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
    // Owner decision 7 Oct: the selected tab is coral (accentText), because a neutral tint washes out
    // over Liquid Glass when bright activity blocks scroll beneath it. Unselected tabs stay neutral.
    expect(tabsLayout).toContain("iconColor={{ default: theme.textSecondary, selected: theme.accentText }}");
    expect(tabsLayout).toContain("tintColor={theme.accentText}");
    expect(tabsLayout).toMatch(/selected: \{\s*color: theme\.accentText,/);
    expect(tabsLayout).not.toContain("theme.textPrimary");
    // UIKit owns the glass material, so the layout must not set a background or blur of its own.
    expect(tabsLayout).not.toMatch(/backgroundColor=|blurEffect=|disableTransparentOnScrollEdge/);
    expect(DAYFRAME_NATIVE_TAB_MINIMIZE_BEHAVIOR).toBe("onScrollDown");
  });

  it("ships tab images at 26 pt for each scale with the bytes the manifest records", () => {
    const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../assets/tab-icons/manifest.json", import.meta.url)), "utf8")) as Record<string, { images: Record<string, string> }>;
    for (const [tab, entry] of Object.entries(manifest)) {
      for (const [scale, size] of [["", 26], ["@2x", 52], ["@3x", 78]] as const) {
        const png = readFileSync(fileURLToPath(new URL(`../../assets/tab-icons/${tab}${scale}.png`, import.meta.url)));
        expect(png.readUInt32BE(16), `${tab}${scale} width`).toBe(size);
        expect(png.readUInt32BE(20), `${tab}${scale} height`).toBe(size);
        expect(png[25], `${tab}${scale} colour type has alpha`).toBe(6);
        expect(createHash("sha256").update(png).digest("hex"), `${tab}${scale}`).toBe(entry.images[`${tab}${scale}.png`]);
      }
    }
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
