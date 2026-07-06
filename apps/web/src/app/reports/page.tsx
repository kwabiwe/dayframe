import { PageHeader } from "@/components/PageHeader";
import { ReportBars } from "@/components/ReportBars";
import { ReportsOverview } from "@/components/ReportsOverview";
import { resolvePageSession } from "@/lib/auth/server";
import { getReports } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await resolvePageSession();
  const reports = await getReports(session);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Compare tracked time by category, source and place."
      />
      <div className="reports-page px-5 py-6 md:px-8">
        <ReportsOverview categories={reports.byCategory} weekSeries={reports.weekSeries} />
        <div className="reports-list-grid">
          <ReportBars title="By category" rows={reports.byCategory} />
          <ReportBars title="By source" rows={reports.bySource} />
          <ReportBars title="By place" rows={reports.byPlace} />
        </div>
      </div>
    </>
  );
}
