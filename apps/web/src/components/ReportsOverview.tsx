import { paletteCssColorFor } from "@dayframe/shared";
import { formatDuration } from "@/lib/format";
import type { ReportRow, ReportSeriesPoint } from "@/lib/queries";

type Segment = {
  id: string;
  name: string;
  seconds: number;
  color: string;
};

type DonutSlice = Segment & {
  fullCircle: boolean;
  path: string;
};

const maxDonutSegments = 6;
const donutCenter = 60;
const donutOuterRadius = 56;
const donutInnerRadius = 24;

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
      color: paletteCssColorFor(row.color, row.name)
    }));
  const totalSeconds = categorySegments.reduce((sum, segment) => sum + segment.seconds, 0);
  const visibleSegments = buildVisibleSegments(categorySegments);
  const weekTotal = weekSeries.reduce((sum, point) => sum + point.seconds, 0);
  const weekMax = Math.max(...weekSeries.map((point) => point.seconds), 1);
  const donutSlices = buildDonutSlices(visibleSegments, totalSeconds);
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
            role="img"
            aria-label={`Category total ${formatDuration(totalSeconds)}`}
          >
            <svg className="reports-donut-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
              <circle className="reports-donut-empty-ring" cx={donutCenter} cy={donutCenter} r={40} />
              {donutSlices.map((slice) =>
                slice.fullCircle ? (
                  <circle
                    key={slice.id}
                    className="reports-donut-full-ring"
                    cx={donutCenter}
                    cy={donutCenter}
                    r={40}
                    style={{ stroke: slice.color }}
                  />
                ) : (
                  <path
                    key={slice.id}
                    className="reports-donut-segment"
                    d={slice.path}
                    fill={slice.color}
                  />
                )
              )}
            </svg>
            <div className="reports-donut-center">
              <div className="reports-donut-center-inner">
                <span>Total</span>
                <strong>{formatDuration(totalSeconds)}</strong>
              </div>
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
          <div
            className="reports-week-bars"
            role="img"
            aria-label={`Tracked time this week: ${weekSeries
              .map((point) => `${point.label} ${formatDuration(point.seconds)}`)
              .join(", ")}`}
          >
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
      color: paletteCssColorFor("graphite", "Other")
    }
  ];
}

function buildDonutSlices(segments: Segment[], totalSeconds: number): DonutSlice[] {
  if (totalSeconds <= 0) return [];

  let cursor = -90;
  return segments.map((segment) => {
    const size = (segment.seconds / totalSeconds) * 360;
    const startAngle = cursor;
    const endAngle = cursor + size;
    cursor = endAngle;

    return {
      ...segment,
      fullCircle: size >= 359.99,
      path: size >= 359.99 ? "" : describeDonutSlice(startAngle, endAngle)
    };
  });
}

function describeDonutSlice(startAngle: number, endAngle: number) {
  const outerStart = pointOnCircle(donutOuterRadius, startAngle);
  const outerEnd = pointOnCircle(donutOuterRadius, endAngle);
  const innerEnd = pointOnCircle(donutInnerRadius, endAngle);
  const innerStart = pointOnCircle(donutInnerRadius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${donutOuterRadius} ${donutOuterRadius} 0 ${largeArcFlag} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${donutInnerRadius} ${donutInnerRadius} 0 ${largeArcFlag} 0 ${innerStart.x} ${innerStart.y}`,
    "Z"
  ].join(" ");
}

function pointOnCircle(radius: number, angleDegrees: number) {
  const radians = (angleDegrees * Math.PI) / 180;
  return {
    x: Number((donutCenter + radius * Math.cos(radians)).toFixed(3)),
    y: Number((donutCenter + radius * Math.sin(radians)).toFixed(3))
  };
}
