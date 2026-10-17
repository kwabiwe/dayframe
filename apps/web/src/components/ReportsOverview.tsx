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
import type { DayframeGlyph } from "@dayframe/shared";
import { DayframeIcon } from "@/components/blocks/DayframeIcon";


/**
 * The analysis below the Blocks top: the daily trend for ranges without a blocks card (15a), then
 * Tags and More insights, both collapsed by default (UIA-303). The exact activity table is a
 * disclosure under "Where it went"; the old "Time by activity" card is gone.
 */
export function ReportsOverview({ report, showTrend = true }: { report: ReportResult; showTrend?: boolean }) {
  return (
    <>
      {showTrend ? <DailyTrend report={report} /> : null}

      <TagBreakdown report={report} />

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
    <section className="df-card report-trend" aria-labelledby="report-trend-title">
      <div className="df-card-head">
        <h2 id="report-trend-title">Daily trend</h2>
        <span className="df-faint df-tnum">{formatDuration(report.totalLoggedSeconds)}</span>
      </div>
      <p className="df-muted report-trend-note">
        {trend.granularity === "day"
          ? "One bar for each calendar day in the selected range."
          : "Ranges longer than 62 days are grouped into seven-day bars for readability."}
      </p>

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
    <details className="df-card df-report-more report-tags" aria-labelledby="report-tags-title">
      <summary className="df-card-head">
        <h2 id="report-tags-title">Tags</h2>
        <span className="df-faint">
          {report.byTag.length > 0
            ? `${report.byTag.length} ${report.byTag.length === 1 ? "tag" : "tags"} · totals may overlap`
            : "No tags in this result"}
        </span>
        <ChevronIndicator />
      </summary>
      {report.byTag.length > 0 ? (
        <ul aria-label="Time by tag" className="df-rows">
          {report.byTag.map((row) => (
            <RankRow
              glyph="tag"
              href={reportsHref(report.appliedFilters, { tags: [row.id], page: 1 })}
              key={row.id}
              label={`Filter by tag ${row.name}, ${formatDuration(row.seconds)}`}
              name={`#${row.name}`}
              row={row}
              totalSeconds={report.totalSeconds}
            />
          ))}
        </ul>
      ) : (
        <p className="df-muted">No tagged blocks yet. Add #tags to a block and they’re totalled here.</p>
      )}
      <AccessibleBreakdownTable caption="Exact tag totals; totals may overlap" rows={report.byTag} totalSeconds={report.totalSeconds} />
    </details>
  );
}

function SecondaryInsights({ report }: { report: ReportResult }) {
  return (
    <details className="df-card df-report-more" aria-labelledby="report-more-title">
      <summary className="df-card-head">
        <h2 id="report-more-title">More insights</h2>
        <span className="df-faint">Places and sources</span>
        <ChevronIndicator />
      </summary>
      <div className="df-report-more-grid">
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
    <section aria-labelledby={`report-${filterKey}-title`}>
      <h3 className="df-eyebrow" id={`report-${filterKey}-title`}>{title}</h3>
      {rows.length > 0 ? (
        <ul aria-label={`Time by ${title.toLocaleLowerCase()}`} className="df-rows">
          {rows.map((row) => {
            const name = friendlySources ? formatSourceLabel(row.name) : row.name;
            return (
              <RankRow
                glyph={filterKey === "places" ? "map-pin" : "inbox"}
                href={reportsHref(report.appliedFilters, { [filterKey]: [row.id], page: 1 })}
                key={row.id}
                label={`Filter by ${filterKey === "places" ? "place" : "source"} ${name}, ${formatDuration(row.seconds)}`}
                name={name}
                row={row}
                totalSeconds={report.totalSeconds}
              />
            );
          })}
        </ul>
      ) : <p className="df-muted">No {title.toLocaleLowerCase()} in this result yet.</p>}
      <AccessibleBreakdownTable caption={`Exact ${title.toLocaleLowerCase()} totals`} rows={rows} totalSeconds={report.totalSeconds} friendlySources={friendlySources} />
    </section>
  );
}

/** A ranked total as a Blocks row (WUI-031): glyph tile, name, share and blocks, then the duration;
 *  the row filters the report to it. */
function RankRow({
  glyph,
  href,
  label,
  name,
  row,
  totalSeconds
}: {
  glyph: DayframeGlyph;
  href: string;
  label: string;
  name: string;
  row: ReportBreakdownRow;
  totalSeconds: number;
}) {
  return (
    <li className="df-erow df-rank-row">
      <Link aria-label={label} className="df-erow-main" href={href}>
        <span aria-hidden="true" className="df-erow-block">
          <DayframeIcon glyph={glyph} size={16} />
        </span>
        <span className="df-erow-text">
          <b>{name}</b>
          <span>{percentageOf(row.seconds, totalSeconds)}% · {row.entryCount} {row.entryCount === 1 ? "block" : "blocks"}</span>
        </span>
        <span className="df-erow-dur">{formatDuration(row.seconds)}</span>
      </Link>
    </li>
  );
}

export function AccessibleBreakdownTable({
  caption,
  friendlySources = false,
  rows,
  summary = "View exact data",
  totalSeconds
}: {
  caption: string;
  friendlySources?: boolean;
  summary?: string;
  rows: ReportBreakdownRow[];
  totalSeconds: number;
}) {
  if (rows.length === 0) return null;
  return (
    <details className="report-data-table">
      <summary>{summary}</summary>
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

function ChevronIndicator() {
  return <ChevronDown className="report-chevron" aria-hidden="true" size={18} />;
}

function buildTrendSummary(points: Array<{ label: string; seconds: number }>) {
  return points.length === 0
    ? "No tracked time in this period."
    : points.map((point) => `${point.label} ${formatDuration(point.seconds)}`).join(", ");
}
