import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, ChevronDown, Clock3, Tags } from "lucide-react";
import { ReportDonutSegment } from "@/components/ReportDonutSegment";
import { categoryDisplay } from "@/lib/display";
import { formatDuration, formatSourceLabel } from "@/lib/format";
import {
  buildComparisonCopy,
  buildReportCategoryAllocation,
  buildReportTrendSeries,
  percentageOf
} from "@/lib/report-calculations";
import { reportsHref } from "@/lib/report-filters";
import type { ReportBreakdownRow, ReportResult } from "@/lib/report-service";

const donutRadius = 44;
const donutCircumference = 2 * Math.PI * donutRadius;

export function ReportsOverview({ report }: { report: ReportResult }) {
  const comparison = buildComparisonCopy(report.comparison, formatDuration);
  const allocation = buildReportCategoryAllocation(report.byCategory, report.totalSeconds);

  return (
    <>
      <section className="report-summary-grid" aria-label="Report summary">
        <SummaryMetric label="Total tracked" value={formatDuration(report.totalSeconds)} detail={`Across ${report.range.dayCount} calendar day${report.range.dayCount === 1 ? "" : "s"}`} icon={Clock3} />
        <SummaryMetric label="Daily average" value={formatDuration(report.dailyAverageSeconds)} detail="Across the selected calendar range" icon={CalendarDays} />
        <SummaryMetric label="Active days" value={`${report.activeDayCount}`} detail={`${report.range.dayCount - report.activeDayCount} day${report.range.dayCount - report.activeDayCount === 1 ? "" : "s"} with no tracked time`} icon={CalendarDays} />
        <SummaryMetric label="Previous period" value={comparison.value} detail={comparison.detail} icon={ArrowRight} />
      </section>

      <DailyTrend report={report} />

      <div className="report-analysis-grid">
        <CategoryAllocation report={report} allocation={allocation} />
        <TagBreakdown report={report} />
      </div>

      <SecondaryInsights report={report} />
    </>
  );
}

