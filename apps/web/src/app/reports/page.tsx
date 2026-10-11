import Link from "next/link";
import { redirect } from "next/navigation";
import { Download } from "lucide-react";
import { ReportDetailsTable } from "@/components/ReportDetailsTable";
import { ReportFiltersPanel } from "@/components/ReportFiltersPanel";
import { ReportRangeControls } from "@/components/ReportRangeControls";
import { ReportsOverview } from "@/components/ReportsOverview";
import { ReportsBlocksPanel } from "@/components/reports/ReportsBlocksPanel";
import { ReportsTop } from "@/components/reports/ReportsTop";
import { springLinearEasing } from "@/lib/blocks-motion";
import { formatDuration } from "@/lib/format";
import { buildReportCategoryAllocation } from "@/lib/report-calculations";
import { resolvePageSession } from "@/lib/auth/server";
import { getUser } from "@/lib/queries";
import { filtersForPreset, parseReportQueryInput, reportExportHref, reportsHref } from "@/lib/report-filters";
import { getReports } from "@/lib/report-service";
import { reportBlocksLayout, reportBlocksModel } from "@/lib/reports-blocks";

export const dynamic = "force-dynamic";

/**
 * Reports in Blocks (parity step 15a): the page head with Week · Month and Export, the range
 * controls (every preset, custom dates, previous / next), filters, the hero tiles and the range in
 * activity blocks, then the analysis and the entries table.
 */
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

  const [report, user] = await Promise.all([getReports(session, input), getUser(session)]);
  const preset = report.appliedFilters.range;
  const allocation = buildReportCategoryAllocation(report.byCategory, report.totalSeconds, 8);
  const slices = allocation.visibleCategories.map((category) => ({
    id: category.id,
    categoryIds: category.categoryIds,
    name: category.name,
    color: category.color,
    seconds: category.seconds,
    percentage: category.percentage,
    isUncategorized: category.isUncategorized,
    href: reportsHref(report.appliedFilters, { categories: category.categoryIds, page: 1 })
  }));

  return (
    <div className="df-reports-page">
      <div className="df-page-head">
        <div>
          <h1>Reports</h1>
          <p>{report.range.label}</p>
        </div>
        <div className="df-page-head-actions">
          <nav aria-label="Report range" className="df-seg">
            <Link aria-current={preset === "this-week" ? "page" : undefined} href={reportsHref(filtersForPreset(report.appliedFilters, "this-week"))}>
              Week
            </Link>
            <Link aria-current={preset === "this-month" ? "page" : undefined} href={reportsHref(filtersForPreset(report.appliedFilters, "this-month"))}>
              Month
            </Link>
          </nav>
          <Link aria-label="Export filtered report as CSV" className="df-rbtn df-rbtn--sm" href={reportExportHref(report.appliedFilters)}>
            <Download aria-hidden="true" size={16} />
            Export
          </Link>
        </div>
      </div>
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
      <ReportsTop dailyGoalMinutes={user.dailyGoalMinutes} report={report} />
      <ReportsBlocksPanel
        blocks={reportBlocksModel(report, formatDuration)}
        land={springLinearEasing("land")}
        slices={slices}
        totalLabel={preset === "this-week" ? "logged this week" : preset === "this-month" ? "logged this month" : "logged in this range"}
        totalSeconds={report.totalSeconds}
      />
      {report.additionalOverlappingActivitySeconds > 0 ? (
        <p className="report-metric-explainer">
          Total logged counts every block in full; Total framed (time covered) counts overlapping time once.
        </p>
      ) : null}
      <ReportsOverview report={report} showTrend={reportBlocksLayout(report) === null} />
      <ReportDetailsTable report={report} />
    </div>
  );
}
