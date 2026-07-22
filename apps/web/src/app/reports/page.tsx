import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ReportDetailsTable } from "@/components/ReportDetailsTable";
import { ReportFiltersPanel } from "@/components/ReportFiltersPanel";
import { ReportRangeControls } from "@/components/ReportRangeControls";
import { ReportsOverview } from "@/components/ReportsOverview";
import { resolvePageSession } from "@/lib/auth/server";
import { parseReportQueryInput, reportExportHref, reportsHref } from "@/lib/report-filters";
import { getReports } from "@/lib/report-service";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await resolvePageSession();
  const params = await searchParams;
  const input = parseReportQueryInput(params);

  if (!params.range && params.period) {
    redirect(reportsHref(input.filters));
  }

  const report = await getReports(session, input);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Understand how much time you tracked, where it went, and which entries make up the total."
        action={(
          <Link className="ui-button ui-button-secondary" href={reportExportHref(report.appliedFilters)} aria-label="Export filtered report as CSV">
            <Download aria-hidden="true" size={17} />
            Export CSV
          </Link>
        )}
      />
      <div className="reports-page px-5 pb-8 md:px-8">
        <ReportRangeControls
          key={`range-${report.appliedFilters.range}-${report.appliedFilters.from}-${report.appliedFilters.to}`}
          filters={report.appliedFilters}
          range={report.range}
        />
        <ReportFiltersPanel
          key={`filters-${JSON.stringify(report.appliedFilters)}`}
          filters={report.appliedFilters}
          options={report.filterOptions}
          rangeLabel={report.range.label}
        />
        <ReportsOverview report={report} />
        <ReportDetailsTable report={report} />
      </div>
    </>
  );
}
