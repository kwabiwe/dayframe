export const DAYFRAME_NATIVE_TABS = {
  today: {
    route: "today",
    dashboardTab: "timer",
    label: "Today",
    symbol: { default: "clock", selected: "clock.fill" }
  },
  calendar: {
    route: "calendar",
    dashboardTab: "calendar",
    label: "Calendar",
    symbol: "calendar"
  },
  reports: {
    route: "reports",
    dashboardTab: "reports",
    label: "Reports",
    symbol: { default: "chart.bar", selected: "chart.bar.fill" }
  }
} as const;

export const DAYFRAME_NATIVE_TAB_MINIMIZE_BEHAVIOR = "onScrollDown" as const;
