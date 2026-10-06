import { DAYFRAME_APP_ICONS } from "@dayframe/shared";

// Icons are Dayframe glyphs rendered to template PNGs by scripts/generate-icons.mjs; UIKit tints
// them and draws the Liquid Glass tab bar around them.
export const DAYFRAME_NATIVE_TABS = {
  today: {
    route: "today",
    dashboardTab: "timer",
    label: "Today",
    glyph: DAYFRAME_APP_ICONS.today
  },
  calendar: {
    route: "calendar",
    dashboardTab: "calendar",
    label: "Calendar",
    glyph: DAYFRAME_APP_ICONS.calendar
  },
  reports: {
    route: "reports",
    dashboardTab: "reports",
    label: "Reports",
    glyph: DAYFRAME_APP_ICONS.reports
  }
} as const;

export const DAYFRAME_NATIVE_TAB_MINIMIZE_BEHAVIOR = "onScrollDown" as const;
