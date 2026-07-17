import { PageHeader } from "@/components/PageHeader";
import { ReportBars } from "@/components/ReportBars";
import { ReportsOverview } from "@/components/ReportsOverview";
import { ReportRangeControls } from "@/components/ReportRangeControls";
import { resolvePageSession } from "@/lib/auth/server";
import { getBootstrapData, getReports } from "@/lib/queries";
import { resolveReportRange } from "@/lib/report-range";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams
}: {
  searchParams: Promise<{ period?: string; start?: string; end?: string }>;
}) {
  const session = await resolvePageSession();
  const params = await searchParams;
  const range = resolveReportRange(params);
  const [reports, bootstrap] = await Promise.all([getReports(session, range), getBootstrapData(session)]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Compare tracked time by category, source and place."
      />
      <div className="reports-page px-5 py-6 md:px-8">
        <ReportRangeControls range={range} />
        <ReportsOverview
          categories={reports.byCategory}
          weekSeries={reports.weekSeries}
          rangeLabel={range.label}
          goalMinutes={range.period === "day" ? bootstrap.user.dailyGoalMinutes : range.period === "week" ? bootstrap.user.weeklyGoalMinutes : null}
        />
        <div className="reports-list-grid">
          <ReportBars title="By category" rows={reports.byCategory} />
          <ReportBars title="By source" rows={reports.bySource} />
          <ReportBars title="By place" rows={reports.byPlace} />
        </div>
      </div>
    </>
  );
}
