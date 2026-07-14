import { DayframeDashboardScreen } from "@/components/DayframeDashboard";
import { DAYFRAME_NATIVE_TABS } from "@/lib/nativeTabs";

export default function TodayScreen() {
  return <DayframeDashboardScreen tab={DAYFRAME_NATIVE_TABS.today.dashboardTab} />;
}
