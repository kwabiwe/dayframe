import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const timeline = source("./TimeReviewViews.tsx");
const shell = source("./AppShell.tsx");
const runtime = source("./AppShellRuntime.tsx");
const page = source("../app/timeline/page.tsx");
const styles = source("../app/globals.css");
const queries = source("../lib/queries.ts");

describe("Timeline range and toolbar contract", () => {
  it("keeps one URL-owned range/view toolbar and no route-local preference owner", () => {
    expect(timeline.match(/className="timeline-range-toolbar"/g)).toHaveLength(1);
    expect(timeline).toContain("timelineStateFromSearchParams(searchParams)");
    expect(timeline).toContain("timelineHref(searchParams.toString(), state, nextState)");
    expect(timeline).toContain('window.history.pushState(null, "", href)');
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
    expect(timeline).toContain('view === "timesheet" ? "week" : state.scope');
    expect(timeline).toContain('isDateLoading || (state.view === "timesheet" && item.id === "day")');
    expect(runtime).toContain("Couldn’t load that period. Your current view is unchanged.");
  });

  it("gives all views the same clipped period data and both summary totals", () => {
    expect(timeline).toContain("clipTimelineEntries(mergeTimelineEntries(");
    expect(timeline).toContain("data.dayEntries");
    expect(timeline).toContain("data.weekEntries");
    expect(timeline).toContain("data.entries");
    expect(timeline).toContain('state.scope === "day" ? dayEntries : weekEntries');
    expect(timeline).toContain("<dt>Day total</dt>");
    expect(timeline).toContain("<dt>Week total</dt>");
    expect(timeline).toContain('aria-label="Timeline period and view controls"');
    expect(timeline).toContain('ariaLabel="Timeline view"');
    expect(timeline).toContain('ariaLabel="Timeline scope"');
  });

  it("canonicalizes direct URLs before one selected-date bootstrap read", () => {
    expect(page).toContain("timelineStateFromSearchParams(params)");
    expect(page).toContain("if (currentHref !== canonicalHref) redirect(canonicalHref)");
    expect(page).toContain("getBootstrapData(session, { selectedDate: state.date })");
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

  it("stacks the toolbar without horizontal overflow at phone widths", () => {
    expect(styles).toMatch(/@media \(max-width: 1180px\)[\s\S]*\.timeline-range-toolbar \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(styles).toMatch(/@media \(max-width: 760px\)[\s\S]*\.timeline-range-toolbar \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(styles).toMatch(/\.timeline-range-controls \.ui-segmented-control \{[^}]*width: 100%;/);
  });
});
