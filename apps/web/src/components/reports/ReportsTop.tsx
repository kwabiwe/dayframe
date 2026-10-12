import { formatDuration } from "@/lib/format";
import type { ReportResult } from "@/lib/report-service";
import { reportHero } from "@/lib/reports-blocks";

/**
 * Reports hero tiles (Blocks parity step 15a): Total (with the change against the days before),
 * Daily average, Best day and Days on goal. UIA-305: one total only — time logged, overlaps
 * included (a day may exceed 24h); the footnote under the tiles says so only when there is overlap. The range in blocks and
 * "Where it went" are `ReportsBlocksPanel` (15b-2).
 */
export function ReportsTop({ dailyGoalMinutes, report }: { dailyGoalMinutes: number | null; report: ReportResult }) {
  const hero = reportHero(report, dailyGoalMinutes);
  const periodWord = previousWord(report.range);
  const metGoal = hero.goalDays.filter(Boolean).length;
  return (
    <>
    <section className="df-report-tiles" aria-label="Report summary">
        <div className="df-card df-tile">
          <small>Total</small>
          <span className="df-stat-big df-tnum">{formatDuration(hero.totalSeconds)}</span>
          {hero.deltaSeconds !== null ? (
            <span className="df-delta df-tnum">
              {hero.deltaSeconds === 0
                ? `Same as ${periodWord}`
                : `${hero.deltaSeconds > 0 ? "+" : "−"}${formatDuration(Math.abs(hero.deltaSeconds))} vs ${periodWord}`}
            </span>
          ) : null}
        </div>
        <div className="df-card df-tile">
          <small>Daily average</small>
          <span className="df-stat-big df-tnum">{formatDuration(hero.dailyAverageSeconds)}</span>
          <span className="df-delta">across {hero.elapsedDayCount} {hero.elapsedDayCount === 1 ? "day" : "days"} so far</span>
        </div>
        <div className="df-card df-tile">
          <small>Best day</small>
          <span className="df-stat-big df-tnum">{formatDuration(hero.best?.seconds ?? 0)}</span>
          <span className="df-delta">{hero.best ? hero.best.label : "Nothing logged yet"}</span>
        </div>
        <div className="df-card df-tile">
          <small>Days on goal</small>
          {hero.goalDays.length || !dailyGoalMinutes ? null : (
            <span className="df-delta">No days in this range yet.</span>
          )}
          {hero.goalDays.length ? (
            <>
              <span className="df-stat-big df-tnum">
                {metGoal}
                <span className="df-faint df-stat-of"> / {hero.goalDays.length}</span>
              </span>
              <span className="df-goal-dots" aria-hidden="true">
                {hero.goalDays.slice(-14).map((met, index) => <i className={met ? "is-met" : undefined} key={index} />)}
              </span>
            </>
          ) : !dailyGoalMinutes ? (
            <span className="df-delta">Set a daily goal in Settings to see it here.</span>
          ) : null}
        </div>
    </section>
    {report.additionalOverlappingActivitySeconds > 0 ? (
      <p className="df-report-footnote df-faint">Overlapping blocks count in full, so a day can add up to more than 24h.</p>
    ) : null}
    </>
  );
}

/**
 * The comparison window is the same number of days just before the range (the report's previous
 * period), so a month compares with the 31 days before it, not the calendar month.
 */
function previousWord(range: ReportResult["range"]) {
  if (range.preset === "today" || range.preset === "yesterday") return "the day before";
  if (range.preset === "this-week" || range.preset === "last-week" || range.preset === "last-7-days") return "the week before";
  return `the ${range.dayCount} days before`;
}
