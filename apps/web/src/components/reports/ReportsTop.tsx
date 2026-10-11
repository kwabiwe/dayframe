import type { CSSProperties } from "react";
import { blockStyle } from "@/lib/block-style";
import { springLinearEasing } from "@/lib/blocks-motion";
import { formatDuration } from "@/lib/format";
import type { ReportBreakdownRow, ReportResult } from "@/lib/report-service";
import {
  busiestDaySeconds,
  isTodayKey,
  monthGridLeadingBlanks,
  reportBlocksLayout,
  reportHero,
  reportStackHeights,
  stackHeightCss
} from "@/lib/reports-blocks";

const WEEK_COLUMN_HEIGHT = 230;
const WEEK_GAP = 3;
const MONTH_STACK_HEIGHT = 52;
const MONTH_GAP = 2;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// Server-rendered, so the spring is the linear() easing; browsers without linear() fall back in CSS.
const LAND = springLinearEasing("land");

/**
 * Reports top (Blocks parity step 15a): four hero tiles (Total framed with the change against the
 * previous period, Daily average, Best day, Days on goal) and the range drawn in activity blocks —
 * a column of stacked blocks per day for a week (up to 14 days), a Monday-first grid for a month.
 * Rendered with the report, so days and weekdays follow the report's own day boundaries.
 */
