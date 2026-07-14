import { DayframeDashboardScreen } from "@/components/DayframeDashboard";
import { DAYFRAME_NATIVE_TABS } from "@/lib/nativeTabs";

export default function CalendarScreen() {
  return <DayframeDashboardScreen tab={DAYFRAME_NATIVE_TABS.calendar.dashboardTab} />;
}