function SummaryMetric({
  detail,
  icon: Icon,
  label,
  value
}: {
  detail: string;
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <article className="fill-group-surface report-summary-card">
      <div>
        <span>{label}</span>
        <Icon aria-hidden="true" size={17} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function DailyTrend({ report }: { report: ReportResult }) {
  const trend = buildReportTrendSeries(report.dailySeries);
  const maxSeconds = Math.max(1, ...trend.points.map((point) => point.seconds));
  const scrollable = trend.points.length > 31;
  const chartStyle = {
    "--trend-columns": `${trend.points.length}`,
    "--trend-min-width": scrollable ? `${trend.points.length * 34}px` : "100%"
  } as CSSProperties;

  return (
    <section className="fill-group-surface report-trend" aria-labelledby="report-trend-title">
      <header className="report-section-header">
        <div>
          <h2 id="report-trend-title">Daily trend</h2>
          <p>
            {trend.granularity === "day"
              ? "One bar for each calendar day in the selected range."
              : "Ranges longer than 62 days are grouped into seven-day bars for readability."}
          </p>
        </div>
        <strong>{formatDuration(report.totalSeconds)}</strong>
      </header>

      <div className={`report-trend-scroll${scrollable ? " is-scrollable" : ""}`}>
        <div className="report-trend-bars" style={chartStyle} role="img" aria-label={buildTrendSummary(trend.points)}>
          {trend.points.map((point) => {
            const height = point.seconds > 0 ? Math.max(5, (point.seconds / maxSeconds) * 100) : 0;
            return (
              <div
                className="report-trend-column"
                key={point.key}
                tabIndex={0}
                aria-label={`${point.label}: ${formatDuration(point.seconds)}`}
                title={`${point.label}: ${formatDuration(point.seconds)}`}
              >
                <div className="report-trend-track">
                  <span style={{ height: `${height}%` }} />
                </div>
                <strong>{point.label}</strong>
                <em>{formatDuration(point.seconds)}</em>
              </div>
            );
          })}
        </div>
      </div>

      <details className="report-data-table">
        <summary>View exact trend data</summary>
        <div className="report-data-table-scroll">
          <table>
            <caption>Exact tracked time for each {trend.granularity}</caption>
            <thead><tr><th>Period</th><th>Tracked time</th></tr></thead>
            <tbody>
              {trend.points.map((point) => (
                <tr key={point.key}><td>{point.label}</td><td>{formatDuration(point.seconds)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function CategoryAllocation({
  allocation,
  report
}: {
  allocation: ReturnType<typeof buildReportCategoryAllocation>;
  report: ReportResult;
}) {
  const slices = allocation.visibleCategories.map((category, index, categories) => {
    const consumedSeconds = categories
      .slice(0, index)
      .reduce((sum, previousCategory) => sum + previousCategory.seconds, 0);
    const fraction = allocation.totalSeconds > 0 ? category.seconds / allocation.totalSeconds : 0;
    return {
      ...category,
      dash: fraction * donutCircumference,
      offset: -(consumedSeconds / Math.max(1, allocation.totalSeconds)) * donutCircumference,
      color: categoryDisplay(category.name, category.color).color,
      href: reportsHref(report.appliedFilters, { categories: category.categoryIds, page: 1 })
    };
  });

  return (
    <section className="fill-group-surface report-allocation" aria-labelledby="report-allocation-title">
      <header className="report-section-header">
        <div>
          <h2 id="report-allocation-title">Category allocation</h2>
          <p>Category totals partition all tracked time.</p>
        </div>
      </header>

      {report.totalSeconds > 0 ? (
        <div className="report-allocation-layout">
          <figure className="report-donut-figure">
            <svg viewBox="0 0 120 120" className="report-donut" role="img" aria-labelledby="report-donut-title report-donut-desc">
              <title id="report-donut-title">Category allocation</title>
              <desc id="report-donut-desc">{buildAllocationSummary(report.byCategory, report.totalSeconds)}</desc>
              <circle className="report-donut-track" cx="60" cy="60" r={donutRadius} />
              {slices.map((slice) => (
                <ReportDonutSegment
                  key={slice.id}
                  ariaLabel={`Filter by ${slice.name}, ${formatDuration(slice.seconds)}`}
                  className={`report-donut-segment${slice.isUncategorized ? " is-uncategorized" : ""}`}
                  dash={slice.dash}
                  href={slice.href}
                  offset={slice.offset}
                  radius={donutRadius}
                  stroke={slice.color}
                  totalLength={donutCircumference}
                />
              ))}
            </svg>
            <figcaption>
              <span>Total</span>
              <strong>{formatDuration(report.totalSeconds)}</strong>
            </figcaption>
          </figure>

          <div className="report-allocation-legend" aria-label="Category allocation actions">
            {slices.map((slice) => (
              <Link key={slice.id} href={slice.href} className="report-allocation-row">
                <span
                  className={`report-category-marker${slice.isUncategorized ? " is-uncategorized" : ""}`}
                  style={{ "--category-color": slice.color } as CSSProperties}
                  aria-hidden="true"
                />
                <span>{slice.name}</span>
                <strong>{formatDuration(slice.seconds)}</strong>
                <small>{slice.percentage}%</small>
                <ArrowRight aria-hidden="true" size={15} />
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <EmptyAnalysis title="No category time" body="Change the filters or track time to build an allocation." />
      )}

      <AccessibleBreakdownTable caption="Exact category allocation" rows={report.byCategory} totalSeconds={report.totalSeconds} />
    </section>
  );
}

function TagBreakdown({ report }: { report: ReportResult }) {
  return (
    <section className="fill-group-surface report-ranked-card" aria-labelledby="report-tags-title">
      <header className="report-section-header">
        <div>
          <h2 id="report-tags-title">Tags</h2>
          <p>Entries can contain multiple tags, so tag totals may overlap.</p>
        </div>
        <Tags aria-hidden="true" size={19} />
      </header>
      {report.byTag.length > 0 ? (
        <div className="report-ranked-list">
          {report.byTag.map((row) => (
            <Link
              key={row.id}
              href={reportsHref(report.appliedFilters, { tags: [row.id], page: 1 })}
              className="report-ranked-row"
              aria-label={`Filter by tag ${row.name}, ${formatDuration(row.seconds)}`}
            >
              <span className="report-ranked-name">{row.name}</span>
              <strong>{formatDuration(row.seconds)}</strong>
              <small>{percentageOf(row.seconds, report.totalSeconds)}% · {row.entryCount} entr{row.entryCount === 1 ? "y" : "ies"}</small>
              <span className="report-ranked-track" aria-hidden="true">
                <i style={{ width: `${percentageOf(row.seconds, report.totalSeconds)}%` }} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyAnalysis title="No tags in this result" body="Tagged entries will appear here when they match the selected filters." />
      )}
      <AccessibleBreakdownTable caption="Exact tag totals; totals may overlap" rows={report.byTag} totalSeconds={report.totalSeconds} />
    </section>
  );
}

function SecondaryInsights({ report }: { report: ReportResult }) {
  return (
    <details className="fill-group-surface report-secondary-insights">
      <summary>
        <span>
          <strong>More insights</strong>
          <small>Place and source breakdowns</small>
        </span>
        <ChevronIndicator />
      </summary>
      <div className="report-secondary-grid">
        <RankedBreakdown title="Places" rows={report.byPlace} report={report} filterKey="places" />
        <RankedBreakdown title="Sources" rows={report.bySource} report={report} filterKey="sources" friendlySources />
      </div>
    </details>
  );
}

function RankedBreakdown({
  filterKey,
  friendlySources = false,
  report,
  rows,
  title
}: {
  filterKey: "places" | "sources";
  friendlySources?: boolean;
  report: ReportResult;
  rows: ReportBreakdownRow[];
  title: string;
}) {
  return (
    <section className="report-secondary-card" aria-labelledby={`report-${filterKey}-title`}>
      <h3 id={`report-${filterKey}-title`}>{title}</h3>
      {rows.length > 0 ? (
        <div className="report-ranked-list is-secondary">
          {rows.map((row) => {
            const name = friendlySources ? formatSourceLabel(row.name) : row.name;
            return (
              <Link key={row.id} href={reportsHref(report.appliedFilters, { [filterKey]: [row.id], page: 1 })} className="report-ranked-row">
                <span className="report-ranked-name">{name}</span>
                <strong>{formatDuration(row.seconds)}</strong>
                <small>{percentageOf(row.seconds, report.totalSeconds)}%</small>
                <span className="report-ranked-track" aria-hidden="true"><i style={{ width: `${percentageOf(row.seconds, report.totalSeconds)}%` }} /></span>
              </Link>
            );
          })}
        </div>
      ) : <p className="report-secondary-empty">No matching {title.toLocaleLowerCase()}.</p>}
      <AccessibleBreakdownTable caption={`Exact ${title.toLocaleLowerCase()} totals`} rows={rows} totalSeconds={report.totalSeconds} friendlySources={friendlySources} />
    </section>
  );
}

function AccessibleBreakdownTable({
  caption,
  friendlySources = false,
  rows,
  totalSeconds
}: {
  caption: string;
  friendlySources?: boolean;
  rows: ReportBreakdownRow[];
  totalSeconds: number;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="report-data-table">
      <summary>View exact data</summary>
      <div className="report-data-table-scroll">
        <table>
          <caption>{caption}</caption>
          <thead><tr><th>Name</th><th>Duration</th><th>Share</th><th>Entries</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{friendlySources ? formatSourceLabel(row.name) : row.name}</td>
                <td>{formatDuration(row.seconds)}</td>
                <td>{percentageOf(row.seconds, totalSeconds)}%</td>
                <td>{row.entryCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function EmptyAnalysis({ body, title }: { body: string; title: string }) {
  return <div className="report-empty-analysis"><strong>{title}</strong><p>{body}</p></div>;
}

function ChevronIndicator() {
  return <ChevronDown className="report-chevron" aria-hidden="true" size={18} />;
}

function buildTrendSummary(points: Array<{ label: string; seconds: number }>) {
  return points.length === 0
    ? "No tracked time in this period."
    : points.map((point) => `${point.label} ${formatDuration(point.seconds)}`).join(", ");
}

function buildAllocationSummary(rows: ReportBreakdownRow[], totalSeconds: number) {
  if (totalSeconds <= 0) return "No tracked category time.";
  return `Category allocation totals ${formatDuration(totalSeconds)}. ${rows.map((row) => `${row.name} ${formatDuration(row.seconds)}, ${percentageOf(row.seconds, totalSeconds)}%`).join("; ")}.`;
}