export function ReportsTop({ dailyGoalMinutes, report }: { dailyGoalMinutes: number | null; report: ReportResult }) {
  const hero = reportHero(report, dailyGoalMinutes);
  const layout = reportBlocksLayout(report);
  const periodWord = previousWord(report.range);
  const metGoal = hero.goalDays.filter(Boolean).length;
  return (
    <>
      <section className="df-report-tiles" aria-label="Report summary">
        <div className="df-card df-tile">
          <small>Total framed</small>
          <span className="df-stat-big df-tnum">{formatDuration(hero.framedSeconds)}</span>
          {/* Product rule: web Reports shows Total logged beside Time covered (framed). */}
          <span className="df-delta df-tnum">
            {formatDuration(report.totalLoggedSeconds)} logged
            {report.totalLoggedSeconds > hero.framedSeconds ? " · overlaps count once above" : ""}
          </span>
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
          <span className="df-delta">{hero.best ? hero.best.label : "Nothing framed yet"}</span>
        </div>
        <div className="df-card df-tile">
          <small>Days on goal</small>
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
          ) : (
            <span className="df-delta">Set a daily goal in Settings to see it here.</span>
          )}
        </div>
      </section>

      {layout ? (
        <section aria-labelledby="df-report-blocks-title" className="df-card df-report-blocks">
          <div className="df-card-head">
            <h2 id="df-report-blocks-title">{layout === "month" ? "The month in blocks" : "The days in blocks"}</h2>
            <span className="df-faint">{report.byCategory.length} {report.byCategory.length === 1 ? "activity" : "activities"}</span>
          </div>
          {layout === "month" ? <MonthGrid report={report} /> : <WeekColumns report={report} />}
        </section>
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

function activityLookup(report: ReportResult) {
  return new Map<string, ReportBreakdownRow>(report.byCategory.map((row) => [row.id, row]));
}

function blockFor(id: string, lookup: Map<string, ReportBreakdownRow>): { name: string; style: CSSProperties | undefined } {
  const row = lookup.get(id);
  if (!row || id === "uncategorized") return { name: row?.name ?? "No activity", style: undefined };
  return { name: row.name, style: blockStyle(row.color, row.name) };
}

function WeekColumns({ report }: { report: ReportResult }) {
  const lookup = activityLookup(report);
  const busiest = busiestDaySeconds(report.dailyByActivity);
  return (
    <ol
      className="df-wblocks"
      style={{
        "--df-wb-height": `${WEEK_COLUMN_HEIGHT}px`,
        "--df-land": LAND.easing,
        "--df-land-ms": `${LAND.durationMs}ms`
      } as CSSProperties}
    >
      {report.dailyByActivity.map((day, index) => {
        const total = day.activities.reduce((sum, activity) => sum + activity.seconds, 0);
        const heights = reportStackHeights(day.activities.map((activity) => activity.seconds), busiest, WEEK_COLUMN_HEIGHT, 6, WEEK_GAP);
        const kept = heights.filter((height) => height > 0).length;
        const covered = report.dailySeries[index]?.coveredSeconds ?? total;
        return (
          <li
            aria-label={`${day.label}: ${formatDuration(covered)} framed${day.activities.length ? `, ${day.activities.map((activity) => `${blockFor(activity.id, lookup).name} ${formatDuration(activity.seconds)}`).join(", ")}` : ""}`}
            className={`df-wb${isTodayKey(day, report.capturedNow) ? " is-today" : ""}`}
            key={day.key}
          >
            <span aria-hidden="true" className="df-wb-stack">
              {day.activities.map((activity, activityIndex) => {
                const height = heights[activityIndex];
                if (!height) return null;
                const block = blockFor(activity.id, lookup);
                return (
                  <span
                    className={block.style ? "df-block" : "df-wb-none"}
                    data-key={activity.id}
                    key={activity.id}
                    style={{ ...block.style, height: stackHeightCss(height, kept, WEEK_COLUMN_HEIGHT, WEEK_GAP) }}
                    title={`${block.name} · ${formatDuration(activity.seconds)}`}
                  />
                );
              })}
            </span>
            <span aria-hidden="true" className="df-wb-label">
              <b>{day.label}</b>
              <small className="df-tnum">{formatDuration(covered)}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A day's blocks in its month cell, under the date, budgeted like a week column. */
function MonthStack({
  activities,
  busiest,
  lookup
}: {
  activities: ReportResult["dailyByActivity"][number]["activities"];
  busiest: number;
  lookup: Map<string, ReportBreakdownRow>;
}) {
  const heights = reportStackHeights(activities.map((activity) => activity.seconds), busiest, MONTH_STACK_HEIGHT, 3, MONTH_GAP);
  const kept = heights.filter((height) => height > 0).length;
  return (
    <span aria-hidden="true" className="df-mday-stack">
      {activities.map((activity, index) => {
        if (!heights[index]) return null;
        const block = blockFor(activity.id, lookup);
        return (
          <i
            className={block.style ? "df-block" : "df-wb-none"}
            data-key={activity.id}
            key={activity.id}
            style={{ ...block.style, height: stackHeightCss(heights[index], kept, MONTH_STACK_HEIGHT, MONTH_GAP) }}
          />
        );
      })}
    </span>
  );
}

function MonthGrid({ report }: { report: ReportResult }) {
  const lookup = activityLookup(report);
  const first = report.dailyByActivity[0];
  const blanks = first ? monthGridLeadingBlanks(first.start) : 0;
  const busiest = busiestDaySeconds(report.dailyByActivity);
  return (
    <div className="df-month">
      {WEEKDAYS.map((weekday) => <span aria-hidden="true" className="df-dow" key={weekday}>{weekday}</span>)}
      {Array.from({ length: blanks }, (_, index) => <span aria-hidden="true" className="df-mday is-empty" key={`blank-${index}`} />)}
      {report.dailyByActivity.map((day, index) => {
        const covered = report.dailySeries[index]?.coveredSeconds ?? 0;
        return (
          <span
            aria-label={`${day.label}: ${formatDuration(covered)} framed`}
            className={`df-mday${isTodayKey(day, report.capturedNow) ? " is-today" : ""}`}
            key={day.key}
            role="img"
          >
            <em aria-hidden="true">{new Date(day.start).getDate()}</em>
            <MonthStack activities={day.activities} busiest={busiest} lookup={lookup} />
          </span>
        );
      })}
    </div>
  );
}
