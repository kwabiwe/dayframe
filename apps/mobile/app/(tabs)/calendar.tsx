import { router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { DayframeDashboardScreen, useDashboardOpenCheckLink } from "@/components/DayframeDashboard";
import { DAYFRAME_NATIVE_TABS } from "@/lib/nativeTabs";

export default function CalendarScreen() {
  // An old Review link (`+native-intent`, step 15) arrives as `?check=<id>` or `?check=first`: Calendar › List opens
  // that "?" once, and the parameter is cleared so the same link opens it again next time.
  const { check } = useLocalSearchParams<{ check?: string }>();
  const openCheckLink = useDashboardOpenCheckLink();
  useEffect(() => {
    if (!check || !openCheckLink) return;
    openCheckLink(check);
    router.setParams({ check: undefined });
  }, [check, openCheckLink]);
  return <DayframeDashboardScreen tab={DAYFRAME_NATIVE_TABS.calendar.dashboardTab} />;
}
