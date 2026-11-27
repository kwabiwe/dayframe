import { useContext } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { DayframeDashboardProvider, useDashboardOpenCalendarToday } from "@/components/DayframeDashboard";
import { ReportsSheetPortalContext } from "@/components/reports/ReportsSheetPortal";
import { useMobileTheme } from "@/lib/mobileTheme";
import { DAYFRAME_NATIVE_TABS, DAYFRAME_NATIVE_TAB_MINIMIZE_BEHAVIOR } from "@/lib/nativeTabs";
import { playOrbSupported } from "@/lib/playOrb";
import { requestPlayOrbTap, usePlayOrbRunning } from "@/lib/playOrbBridge";

// Generated from the shared glyphs by scripts/generate-icons.mjs (@2x/@3x picked by scale).
const DAYFRAME_TAB_ICON_IMAGES = {
  today: require("../../assets/tab-icons/today.png"),
  calendar: require("../../assets/tab-icons/calendar.png"),
  reports: require("../../assets/tab-icons/reports.png"),
  orb: require("../../assets/tab-icons/orb.png")
};

const PLAY_ORB_SLOT = playOrbSupported({
  OS: Platform.OS,
  Version: Platform.Version,
  isPad: Platform.OS === "ios" && Platform.isPad
});
// UIKit 27 separates a native search tab, while the legacy search item appears inline.
const MODERN_PLAY_ORB_SLOT = PLAY_ORB_SLOT && Number.parseInt(String(Platform.Version), 10) >= 27;
const BLANK_ORB_SLOT_ICON = require("../../assets/tab-icons/orb-slot.png");

export default function DashboardTabsLayout() {
  return (
    <DayframeDashboardProvider>
      <DashboardTabs />
    </DayframeDashboardProvider>
  );
}

function DashboardTabs() {
  const { theme } = useMobileTheme();
  const reportsSheetPortal = useContext(ReportsSheetPortalContext);
  const timerRunning = usePlayOrbRunning();
  // The Calendar tab always opens today.
  const openCalendarToday = useDashboardOpenCalendarToday();

  return (
    <>
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
        <NativeTabs.Trigger
          listeners={{ tabPress: () => openCalendarToday?.() }}
          name={DAYFRAME_NATIVE_TABS.calendar.route}
        >
          <NativeTabs.Trigger.Icon src={DAYFRAME_TAB_ICON_IMAGES.calendar} renderingMode="template" />
          <NativeTabs.Trigger.Label>{DAYFRAME_NATIVE_TABS.calendar.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name={DAYFRAME_NATIVE_TABS.reports.route}>
          <NativeTabs.Trigger.Icon src={DAYFRAME_TAB_ICON_IMAGES.reports} renderingMode="template" />
          <NativeTabs.Trigger.Label>{DAYFRAME_NATIVE_TABS.reports.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        {/* Reserve a separate circle for the coral orb. On iOS 27 the native search role and
            automatic activation give the item prominent placement. Selection stays disabled,
            so the slot does not open a search screen. Keep its spoken label for VoiceOver. */}
        <NativeTabs.Trigger
          // A system "search" item keeps its own title, so VoiceOver needs the label set here.
          accessibilityLabel={timerRunning ? "Stop recording" : "Start a block"}
          disabled
          // On iPad or before iOS 26 there is no orb, so there is no slot either. Fixed for the
          // process: toggling a trigger's visibility re-keys the tab view and remounts every tab.
          hidden={!PLAY_ORB_SLOT}
          listeners={{
            tabPress: () => {
              if (!MODERN_PLAY_ORB_SLOT) {
                requestPlayOrbTap();
                return;
              }
              void AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
                if (enabled) requestPlayOrbTap();
              }).catch(() => undefined);
            }
          }}
          name={DAYFRAME_NATIVE_TABS.orb.route}
          role="search"
          unstable_nativeProps={MODERN_PLAY_ORB_SLOT
            ? { ios: { role: "search", automaticallyActivatesSearch: true } }
            : undefined}
        >
          <NativeTabs.Trigger.Icon
            src={MODERN_PLAY_ORB_SLOT ? BLANK_ORB_SLOT_ICON : DAYFRAME_TAB_ICON_IMAGES.orb}
            renderingMode="template"
          />
          <NativeTabs.Trigger.Label hidden={MODERN_PLAY_ORB_SLOT}>
            {timerRunning ? "Stop recording" : "Start a block"}
          </NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </>
  );
}
