import type { CSSProperties } from "react";
import { buildWeeklyWrapped, paletteCssColorFor } from "@dayframe/shared";
import { formatDuration } from "@/lib/format";
import type { ReportResult } from "@/lib/report-service";

export function WeeklyWrapped({ report }: { report: ReportResult }) {
  const week = buildWeeklyWrapped(report.dailyByActivity.map((day) => ({
    ...day,
    shortLabel: day.label.slice(0, 3),
    future: Date.parse(day.start) > Date.parse(report.capturedNow)
  })), report.byCategory);
  const lead = week.busiest;
  const color = (key: string | null, name: string) =>
    key ? paletteCssColorFor(key, name) : "var(--text-secondary)";

  return (
    <details className="df-card weekly-wrapped">
      <summary>Weekly Wrapped</summary>
      <div className="weekly-wrapped-body">
        <div>
          <p className="df-muted">{report.range.label}</p>
          <h2>{week.totalSeconds ? formatDuration(week.totalSeconds) + " logged" : "A quiet week"}</h2>
          <p className="df-muted">Tracked on {week.trackedDays} of {week.columns.length} days</p>
          <ol className="weekly-wrapped-days" aria-label="Logged time by day">
            {week.columns.map((day, index) => (
              <li key={day.key} className={day.key === lead?.key ? "is-busiest" : undefined}
                aria-label={`${day.label}, ${day.future ? "upcoming" : formatDuration(day.seconds)}`}>
                <div className="weekly-wrapped-track" aria-hidden="true">
                  <div className="weekly-wrapped-stack" style={{
                    height: `${week.peakSeconds ? day.seconds / week.peakSeconds * 100 : 0}%`,
                    animationDelay: `${index * 35}ms`
                  }}>
                    {day.segments.map((part) => (
                      <span key={part.id} style={{ flexGrow: part.seconds, backgroundColor: color(part.color, part.name) }} />
                    ))}
                  </div>
                </div>
                <span>{day.shortLabel}</span>
              </li>
            ))}
          </ol>
          <details className="report-data-table">
            <summary>View exact time by day</summary>
            <table>
              <thead><tr><th scope="col">Day</th><th scope="col">Logged time</th></tr></thead>
              <tbody>{week.columns.map((day) => <tr key={day.key}><th scope="row">{day.label}</th><td>{day.future ? "Upcoming" : formatDuration(day.seconds)}</td></tr>)}</tbody>
            </table>
          </details>
        </div>
        <div>
          {lead ? (
            <section className="weekly-wrapped-lead">
              <h3>Busiest day</h3>
              <p>{lead.label} · {formatDuration(lead.seconds)}</p>
            </section>
          ) : null}
          {week.activities.length ? (
            <ul className="weekly-wrapped-ledger" aria-label="Time by activity">
              {week.activities.map((activity) => (
                <li key={activity.id} style={{ "--activity-color": color(activity.color, activity.name) } as CSSProperties}>
                  <span>{activity.name}</span>
                  <span>{formatDuration(activity.seconds)} · {Math.round(activity.share * 100)}%</span>
                  <span className="weekly-wrapped-share" aria-hidden="true" style={{ width: `${activity.share * 100}%` }} />
                </li>
              ))}
            </ul>
          ) : <p className="df-muted">Time appears here as you log blocks.</p>}
        </div>
      </div>
    </details>
  );
}
