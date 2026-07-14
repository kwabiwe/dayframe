import { DayframeDashboardScreen } from "@/components/DayframeDashboard";
import { DAYFRAME_NATIVE_TABS } from "@/lib/nativeTabs";

export default function ReportsScreen() {
  return <DayframeDashboardScreen tab={DAYFRAME_NATIVE_TABS.reports.dashboardTab} />;
}
