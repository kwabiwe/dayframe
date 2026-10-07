import { useContext } from "react";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { DayframeDashboardProvider } from "@/components/DayframeDashboard";
import { ReportsSheetPortalContext } from "@/components/reports/ReportsSheetPortal";
import { useMobileTheme } from "@/lib/mobileTheme";
import { DAYFRAME_NATIVE_TABS, DAYFRAME_NATIVE_TAB_MINIMIZE_BEHAVIOR } from "@/lib/nativeTabs";
import { requestPlayOrbTap, usePlayOrbRunning } from "@/lib/playOrbBridge";

// Generated from the shared glyphs by scripts/generate-icons.mjs (@2x/@3x picked by scale).
const DAYFRAME_TAB_ICON_IMAGES = {
  today: require("../../assets/tab-icons/today.png"),
  calendar: require("../../assets/tab-icons/calendar.png"),
  reports: require("../../assets/tab-icons/reports.png"),
  orb: require("../../assets/tab-icons/orb.png")
};

export default function DashboardTabsLayout() {
  const { theme } = useMobileTheme();
  const reportsSheetPortal = useContext(ReportsSheetPortalContext);
  const timerRunning = usePlayOrbRunning();

  return (
    <DayframeDashboardProvider>
      {/* Leave the bar material unconfigured so UITabBar owns Liquid Glass and its older-iOS fallback. */}
      <NativeTabs
        hidden={reportsSheetPortal?.isPresented ?? false}
        // Owner decision 7 Oct: the selected tab is coral, because a neutral tint washes out over
        // Liquid Glass when bright activity blocks scroll beneath it. Unselected tabs stay neutral.
        iconColor={{ default: theme.textSecondary, selected: theme.accentText }}
        labelStyle={{
          default: {
            color: theme.textSecondary,
            fontFamily: "System",
            fontSize: 11,
            fontWeight: "700"
          },
          selected: {
            color: theme.accentText,
            fontFamily: "System",
            fontSize: 11,
            fontWeight: "700"
          }
        }}
        minimizeBehavior={DAYFRAME_NATIVE_TAB_MINIMIZE_BEHAVIOR}
        tintColor={theme.accentText}
      >
        <NativeTabs.Trigger name={DAYFRAME_NATIVE_TABS.today.route}>
          <NativeTabs.Trigger.Icon src={DAYFRAME_TAB_ICON_IMAGES.today} renderingMode="template" />
          <NativeTabs.Trigger.Label>{DAYFRAME_NATIVE_TABS.today.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name={DAYFRAME_NATIVE_TABS.calendar.route}>
          <NativeTabs.Trigger.Icon src={DAYFRAME_TAB_ICON_IMAGES.calendar} renderingMode="template" />
          <NativeTabs.Trigger.Label>{DAYFRAME_NATIVE_TABS.calendar.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name={DAYFRAME_NATIVE_TABS.reports.route}>
          <NativeTabs.Trigger.Icon src={DAYFRAME_TAB_ICON_IMAGES.reports} renderingMode="template" />
          <NativeTabs.Trigger.Label>{DAYFRAME_NATIVE_TABS.reports.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        {/* The Play orb's slot (Blocks prototype): iOS draws a "search"-role item as its own circle at
            the bar's trailing edge and moves the tabs left, which is the prototype's layout. The
            Dashboard draws the coral orb over it. The item is disabled, so a tap never selects it;
            its press (VoiceOver's double-tap) still reaches the orb's tap action. */}
        <NativeTabs.Trigger
          disabled
          listeners={{
            tabPress: () => requestPlayOrbTap()
          }}
          name={DAYFRAME_NATIVE_TABS.orb.route}
          role="search"
        >
          <NativeTabs.Trigger.Icon src={DAYFRAME_TAB_ICON_IMAGES.orb} renderingMode="template" />
          <NativeTabs.Trigger.Label>{timerRunning ? "Stop timer" : "Start a block"}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </DayframeDashboardProvider>
  );
}
