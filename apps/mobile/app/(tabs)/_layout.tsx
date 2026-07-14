import { NativeTabs } from "expo-router/unstable-native-tabs";
import { DayframeDashboardProvider } from "@/components/DayframeDashboard";
import { useMobileTheme } from "@/lib/mobileTheme";
import { DAYFRAME_NATIVE_TABS, DAYFRAME_NATIVE_TAB_MINIMIZE_BEHAVIOR } from "@/lib/nativeTabs";

export default function DashboardTabsLayout() {
  const { theme } = useMobileTheme();

  return (
    <DayframeDashboardProvider>
      {/* Leave the bar material unconfigured so UITabBar owns Liquid Glass and its older-iOS fallback. */}
      <NativeTabs
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
          <NativeTabs.Trigger.Icon sf={DAYFRAME_NATIVE_TABS.today.symbol} />
          <NativeTabs.Trigger.Label>{DAYFRAME_NATIVE_TABS.today.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name={DAYFRAME_NATIVE_TABS.calendar.route}>
          <NativeTabs.Trigger.Icon sf={DAYFRAME_NATIVE_TABS.calendar.symbol} />
          <NativeTabs.Trigger.Label>{DAYFRAME_NATIVE_TABS.calendar.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name={DAYFRAME_NATIVE_TABS.reports.route}>
          <NativeTabs.Trigger.Icon sf={DAYFRAME_NATIVE_TABS.reports.symbol} />
          <NativeTabs.Trigger.Label>{DAYFRAME_NATIVE_TABS.reports.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </DayframeDashboardProvider>
  );
}
