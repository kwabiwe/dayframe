# Web Timeline Range And Toolbar Unification

Date: 2026-07-23

Branch: `codex/web-timeline-range-toolbar`

Base: `c850c9664bd92aad84207bdd27facc3d5b0ae140` (`origin/main`, merged PR #101)

Status: Implementation, two review passes, broad validation, and local production validation complete; draft PR pending

## Scope

This focused PR gives Timeline one URL-backed `date` / `scope` / `view` model, one route-owned toolbar, and one clipped-overlap definition across Calendar, List, Timesheet, Day total, and Week total.

It does not change the shell-owned persistent timer, Calendar block readability/restart actions, grouped List entries, Reports filter popovers, global Search, mobile source, database schema, hosted deployment, or Production.

## PDF Findings

The `DF web 2.pdf` Timeline annotation identifies two visible period owners: the generic shell date row and a second Timeline week toolbar. It also calls out the disconnected range control, the low-value “This week” pill, the missing Day total, and the separation between Day/Week and Calendar/List/Timesheet. The useful hierarchy in the Toggl reference is one date/range control, visible day/week totals, and adjacent presentation controls; Dayframe retains its own category-first Midnight Core styling.

## Current-Main Reproduction

The exact base compiled successfully with `npm run build -w @dayframe/web`. The first production launch exposed a stale local database (`review_items.user_id` missing), so reproduction continued against the disposable, freshly migrated and seeded database `dayframe_timeline_toolbar_qa_20260723`. No existing or hosted data was altered.

At `/timeline?date=2026-07-22&view=calendar`:

- AppShell rendered a generic DateContextRow for Wednesday 22 July while Timeline rendered a second Monday 20-Sunday 26 July toolbar.
- Shell Previous day changed the URL and server Bootstrap selected date.
- Timeline Previous week changed only local `weekAnchor`; the URL and shell date remained unchanged.
- Refresh restored the local week from the URL-selected date.
- Calendar Day was stored through a local preference and remained absent from the URL.
- With URL date Wednesday 22 July, Calendar Day rendered Thursday 23 July because it substituted real today.
- Moving the local week to 13-19 July while Day was active still rendered Thursday 23 July, now with zero time.
- Switching that state to List kept the 13-19 July toolbar but displayed three generic recent entries from Thursday 23 July.
- Timesheet used the local week but did not expose or normalize the hidden Day state.
- View changes used `router.replace`, so Back skipped List/Timesheet and returned to the earlier shell-date navigation.
- A direct older-date bookmark reconstructed the week but still allowed Calendar Day to substitute today.

## Old Competing State Owners

1. AppShell/runtime `date` search parameter and Bootstrap selected date.
2. `TimeReviewViews` local `weekAnchor`.
3. Calendar-only `calendarModeOverride`.
4. Workspace-scoped Calendar mode localStorage preference.
5. URL-backed `view`.
6. View-specific entry collections: Calendar/Timesheet used a locally filtered week while List used generic `data.entries`.

## Implementation Plan

1. Extend the typed Timeline helper to parse, validate, serialize, shift, reset, and resolve one local-calendar period from `date`, `scope`, and `view`.
2. Normalize Timesheet to Week and make view/scope/date actions preserve other supported query parameters without scroll jumps.
3. Reuse one pure clipped-overlap helper for Dashboard and Timeline; derive Day total, Week total, Calendar, List, and Timesheet from one captured current time.
4. Correct Bootstrap Day/Week entry queries and stats to use overlap plus clipped-duration SQL without a migration.
5. Remove Timeline local `weekAnchor` and Calendar Day/Week persistence; render one responsive, accessible route toolbar and keep only Calendar zoom under View options.
6. Keep the persistent timer in AppShell, hide only the generic shell date row on Timeline, and make the existing Alt shortcuts route/scope-aware.
7. Consolidate superseded Timeline styles and add focused URL, DST, overlap, Timesheet, accessibility, ownership, and query tests.
8. Run two independent review passes, complete automated validation, and exercise the optimized production build across the required browser matrix.

## Motion Contract

- Trigger: previous/next/reset, scope selection, view selection, browser Back/Forward, refresh, and direct URL.
- Owner: the Timeline URL is the single navigation/state owner; AppShell remains the single timer and global-shortcut owner.
- Entrance/update/exit: period content updates in place after navigation. No new spatial entrance, exit, chart animation, or loading reflow is introduced.
- Surrounding layout: the responsive toolbar uses deliberate grid breakpoints; date, totals, view, and scope remain in one stable surface.
- Interruption: rapid navigation is latest-URL-wins. Runtime hydration/request identity prevents stale Bootstrap data from replacing a newer selected date.
- Async outcome: range navigation is read-only. A failed reconciliation retains the last valid view; existing entry-mutation rollback remains unchanged.
- Accessibility: the selected period is announced through one restrained live region; focus and selected state remain distinct; existing Reduced Motion rules apply because the feature adds no required spatial motion.

## Implemented Contract

- `date=YYYY-MM-DD`, `scope=day|week`, and `view=calendar|list|timesheet` are canonical, explicit URL state. Missing or invalid values normalize to the local current date, Week, and Calendar.
- The selected date is the Day range. Its containing Monday-Sunday range is the Week range. Previous/Next shifts by one local calendar day in Day scope and seven local calendar days in Week scope; reset preserves view/scope.
- Timesheet is weekly-only. A direct or in-app `scope=day&view=timesheet` state normalizes to `scope=week`; Day is disabled while Timesheet is selected.
- View and scope changes use native history state and loaded Day/Week data, so they add useful Back/Forward entries without a server read. An uncached date change makes one `/api/bootstrap?date=…` read, commits the matching payload to a small per-date runtime cache, then updates history.
- Initial server hydration is committed before focus/interval reconciliation. A fresh optimized-production load made no duplicate client Bootstrap call.
- Pending range navigation leaves the current URL/data visible, disables period controls, and exposes a restrained `Loading period…` status. Failure leaves the current URL/data unchanged and announces `Couldn’t load that period. Your current view is unchanged.`
- AppShell remains the single persistent-timer and global-keyboard owner. Timeline hides only the shell `DateContextRow`; Dashboard keeps it. Alt+Left/Right calls the same cached range loader and respects Day/Week scope.

## Overlap And DST Semantics

All range calculations use half-open intervals: an entry contributes only where
`entry.start < range.end && effectiveEntryEnd > range.start`. A running entry uses one captured current time. Duration is the intersection of the entry and range, never the entry's full stored duration.

- Bootstrap Day/Week queries select overlapping entries, including rows that begin before the period.
- Day/Week SQL totals clip with `least` / `greatest` and the same captured current time.
- Calendar renders a segment in every intersected day and exposes continuation copy. Only the edge that exists inside the displayed day is resizeable, and saving one edge preserves the other original timestamp.
- List displays clipped start/end times and clipped duration while passing the original row to edit/delete/start-again actions.
- Timesheet assigns each clipped second to the intersected local day and derives row, day, and grand totals from those day cells.
- Focused tests pin `TZ=Europe/London`: 29 March 2026 is 23 hours, its containing week is 167 hours, 25 October 2026 is 25 hours, and its containing week is 169 hours. Navigation still moves by local calendar dates rather than fixed milliseconds.

The overlap query plan was checked against the disposable database with `EXPLAIN (ANALYZE, BUFFERS)`. PostgreSQL used `idx_time_entries_workspace_started`, bounded by workspace and `started_at < rangeEnd`; the remaining user/effective-stop overlap predicates were filters. No schema or migration change was required.

## Optimized-Production Evidence

The current branch was built and run with `next build` / `next start` against the freshly migrated disposable database. A temporary local request-counting reverse proxy was used only under `tmp/` and is not part of the PR.

Request counts:

| Interaction | Selected-period reads |
| --- | ---: |
| Clean initial Timeline document | 1 server-rendered document, 0 duplicate `/api/bootstrap` |
| Calendar → List | 0 |
| Week → Day | 0 |
| Uncached Previous week | 1 `/api/bootstrap?date=2026-07-16` |
| Cached Back then Forward | 0 |

State reconstruction passed for direct older Day bookmarks, direct Timesheet/Day normalization, malformed parameters, refresh, and Back/Forward. Alt navigation moved one local day in Day scope and seven local days in Week scope.

A disposable cross-midnight entry from 22 July 23:30 to 23 July 01:30 produced:

- List: 23:30-00:00 / 30m on 22 July and 00:00-01:30 / 1h30 on 23 July.
- Calendar: matching clipped labels, `Continues into the next day` / `Continues from the previous day`, and only the valid resize edge per segment.
- Timesheet: 30m on Wednesday and 1h30 on Thursday; the Work category and daily/grand totals reconciled exactly.

A 700ms delayed period read kept the old URL/data visible, announced Loading, disabled navigation, then committed the new date. With the upstream server stopped, the same action retained the old URL/data, showed the calm failure copy, and produced no framework error overlay.

## Responsive And Theme Matrix

The optimized build was checked at 1440, 1280, 1024, 768, and 390 CSS pixels in System, Light, and Dark, plus 720 CSS pixels as a 200%-zoom equivalent. All 16 cases reported `documentElement.scrollWidth === clientWidth`. At 390 px every Timeline-toolbar button measured at least 44 × 44 px. The desktop toolbar stays on one row where space permits, medium widths move presentation controls to a second row, and phone widths stack navigation, totals, view, and scope inside the same surface. Calendar/Timesheet retain intentional internal horizontal scrolling without page overflow. No runtime overlay was present.

Related local QA images are under `tmp/dayframe-timeline-toolbar/` and remain untracked.

## Review Pass 1

The first independent code/data review found and corrected:

1. Cross-midnight List rows initially showed original timestamps despite clipped totals; display-only clipped timestamps now leave editable source timestamps intact.
2. Continuation Calendar blocks initially exposed invalid resize edges and could rewrite the untouched timestamp; resize ownership is now edge-specific.
3. Calendar wall-clock positioning used elapsed milliseconds, which misaligns blocks on DST days; positioning now uses local wall-clock minutes while duration totals retain real elapsed seconds.
4. Route navigation retained the old Next server-read path and had no calm offline result; one cached client range loader now owns period reads, pending state, failure retention, and shortcut parity.
5. A clean load could be followed by a redundant focus refresh; layout hydration and a short focus-freshness guard remove that duplicate without changing the 30-second/focus/visibility reconciliation contract.

## Review Pass 2

The second independent ownership/interruption review found and corrected:

1. A repeated selected view/scope click could add a duplicate history entry; identical state is now a no-op.
2. A slow date read could complete after the user changed history and push a now-stale destination; navigation records its origin and commits history only if that origin is still current.
3. Rapid global shortcuts could overlap date reads; one synchronous in-flight owner now disables/ignores repeats until the request completes.
4. An unbounded full-Bootstrap cache would accumulate and cached dates could carry stale active-timer/category state. The cache is capped at eight dates, refreshes least-recently committed entries, and merges current shared Bootstrap fields into cached range data.
5. A newly stopped/started timer might be absent from an older cached range collection. Timeline now deduplicates range rows with current recent/active rows before applying the selected range, so current mutation state wins while cached range-only rows remain available.
6. Cache reads during render tripped the React refs contract. Cache-to-selected-data switching now occurs in a layout effect before paint; repository lint verifies that refs stay out of render.

## Automated Validation

All required broad commands passed on the final source:

- `npm run lint`
- `npm run typecheck` (mobile, web, shared)
- `npm run test`: 732 tests total — mobile 237, web 401, shared 94
- `npm run build` (`next build`, 26/26 static pages generated; all dynamic routes collected)
- `git diff --check`

Focused Timeline coverage is included in the web total: canonical URL/default/invalid/Timesheet state, direct round trips, Day/Week shifts and reset, deterministic Europe/London spring/autumn DST boundaries, overlap clipping, running entries, cross-midnight List/Timesheet allocation, cache-row precedence, SQL overlap construction, toolbar/shell ownership, hydration/request guards, responsive CSS, and primitive disabled state.

A final smoke restarted `next start` from the exact broad-validation build. The canonical Timeline loaded with one toolbar, no duplicate `/api/bootstrap`, no page overflow or framework overlay; one uncached Next-week action made exactly one `/api/bootstrap?date=2026-07-30` request and committed the expected 27 July-2 August range.
