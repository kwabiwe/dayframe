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

describe("Calendar range and toolbar contract", () => {
  it("puts every date load that moves the Calendar behind the nav tap's generation (Codex r3 and r4 on #625)", () => {
    // The two places that load a period before moving the URL: the view's navigate (strip, picker, ‹ ›, Today, midnight)
    // and the shell's Alt+← / Alt+→.
    for (const file of [timeline, shell]) {
      expect(file.match(/await loadDate\(/g)).toHaveLength(1);
      expect(file).toMatch(/const generation = calendarNavigationGeneration\(\);\s*const outcome = await loadDate\(/);
      expect(file).toContain("if (generation !== calendarNavigationGeneration()) {");
    }
  });

  it("names the List's top day in the header, not only the URL's date (owner bug, 29 Oct 2026)", () => {
    expect(timeline).toContain("onVisibleDay: reportListTopDay");
    expect(timeline).toContain('formatCalendarRangeLabel(isList ? "day" : state.scope, narrowWeek ? { ...headerRanges, weekDays: narrowWeek.days } : headerRanges, todayKey)');
    expect(timeline).toContain("selectedDay: headerRanges.day.start");
    expect(timeline).toContain("value={headerDayKey}");
    // Reported whether or not the places column shows, and after a positioning that fires no scroll event.
    expect(entries).toContain("onVisibleDay?.(topDayStartMs)");
    expect(entries).not.toContain("if (columnShown) trackColumnDay();");
    // Cheap per scroll (Codex r1 on #625): cached heading offsets, binary-searched; re-measured only on layout changes,
    // and only while the List is shown.
    expect(entries).toContain("const offsets = (remeasure ? null : headingOffsetsRef.current) ?? measureHeadingOffsets(root);");
    expect(entries).toContain("if (!root || !tracksTopDay) return;");
    expect(entries).toContain("new MutationObserver(");
    expect(entries).toContain("new ResizeObserver(() => schedule())");
    expect(entries).not.toMatch(/headings\.filter\(\(heading\) => heading\.getBoundingClientRect\(\)/);
    // A deliberate choice of the URL's day positions the List again; the strip is the header day's week.
    expect(timeline).toContain("focusRequest: `${state.date}#${listFocusToken}`");
    expect(timeline).toContain("weekDays: headerRanges.weekDays");
  });

  it("keeps one URL-owned range/view toolbar with one cookie-backed preference owner", () => {
    expect(timeline.match(/className="timeline-range-toolbar df-cal-toolbar is-next"/g)).toHaveLength(1);
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
    expect(runtime).toContain("dateDataCacheRef.current.get(dateDataCacheKey(workspaceId, date))");
    expect(runtime).toContain("DATE_DATA_CACHE_LIMIT = 8");
    expect(runtime).toContain("withCurrentSharedBootstrap(cached, dataRef.current)");
    // The shell copy is the End it projection of the data (location v4 design §7, Codex r1 on #618).
    expect(runtime).toContain("shellData: shownData");
    expect(runtime).toContain("data: selectedData");
    expect(source("./PersistentTimerBar.tsx")).toContain("shellData: data");
    // Timesheet left Calendar (owner, 11 Oct): views restore the preferred scope, nothing is forced.
    expect(timeline).toContain("scope: preferenceRef.current?.preferredScope ?? state.scope");
    expect(timeline).not.toMatch(/timesheet/i);
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
    expect(timeline).toContain('formatCalendarRangeLabel(isList ? "day" : state.scope, narrowWeek ? { ...headerRanges, weekDays: narrowWeek.days } : headerRanges, todayKey)');
  });

  it("gives all views the same clipped period data", () => {
    expect(timeline).toContain("clipTimelineEntries(mergeTimelineEntries(");
    expect(timeline).toContain("data.dayEntries");
    expect(timeline).toContain("data.weekEntries");
    expect(timeline).toContain("data.entries");
    expect(timeline).toContain('state.scope === "day" ? visibleDayEntries : visibleWeekEntries');
    // The Day · Week totals row became the week strip's day totals and week total (#256, #259); the
    // week total still opens its report.
    expect(timeline).not.toContain('className="timeline-range-totals"');
    expect(timeline).not.toContain("dayLoggedSeconds");
    expect(timeline).toContain("weekLoggedSeconds: headWeekSeconds");
    expect(timeline).toContain(": weekAnalysis.totalLoggedSeconds;");
    expect(timeline).toContain("weekReportHref={reportsHrefForCustomRange(weekReportFrom, weekReportTo)}");
    expect(timeline).not.toContain("dayAnalysis.timeCoveredSeconds");
    expect(timeline).not.toContain("forwardVerticalCalendarWheel");
    expect(timeline).toContain('aria-label="Calendar period and view controls"');
    // UI review round 2 (owner 30 Oct 2026): one toolbar in every view — the date box with ‹ › inside it, Today, the
    // total, then one Day · Week · List control; the 7-day picker is List's own row, and Day and Week share the grid's day row.
    const toolbar = timeline.slice(timeline.indexOf('className="timeline-range-toolbar df-cal-toolbar is-next"'), timeline.indexOf('className="timeline-view-stage"'));
    expect(toolbar.indexOf('className="df-cal-datebox"')).toBeLessThan(toolbar.indexOf('className="timeline-today-button"'));
    expect(toolbar.indexOf('className="timeline-today-button"')).toBeLessThan(toolbar.indexOf('className="df-cal-weektotal df-tnum"'));
    expect(toolbar.indexOf('className="df-cal-weektotal df-tnum"')).toBeLessThan(toolbar.indexOf('ariaLabel="Calendar view"'));
    expect(toolbar).toContain('{ value: "list", label: "List", disabled: isDateLoading }');
    expect(toolbar).toContain("{!isList ? null : (");
    expect(timeline).toContain('variant="row"');
    expect(timeline).not.toContain("CalendarViewMenu");
    // Today is always there, greyed whenever today is what's shown, in every view (owner, 30 Oct 2026).
    expect(toolbar).toContain("disabled={isDateLoading || showsToday}");
    // Location days belong to the owner and the selected week (Codex r2 on #584).
    expect(timeline).toContain("data, listRefreshToken, `${listOwner}|${toTimelineDateKey(ranges.week.start)}`, isList, listFocusDate, listRefresh.affected);");
    // In read order, so a trip read on two days shows its freshest copy (Codex r5 on #584).
    expect(timeline).toContain("locationTimelines={[...listTimelines.values()].filter((timeline) => listDays.includes(timeline.date))}");
    // Alt+← / → (the shell's period shortcut) does nothing in List either (Codex r1 on #584).
    expect(source("./AppShell.tsx")).toContain('if (pathname !== "/timeline" || timelineState.view === "list") return;');
  });

  it("canonicalizes direct URLs before one selected-date bootstrap read", () => {
    expect(page).toContain("await cookies()");
    expect(page).toContain("timelinePreferenceFromCookieValue");
    expect(page).toContain("timelineStateFromSearchParams(params, { preference: statePreference, today: todayKey })");
    expect(page).toContain("if (currentHref !== canonicalHref) redirect(canonicalHref)");
    expect(page).toContain("getBootstrapData(session, { selectedDate: state.date, timeZone: await getViewerTimeZoneIfSent() })");
    expect(page).not.toContain("PageHeader");
    // The visible month heading in the Calendar head replaces the screen-reader-only one.
    expect(page).not.toContain('<h1 className="sr-only">Timeline</h1>');
    expect(page).not.toContain("key=");
    expect(runtime).toContain("dataRef.current?.dateRange.selectedDate !== selectedDate");
    expect(runtime).toContain("useLayoutEffect(() =>");
    expect(runtime).toContain("BOOTSTRAP_FOCUS_RECONCILE_MIN_AGE_MS = 10_000");
    expect(runtime).toContain("Date.now() - lastCommitAtRef.current >= BOOTSTRAP_FOCUS_RECONCILE_MIN_AGE_MS");
  });

  it("keeps date navigation on Timeline only (Today is always today) and makes its shortcuts scope-aware", () => {
    expect(shell).toContain('const showDateNavigation = pathname === "/timeline"');
    expect(shell).not.toContain("DateContextRow");
    expect(shell).toContain('if (pathname !== "/timeline" || timelineState.view === "list") return;');
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
    expect(shell).toContain('className={isTimeline ? "swiss-timeline-surface" : "swiss-page-surface"}');
    expect(shell).toContain('className={isTimeline ? "swiss-timeline-main" : undefined}');
    expect(styles).toContain(".swiss-app-shell.is-timeline");
    expect(styles).toContain(".timeline-view-stage");
    expect(styles).toContain(".calendar-grid-scroller");
    expect(styles).toContain(".timeline-list-scroll");
    expect(styles).toContain(".calendar-time-axis");
    expect(styles).toContain(".df-quick");
    expect(styles).toContain("flex-wrap: nowrap");
    expect(styles).toContain("overflow-x: auto");
    expect(styles).toContain(".swiss-timer-description-control .ui-compound-control");
    expect(entries).toContain('className="timeline-list-workspace"');
    expect(entries).toContain('className="timeline-list-scroll"');
    expect(entries).not.toContain("FilterSelect");
    expect(styles).not.toContain(".timeline-timesheet");
    // UI review round 2: one fixed-height toolbar (56 px; two 96 px lines on phones) over a fixed-height row.
    expect(styles).toMatch(/\.swiss-timeline-surface \.df-cal-toolbar\.is-next \{[^}]*height: var\(--df-cal-toolbar-height\);/s);
    expect(styles).toMatch(/@media \(max-width: 640px\)[\s\S]*--df-cal-toolbar-height: 96px;/);
    expect(styles).toMatch(/\.df-cal-datebox \{[^}]*height: var\(--web-control-height\);/s);
  });

  it("uses one outer Timeline surface and direct per-view scrollers without duplicate titles", () => {
    expect(shell).toContain('<PersistentTimerBar onToday={pathname === "/"} workspaceMode={isTimeline} />');
    expect(shell).toContain('className={isTimeline ? "swiss-timeline-surface" : "swiss-page-surface"}');
    expect(timeline).not.toContain('className="timeline-view-title-row"');
    expect(entries).not.toContain('className="timeline-view-title-row"');
    expect(timeline).toContain('className="calendar-corner-zoom df-cal-dayrow-zoom"');
    expect(timeline).not.toContain("<span>Time</span>");
    // The day row (UI review round 2): each day's total is its tip and part of its name.
    expect(source("./calendar/CalendarHead.tsx")).toContain("data-tip={row ? day.tip : undefined}");
    expect(styles).toMatch(/\.df-cal-dayrow \{[^}]*height: var\(--df-cal-row-height\);/s);
    expect(styles).toContain("--timeline-list-column-header-height: 40px");
    expect(styles).toMatch(/\.timeline-list-day-heading > td \{[^}]*top: var\(--timeline-list-column-header-height\);/s);
    expect(styles).toMatch(/\.timeline-list-day-heading > td \{[^}]*box-shadow: 0 -1px 0 var\(--line\);/s);
    expect(styles).toMatch(/\.calendar-day-body \{[^}]*isolation: isolate;/s);
  });

  it("keeps block Suggestions above sticky Calendar chrome and the complete Undo bean on the responsive control contract", () => {
    expect(styles).toMatch(/\.swiss-timeline-surface \.swiss-persistent-timer-shell \{[^}]*z-index: 50;/s);
    expect(styles).toMatch(/\.df-cal-dayrow \{[^}]*position: sticky;[^}]*z-index: 41;/s);
    expect(styles).toMatch(/:root \{[^}]*--web-control-height: 44px;/s);
    // One control scale on every width (WUI-015): no 38 px desktop controls.
    expect(styles).not.toMatch(/--web-control-height: 38px;/);
    // Timeline Undo uses the Blocks toast (step 12b): a 44 px action inside the pill.
    expect(styles).toMatch(/\.df-toast-action \{[^}]*min-height: 44px;/s);
  });
});
