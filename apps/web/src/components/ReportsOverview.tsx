import { DayframeIcon } from "@/components/blocks/DayframeIcon";
import type { CSSProperties } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { formatDuration, formatSourceLabel } from "@/lib/format";
import {
  buildReportTrendSeries,
  percentageOf
} from "@/lib/report-calculations";
import { reportsHref } from "@/lib/report-filters";
import type { ReportBreakdownRow, ReportResult } from "@/lib/report-service";


/**
 * The analysis below the Blocks top: the daily trend for ranges without a blocks card (15a), the
 * exact activity table (the donut and its rows are "Where it went", 15b-2), tags and the secondary
 * breakdowns.
 */
export function ReportsOverview({ report, showTrend = true }: { report: ReportResult; showTrend?: boolean }) {
  return (
    <>
      {showTrend ? <DailyTrend report={report} /> : null}

      <div className="report-analysis-grid">
        <section className="fill-group-surface report-allocation" aria-labelledby="report-allocation-title">
          <header className="report-section-header">
            <div>
              <h2 id="report-allocation-title">Time by activity</h2>
              <p>Overlapping blocks count in each activity, the same rule as the total.</p>
            </div>
          </header>
          <AccessibleBreakdownTable caption="Exact time by activity" rows={report.byCategory} totalSeconds={report.totalSeconds} />
        </section>
        <TagBreakdown report={report} />
      </div>

      <SecondaryInsights report={report} />
    </>
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
        <strong className="df-tnum">{formatDuration(report.totalLoggedSeconds)}</strong>
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
                aria-label={`${point.label}: ${formatDuration(point.seconds)} logged`}
                title={`${point.label}: ${formatDuration(point.seconds)} logged`}
              >
                <div className="report-trend-track">
                  <span style={{ height: `${height}%` }} />
                </div>
                <strong>{point.label}</strong>
                <em className="df-tnum">{formatDuration(point.seconds)}</em>
              </div>
            );
          })}
        </div>
      </div>

      <details className="report-data-table">
        <summary>View exact trend data</summary>
        <div className="report-data-table-scroll">
          <table>
            <caption>Exact time logged for each {trend.granularity}, overlaps included</caption>
            <thead><tr><th>Period</th><th>Time logged</th></tr></thead>
            <tbody>
              {trend.points.map((point) => (
                <tr key={point.key}>
                  <td>{point.label}</td>
                  <td>{formatDuration(point.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function TagBreakdown({ report }: { report: ReportResult }) {
  return (
    <section className="fill-group-surface report-ranked-card" aria-labelledby="report-tags-title">
      <header className="report-section-header">
        <div>
          <h2 id="report-tags-title">Tags</h2>
          <p>Blocks can contain multiple tags, so tag totals may overlap.</p>
        </div>
        <DayframeIcon glyph="tag" size={19}/>
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
              <small>{percentageOf(row.seconds, report.totalSeconds)}% · {row.entryCount} {row.entryCount === 1 ? "block" : "blocks"}</small>
              <span className="report-ranked-track" aria-hidden="true">
                <i style={{ width: `${percentageOf(row.seconds, report.totalSeconds)}%` }} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyAnalysis title="No tags in this result" body="Tagged blocks will appear here when they match the selected filters." />
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
          <thead><tr><th>Name</th><th>Duration</th><th>Share</th><th>Blocks</th></tr></thead>
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
