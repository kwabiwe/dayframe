"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, Clock3, Inbox } from "lucide-react";
import { categoryDisplay } from "@/lib/display";
import {
  buildCategoryAllocationSummary,
  buildDashboardPeriod,
  buildDashboardReportsUrl,
  calculateCategoryAllocation,
  calculateGoalProgress,
  calculatePreviousPeriodComparison,
  dedupeDashboardEntries,
  entryOverlapSeconds,
  getTopCategory,
  type CategoryAllocation,
  type DashboardMode,
  type DashboardPeriod
} from "@/lib/dashboard-intelligence";
import { formatDuration, formatEventLabel, formatSourceLabel, formatTime } from "@/lib/format";
import type { BootstrapData } from "@/lib/queries";
import { useRuntimePageData } from "@/components/AppShellRuntime";
import { SegmentedControl } from "@/components/ui/Primitives";

const donutCenter = 60;
const donutRadius = 42;
const donutCircumference = 2 * Math.PI * donutRadius;

export function DashboardRealtime({ initialData }: { initialData: BootstrapData }) {
  const data = useRuntimePageData(initialData);
  const [mode, setMode] = useState<DashboardMode>("day");
  const now = new Date();
  const period = useMemo(
    () => buildDashboardPeriod(data.dateRange.selectedDate, mode),
    [data.dateRange.selectedDate, mode]
  );
  const entries = useMemo(
    () => dedupeDashboardEntries(
      data.historyEntries,
      data.entries,
      data.dayEntries,
      data.weekEntries,
      [data.activeEntry]
    ),
    [data.activeEntry, data.dayEntries, data.entries, data.historyEntries, data.weekEntries]
  );
  const allocation = calculateCategoryAllocation(entries, period, { now });
  const previousAllocation = calculateCategoryAllocation(entries, {
    start: period.previousStart,
    end: period.previousEnd
  }, { now });
  const goal = calculateGoalProgress(
    allocation.totalSeconds,
    mode === "day" ? data.user.dailyGoalMinutes : data.user.weeklyGoalMinutes
  );
  const comparison = calculatePreviousPeriodComparison(
    allocation.totalSeconds,
    previousAllocation.totalSeconds
  );
  const topCategory = getTopCategory(allocation);
  const entryCount = entries.filter((entry) => entryOverlapSeconds(entry, period, now) > 0).length;

  return (
    <div className="swiss-dashboard dashboard-intelligence">
      <h1 className="sr-only">Dashboard</h1>

      <section className="dashboard-summary" aria-label={`${mode === "day" ? "Day" : "Week"} summary`}>
        <SummaryMetric label="Tracked" value={formatDuration(allocation.totalSeconds)} />
        <SummaryMetric label="Entries" value={`${entryCount}`} />
        <SummaryMetric label="Categories" value={`${allocation.categories.length}`} />
      </section>

      <section className="swiss-panel dashboard-allocation" aria-labelledby="dashboard-allocation-title">
        <div className="dashboard-panel-header">
          <div>
            <h2 id="dashboard-allocation-title">Time allocation</h2>
            <p>{formatPeriodLabel(period, mode)}</p>
          </div>
          <SegmentedControl
            ariaLabel="Dashboard time context"
            className="dashboard-mode-control"
            onChange={setMode}
            options={[
              { value: "day", label: "Day" },
              { value: "week", label: "Week" }
            ]}
            value={mode}
          />
        </div>

        {allocation.totalSeconds > 0 ? (
          <div className="dashboard-allocation-layout">
            <AllocationDonut allocation={allocation} mode={mode} period={period} />
            <div className="dashboard-allocation-legend" aria-label="Category allocation legend">
              {allocation.visibleCategories.map((category) => (
                <AllocationLink
                  key={category.id}
                  category={category}
                  href={buildDashboardReportsUrl(mode, period, category)}
                  totalSeconds={allocation.totalSeconds}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="dashboard-empty-state">
            <Clock3 size={22} aria-hidden="true" />
            <div>
              <strong>No tracked time for this {mode}</strong>
              <p>Start the timer or add time manually to build an allocation view.</p>
            </div>
          </div>
        )}

        <AllocationTable allocation={allocation} />
      </section>

      <section className="dashboard-insights" aria-label="Progress and context">
        <GoalProgressCard
          goal={goal}
          mode={mode}
          totalSeconds={allocation.totalSeconds}
        />
        <PreviousPeriodCard
          comparison={comparison}
          mode={mode}
        />
        <TopCategoryCard
          category={topCategory}
          mode={mode}
          period={period}
          totalSeconds={allocation.totalSeconds}
        />
      </section>

      <section className="dashboard-lower-grid">
        <NeedsReviewPanel count={data.stats.reviewCount} />
        <RecentActivityPanel data={data} />
      </section>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="dashboard-summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AllocationDonut({
  allocation,
  mode,
  period
}: {
  allocation: ReturnType<typeof calculateCategoryAllocation>;
  mode: DashboardMode;
  period: DashboardPeriod;
}) {
  const summary = buildCategoryAllocationSummary(allocation, formatDuration);
  const slices = allocation.visibleCategories.map((category, index, categories) => {
    const previousSeconds = categories
      .slice(0, index)
      .reduce((sum, previousCategory) => sum + previousCategory.seconds, 0);
    const fraction = category.seconds / allocation.totalSeconds;
    const segmentLength = fraction * donutCircumference;
    const visibleLength = Math.max(0, segmentLength - (categories.length > 1 ? 1.5 : 0));
    return {
      category,
      visibleLength,
      dashOffset: -(previousSeconds / allocation.totalSeconds) * donutCircumference
    };
  });

  return (
    <figure className="dashboard-donut-figure">
      <svg
        className="dashboard-donut"
        viewBox="0 0 120 120"
        role="group"
        aria-label={summary}
      >
        <defs>
          <pattern id="dashboard-uncategorized-pattern" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--surface-muted)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--text-secondary)" strokeWidth="2" />
          </pattern>
        </defs>
        <circle className="dashboard-donut-track" cx={donutCenter} cy={donutCenter} r={donutRadius} />
        {slices.map(({ category, dashOffset, visibleLength }) => {
          const color = categoryDisplay(category.name, category.color).color;
          const href = buildDashboardReportsUrl(mode, period, category);

          return (
            <a
              key={category.id}
              href={href}
              aria-label={`${category.name}, ${formatDuration(category.seconds)}, ${category.percentage}%. Open Reports.`}
            >
              <circle
                className="dashboard-donut-segment"
                cx={donutCenter}
                cy={donutCenter}
                r={donutRadius}
                stroke={category.isUncategorized ? "url(#dashboard-uncategorized-pattern)" : color}
                strokeDasharray={`${visibleLength} ${donutCircumference - visibleLength}`}
                strokeDashoffset={dashOffset}
              />
            </a>
          );
        })}
      </svg>
      <figcaption className="dashboard-donut-center" aria-hidden="true">
        <span>Total</span>
        <strong>{formatDuration(allocation.totalSeconds)}</strong>
      </figcaption>
    </figure>
  );
}

function AllocationLink({
  category,
  href,
  totalSeconds
}: {
  category: CategoryAllocation;
  href: string;
  totalSeconds: number;
}) {
  const display = categoryDisplay(category.name, category.color);
  return (
    <Link className="dashboard-allocation-row" href={href}>
      <span
        className={`dashboard-category-marker${category.isUncategorized ? " is-uncategorized" : ""}`}
        style={{ "--category-color": display.color } as CSSProperties}
        aria-hidden="true"
      />
      <span className="dashboard-allocation-name">{category.name}</span>
      <span className="dashboard-allocation-duration">{formatDuration(category.seconds)}</span>
      <span className="dashboard-allocation-share">
        {totalSeconds > 0 ? Math.round((category.seconds / totalSeconds) * 100) : 0}%
      </span>
      <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

function AllocationTable({ allocation }: { allocation: ReturnType<typeof calculateCategoryAllocation> }) {
  return (
    <div className="sr-only">
      <table>
        <caption>Accessible category allocation for the selected dashboard period</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Duration</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {allocation.categories.map((category) => (
            <tr key={category.id}>
              <th scope="row">{category.name}</th>
              <td>{formatDuration(category.seconds)}</td>
              <td>{category.percentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GoalProgressCard({
  goal,
  mode,
  totalSeconds
}: {
  goal: ReturnType<typeof calculateGoalProgress>;
  mode: DashboardMode;
  totalSeconds: number;
}) {
  const goalName = mode === "day" ? "Daily goal" : "Weekly goal";
  return (
    <section className="swiss-panel dashboard-insight-card">
      <div className="dashboard-insight-heading">
        <span>{goalName}</span>
        {goal.percentage !== null ? <strong>{goal.percentage}%</strong> : null}
      </div>
      {goal.goalSeconds > 0 ? (
        <>
          <p className="dashboard-insight-value">
            {formatDuration(totalSeconds)} of {formatDuration(goal.goalSeconds)}
          </p>
          <div
            className="dashboard-goal-track"
            role="progressbar"
            aria-label={goalName}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={goal.clampedPercentage}
            aria-valuetext={`${goal.percentage}% of ${formatDuration(goal.goalSeconds)}`}
          >
            <span style={{ width: `${goal.clampedPercentage}%` }} />
          </div>
          {goal.isExceeded ? <small>Goal exceeded by {formatDuration(totalSeconds - goal.goalSeconds)}</small> : null}
        </>
      ) : (
        <div className="dashboard-insight-empty">
          <p>No {mode === "day" ? "daily" : "weekly"} goal set.</p>
          <Link href="/settings">Set a goal</Link>
        </div>
      )}
    </section>
  );
}

function PreviousPeriodCard({
  comparison,
  mode
}: {
  comparison: ReturnType<typeof calculatePreviousPeriodComparison>;
  mode: DashboardMode;
}) {
  const label = `previous ${mode}`;
  let statement: string;
  let detail: string | null = null;

  if (comparison.currentSeconds === 0 && comparison.previousSeconds === 0) {
    statement = `No time tracked in either ${mode}`;
  } else if (comparison.previousSeconds === 0) {
    statement = `${formatDuration(comparison.currentSeconds)} tracked`;
    detail = `The ${label} had no tracked time.`;
  } else if (comparison.direction === "same") {
    statement = `Same as ${label}`;
  } else if (comparison.direction === "more") {
    statement = `${formatDuration(comparison.absoluteDeltaSeconds)} more than ${label}`;
    detail = comparison.percentageChange === null ? null : `${comparison.percentageChange}% more`;
  } else {
    statement = `${comparison.percentageChange ?? 0}% less than ${label}`;
    detail = `${formatDuration(comparison.absoluteDeltaSeconds)} less tracked`;
  }

  return (
    <section className="swiss-panel dashboard-insight-card">
      <div className="dashboard-insight-heading"><span>Previous period</span></div>
      <p className="dashboard-insight-value">{statement}</p>
      {detail ? <small>{detail}</small> : null}
    </section>
  );
}

function TopCategoryCard({
  category,
  mode,
  period,
  totalSeconds
}: {
  category: CategoryAllocation | null;
  mode: DashboardMode;
  period: DashboardPeriod;
  totalSeconds: number;
}) {
  return (
    <section className="swiss-panel dashboard-insight-card">
      <div className="dashboard-insight-heading"><span>Top category</span></div>
      {category ? (
        <>
          <Link className="dashboard-top-category" href={buildDashboardReportsUrl(mode, period, category)}>
            <strong>{category.name}</strong>
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
          <p>{formatDuration(category.seconds)} · {totalSeconds > 0 ? Math.round((category.seconds / totalSeconds) * 100) : 0}%</p>
        </>
      ) : (
        <p className="dashboard-insight-empty">Track time to see your top category for this {mode}.</p>
      )}
    </section>
  );
}

function NeedsReviewPanel({ count }: { count: number }) {
  return (
    <section className="swiss-panel dashboard-review-panel">
      <div className="dashboard-review-icon" aria-hidden="true"><Inbox size={21} /></div>
      <div>
        <span>Needs review</span>
        <strong>{count}</strong>
        <p>{count === 0 ? "Nothing is waiting for your decision." : `${count} ${count === 1 ? "item is" : "items are"} waiting for your decision.`}</p>
      </div>
      <Link href="/review">Open Review <ArrowRight size={15} aria-hidden="true" /></Link>
    </section>
  );
}

function RecentActivityPanel({ data }: { data: BootstrapData }) {
  const events = data.activityEvents.slice(0, 4);
  return (
    <section className="swiss-panel dashboard-activity-panel">
      <div className="dashboard-panel-header">
        <div>
          <h2>Recent activity</h2>
          <p>Latest recorded events</p>
        </div>
        <Link href="/timeline?view=list">View all</Link>
      </div>
      <div className="dashboard-activity-list">
        {events.map((event) => {
          const Icon = event.eventType.includes("timer") ? Clock3 : CheckCircle2;
          return (
            <div key={event.id} className="dashboard-activity-row">
              <Icon size={18} aria-hidden="true" />
              <span>
                <strong>{event.categoryName ?? event.placeName ?? formatEventLabel(event.eventType)}</strong>
                <small>
                  {[formatEventLabel(event.eventType), event.placeName, formatSourceLabel(event.source)]
                    .filter((part, index, parts) => part && parts.indexOf(part) === index)
                    .join(" · ")}
                </small>
              </span>
              <time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
            </div>
          );
        })}
        {events.length === 0 ? <p className="dashboard-activity-empty">No recent activity.</p> : null}
      </div>
    </section>
  );
}

function formatPeriodLabel(period: DashboardPeriod, mode: DashboardMode) {
  if (mode === "day") {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(period.start);
  }

  const inclusiveEnd = new Date(period.end);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  const startDay = new Intl.DateTimeFormat("en-GB", { day: "numeric" }).format(period.start);
  const end = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(inclusiveEnd);
  return `${startDay}–${end}`;
}
