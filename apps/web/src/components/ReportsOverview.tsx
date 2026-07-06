import { paletteColorFor } from "@dayframe/shared";
import { formatDuration } from "@/lib/format";
import type { ReportRow, ReportSeriesPoint } from "@/lib/queries";

type Segment = {
  id: string;
  name: string;
  seconds: number;
  color: string;
};

const maxDonutSegments = 6;

export function ReportsOverview({
  categories,
  weekSeries
}: {
  categories: ReportRow[];
  weekSeries: ReportSeriesPoint[];
}) {
  const categorySegments = categories
    .filter((row) => row.seconds > 0)
    .map<Segment>((row) => ({
      id: row.id,
      name: row.name,
      seconds: row.seconds,
      color: paletteColorFor(row.color, row.name)
    }));
  const totalSeconds = categorySegments.reduce((sum, segment) => sum + segment.seconds, 0);
  const visibleSegments = buildVisibleSegments(categorySegments);
  const weekTotal = weekSeries.reduce((sum, point) => sum + point.seconds, 0);
  const weekMax = Math.max(...weekSeries.map((point) => point.seconds), 1);
  const donutBackground = buildDonutBackground(visibleSegments, totalSeconds);
  const topSegment = categorySegments[0];

  return (
    <section className="industrial-panel reports-overview">
      <div className="report-card-header reports-overview-header">
        <div>
          <h2 className="text-base font-semibold">Category breakdown</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            See where tracked time has gone by category, then compare this week by day.
          </p>
        </div>
        <div className="reports-total-pill">
          <span>Total tracked</span>
          <strong>{formatDuration(totalSeconds)}</strong>
        </div>
      </div>

      <div className="reports-overview-grid">
        <div className="reports-donut-panel">
          <div
            className={`reports-donut${totalSeconds === 0 ? " is-empty" : ""}`}
            style={{ background: donutBackground }}
            aria-label={`Category total ${formatDuration(totalSeconds)}`}
          >
            <div className="reports-donut-center">
              <span>Total</span>
              <strong>{formatDuration(totalSeconds)}</strong>
            </div>
          </div>
        </div>

        <div className="reports-legend">
          {totalSeconds === 0 ? (
            <div className="reports-empty-state">
              <strong>No tracked time yet</strong>
              <span>Completed time entries will appear here by category.</span>
            </div>
          ) : (
            <>
              <div className="reports-lead-stat">
                <span>Largest category</span>
                <strong>{topSegment?.name ?? "Uncategorized"}</strong>
              </div>
              <div className="space-y-3">
                {visibleSegments.map((segment) => {
                  const share = Math.round((segment.seconds / totalSeconds) * 100);
                  return (
                    <div key={segment.id} className="reports-legend-row">
                      <span
                        className="reports-color-dot"
                        style={{ backgroundColor: segment.color }}
                      />
                      <span className="min-w-0 truncate font-medium">{segment.name}</span>
                      <span className="tabular text-[var(--muted)]">
                        {formatDuration(segment.seconds)} / {share}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="reports-week">
          <div className="reports-week-header">
            <div>
              <h3>This week</h3>
              <p>{formatDuration(weekTotal)} tracked</p>
            </div>
          </div>
          <div className="reports-week-bars" aria-label="Tracked time by day this week">
            {weekSeries.map((point) => {
              const height = weekTotal > 0 ? Math.max(8, (point.seconds / weekMax) * 100) : 4;
              return (
                <div key={point.key} className="reports-week-bar">
                  <div className="reports-week-bar-track">
                    <span
                      style={{ height: `${height}%` }}
                      title={`${point.label}: ${formatDuration(point.seconds)}`}
                    />
                  </div>
                  <strong>{point.label}</strong>
                  <em>{formatDuration(point.seconds)}</em>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function buildVisibleSegments(segments: Segment[]) {
  if (segments.length <= maxDonutSegments) return segments;

  const visible = segments.slice(0, maxDonutSegments);
  const remaining = segments.slice(maxDonutSegments);
  const otherSeconds = remaining.reduce((sum, segment) => sum + segment.seconds, 0);

  return [
    ...visible,
    {
      id: "other-categories",
      name: "Other",
      seconds: otherSeconds,
      color: paletteColorFor("graphite", "Other")
    }
  ];
}

function buildDonutBackground(segments: Segment[], totalSeconds: number) {
  if (totalSeconds <= 0) {
    return "conic-gradient(from -90deg, color-mix(in srgb, var(--line) 62%, transparent) 0% 100%)";
  }

  let cursor = 0;
  const stops = segments.map((segment) => {
    const start = cursor;
    const size = (segment.seconds / totalSeconds) * 100;
    cursor += size;
    return `${segment.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });

  return `conic-gradient(from -90deg, ${stops.join(", ")})`;
}
