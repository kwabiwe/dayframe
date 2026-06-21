import { PageHeader } from "@/components/PageHeader";
import { ReportBars } from "@/components/ReportBars";
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
        description="Compare tracked time by project, client, category, tag, source and place."
      />
      <div className="grid gap-5 px-5 py-6 md:grid-cols-2 md:px-8 xl:grid-cols-3">
        <ReportBars title="By project" rows={reports.byProject} />
        <ReportBars title="By client" rows={reports.byClient} />
        <ReportBars title="By category" rows={reports.byCategory} />
        <ReportBars title="By tag" rows={reports.byTag} />
        <ReportBars title="By source" rows={reports.bySource} />
        <ReportBars title="By place" rows={reports.byPlace} />
      </div>
    </>
  );
}
