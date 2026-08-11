import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const timeline = source("./TimeReviewViews.tsx");
const entries = source("./EntriesTable.tsx");
const shell = source("./AppShell.tsx");
const runtime = source("./AppShellRuntime.tsx");
const page = source("../app/timeline/page.tsx");
const styles = source("../app/globals.css");
const queries = source("../lib/queries.ts");

describe("Timeline range and toolbar contract", () => {
  it("keeps one URL-owned range/view toolbar with one cookie-backed preference owner", () => {
    expect(timeline.match(/className="timeline-range-toolbar"/g)).toHaveLength(1);
    expect(timeline).toContain("timelineStateFromSearchParams(searchParams, { preference: initialPreference })");
    expect(timeline).toContain("timelineHref(searchParams.toString(), state, nextState)");
    expect(timeline).toContain('window.history.pushState(null, "", href)');
    expect(timeline).toContain("document.cookie");
    expect(timeline).toContain("updateTimelinePreference");
    expect(timeline).not.toContain("weekAnchor");
    expect(timeline).not.toContain("calendarMode");
    expect(timeline).not.toContain("localStorage");
    expect(styles).not.toContain(".fill-review-toolbar");
    expect(styles).not.toContain(".fill-date-pill");
    expect(styles).not.toContain(".fill-metric-pill");
  });

  it("makes period navigation fetch-capable while view and scope changes stay client-only", () => {
    expect(timeline).toMatch(/if \(nextState\.date === state\.date\) \{[\s\S]*window\.history\.pushState/);
    expect(timeline).toContain("const outcome = await loadDate(nextState.date)");
    expect(timeline).toContain('window.history.pushState(null, "", href)');
    expect(runtime).toContain('clientFetch(`/api/bootstrap?date=${date}`');
    expect(runtime).toContain("dateDataCacheRef.current.get(date)");
    expect(runtime).toContain("DATE_DATA_CACHE_LIMIT = 8");
    expect(runtime).toContain("withCurrentSharedBootstrap(cached, dataRef.current)");
    expect(runtime).toContain("shellData: data");
    expect(runtime).toContain("data: selectedData");
    expect(source("./PersistentTimerBar.tsx")).toContain("shellData: data");
    expect(timeline).toContain('view === "timesheet" ? "week" : preferenceRef.current?.preferredScope ?? state.scope');
    expect(timeline).toContain('isDateLoading || (state.view === "timesheet" && item.id === "day")');
    expect(runtime).toContain("Couldn’t load that period. Your current view is unchanged.");
  });

  it("advances a stale previous-Today view after local midnight without resetting historical browsing", () => {
    expect(timeline).toContain("shouldAdvanceStaleTimelineToToday");
    expect(timeline).toContain("todayKeyRef");
    expect(timeline).toContain("window.sessionStorage.getItem(TIMELINE_TODAY_SESSION_KEY)");
    expect(timeline).toContain("window.sessionStorage.setItem(TIMELINE_TODAY_SESSION_KEY, todayKey)");
    expect(timeline).toContain('window.addEventListener("focus", handleFocus)');
    expect(timeline).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
    expect(timeline).toContain("resetTimelineState(currentState, now)");
    expect(timeline).toContain("formatTimelinePeriodLabel(state.scope, ranges, capturedNow)");
  });

  it("gives all views the same clipped period data while limiting covered copy to Timesheet", () => {
    expect(timeline).toContain("clipTimelineEntries(mergeTimelineEntries(");
    expect(timeline).toContain("data.dayEntries");
    expect(timeline).toContain("data.weekEntries");
    expect(timeline).toContain("data.entries");
    expect(timeline).toContain('state.scope === "day" ? visibleDayEntries : visibleWeekEntries');
    expect(timeline).toContain('className="timeline-range-totals"');
    expect(timeline).toContain("reportsHrefForCustomRange(");
    expect(timeline).toContain("formatCompactHoursMinutes(dayAnalysis.totalLoggedSeconds)");
    expect(timeline).toContain("formatCompactHoursMinutes(weekAnalysis.totalLoggedSeconds)");
    expect(timeline).toContain("Open Day report for ${dayReportFrom}, total ${dayTotalLabel}");
    expect(timeline).toContain("Open Week report for ${weekReportFrom} to ${weekReportTo}, total ${weekTotalLabel}");
    expect(timeline).toContain("dayAnalysis.totalLoggedSeconds");
    expect(timeline).not.toContain("dayAnalysis.timeCoveredSeconds");
    expect(timeline).toContain("dailyCoverage[index].timeCoveredSeconds");
    expect(timeline).not.toContain("forwardVerticalCalendarWheel");
    expect(timeline).toContain('aria-label="Timeline period and view controls"');
    expect(timeline).toContain('ariaLabel="Timeline view"');
    expect(timeline).toContain('ariaLabel="Timeline scope"');
  });

  it("canonicalizes direct URLs before one selected-date bootstrap read", () => {
    expect(page).toContain("await cookies()");
    expect(page).toContain("timelinePreferenceFromCookieValue");
    expect(page).toContain("timelineStateFromSearchParams(params, { preference })");
    expect(page).toContain("if (currentHref !== canonicalHref) redirect(canonicalHref)");
    expect(page).toContain("getBootstrapData(session, { selectedDate: state.date })");
    expect(page).not.toContain("PageHeader");
    expect(page).toContain('<h1 className="sr-only">Timeline</h1>');
    expect(page).not.toContain("key=");
    expect(runtime).toContain("dataRef.current?.dateRange.selectedDate !== selectedDate");
    expect(runtime).toContain("useLayoutEffect(() =>");
    expect(runtime).toContain("BOOTSTRAP_FOCUS_RECONCILE_MIN_AGE_MS = 10_000");
    expect(runtime).toContain("Date.now() - lastCommitAtRef.current >= BOOTSTRAP_FOCUS_RECONCILE_MIN_AGE_MS");
  });

  it("keeps the shell date owner on Dashboard and makes Timeline shortcuts scope-aware", () => {
    expect(shell).toContain('const showShellDateContext = pathname === "/"');
    expect(shell).toContain('if (pathname === "/timeline")');
    expect(shell).toContain('shiftTimelineState(timelineState, direction)');
    expect(shell.match(/window\.addEventListener\("keydown"/g)).toHaveLength(1);
  });

  it("queries every selected range by interval overlap with one captured-now boundary", () => {
    expect(queries).toContain("const capturedNow = new Date().toISOString()");
    expect(queries).toContain("overlappingFrom: dateRange.dayStart");
    expect(queries).toContain("overlappingFrom: dateRange.weekStart");
    expect(queries).toContain("coalesce(te.stopped_at, ${capturedNowParam}::timestamptz) >");
    expect(queries).toContain("least(coalesce(stopped_at, $7::timestamptz), $3::timestamptz)");
    expect(queries).toContain("greatest(started_at, $2::timestamptz)");
  });

  it("keeps Timeline viewport-scoped and stacks the toolbar without page overflow at phone widths", () => {
    expect(shell).toContain('const isTimeline = pathname === "/timeline"');
    expect(shell).toContain('swiss-app-shell${isTimeline ? " is-timeline" : ""}');
    expect(shell).toContain('className="swiss-timeline-surface"');
    expect(shell).toContain('className="swiss-timeline-main"');
    expect(styles).toContain(".swiss-app-shell.is-timeline");
    expect(styles).toContain(".timeline-view-stage");
    expect(styles).toContain(".calendar-grid-scroller");
    expect(styles).toContain(".timeline-list-scroll");
    expect(styles).toContain(".timeline-timesheet-scroll");
    expect(styles).toContain(".calendar-time-axis");
    expect(styles).toContain(".timeline-timesheet-activity-cell");
    expect(styles).toContain(".swiss-quick-actions-rail");
    expect(styles).toContain("flex-wrap: nowrap");
    expect(styles).toContain("overflow-x: auto");
    expect(styles).toContain(".swiss-timer-description-control .ui-compound-control");
    expect(entries).toContain('className="timeline-list-workspace"');
    expect(entries).toContain('className="timeline-list-scroll"');
    expect(entries).not.toContain("FilterSelect");
    expect(timeline).toContain('className="timeline-timesheet-workspace"');
    expect(timeline).not.toContain("Timesheet totals count every entry in full.");
    expect(styles).toMatch(/\.swiss-timeline-surface \.timeline-range-toolbar \{[^}]*grid-template-columns: max-content max-content minmax\(0, 1fr\);/);
    expect(styles).toMatch(/\.swiss-timeline-surface \.timeline-range-navigation \{[^}]*grid-template-columns: var\(--web-icon-button-size\) 160px var\(--web-icon-button-size\);/s);
    expect(styles).toMatch(/\.swiss-timeline-surface \.timeline-date-picker \{[^}]*justify-self: stretch;/s);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.swiss-timeline-surface \.timeline-range-toolbar \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(styles).toMatch(/\.timeline-range-controls \.ui-segmented-control \{[^}]*width: 100%;/);
  });

  it("uses one outer Timeline surface and direct per-view scrollers without duplicate titles", () => {
    expect(shell).toContain('<PersistentTimerBar workspaceMode={isTimeline} />');
    expect(shell).toContain('className="swiss-timeline-surface"');
    expect(timeline).not.toContain('className="timeline-view-title-row"');
    expect(entries).not.toContain('className="timeline-view-title-row"');
    expect(timeline).toContain('className="calendar-corner-zoom"');
    expect(timeline).not.toContain("<span>Time</span>");
    expect(timeline).toContain('aria-label={`${loggedLabel} logged`}');
    expect(timeline).toContain("{loggedLabel}");
    expect(styles).toMatch(/\.calendar-grid-corner,[\s\S]*\.calendar-day-heading \{[^}]*min-height: 52px;/);
    expect(styles).toContain("--timeline-list-column-header-height: 40px");
    expect(styles).toMatch(/\.timeline-list-day-heading > td \{[^}]*top: var\(--timeline-list-column-header-height\);/s);
    expect(styles).toMatch(/\.timeline-list-day-heading > td \{[^}]*box-shadow: 0 -1px 0 var\(--line\);/s);
    expect(styles).toMatch(/\.calendar-day-body \{[^}]*isolation: isolate;/s);
  });

  it("keeps timer Suggestions above sticky Calendar chrome and the complete Undo bean on the responsive control contract", () => {
    expect(styles).toMatch(/\.swiss-timeline-surface \.swiss-persistent-timer-shell \{[^}]*z-index: 50;/s);
    expect(styles).toMatch(/\.calendar-grid-corner,[\s\S]*\.calendar-day-heading \{[^}]*z-index: 40;/s);
    expect(styles).toMatch(/:root \{[^}]*--web-control-height: 44px;/s);
    expect(styles).toMatch(/@media \(min-width: 761px\) \{[\s\S]*:root \{[^}]*--web-control-height: 38px;/s);
    expect(styles).toMatch(/\.timeline-delete-undo \{[^}]*height: var\(--web-control-height\);[^}]*box-sizing: border-box;/s);
    expect(styles).toMatch(/\.timeline-delete-undo button \{[^}]*min-height: 0;[^}]*height: auto;[^}]*align-self: stretch;/s);
    expect(styles).not.toMatch(/\.timeline-delete-undo button \{[^}]*height: 34px;/s);
  });
});
