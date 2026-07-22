# Web Dashboard Intelligence

## Scope and baseline

Phase 3 of the Dayframe web-overhaul programme only. This change makes the Dashboard answer the selected day/week questions without duplicating Timeline or redesigning Reports. It does not alter the persistent timer architecture, add project/client UI, add a migration, deploy, merge, or begin Phase 4.

Base: `origin/main` at `32f9e4f4f48850332d02bb624e4596124a52f79d`, the exact merge commit for PR #94.

Branch: `codex/web-dashboard-intelligence`.

## Current-main reproduction and source review

Before editing, the exact PR #94 merge was built and run in the actual in-app browser at 1440x900 against a disposable seeded PostGIS database.

- The Phase 2 shell was present: one sticky, shell-owned timer and a selected-date row sat above Dashboard content.
- Dashboard still used four tall legacy metric cards, then embedded a complete editable Day/Week timeline with zoom, context actions and resize affordances. That repeated the dedicated Timeline route and pushed useful review/activity content down the page.
- No category allocation, top-category insight or equivalent previous-period comparison was present. The goal signal was embedded in a large card rather than adapting cleanly between day and week.
- Legacy Dashboard summaries used start-time collections. Reports already use clipped overlap math with `least(stopped_at/now, rangeEnd) - greatest(started_at, rangeStart)`, so cross-midnight entries could disagree between the two surfaces.
- The shell runtime remained the correct timer owner. Dashboard receives its live `BootstrapData` projection from `AppShellRuntimeProvider`; no second active-entry poll or mutation path is needed.

The original standalone PDF review referenced by the programme was not present in the supplied attachment, repository, iCloud Downloads or Spotlight results. The programme's recorded PDF findings and a current-main browser reproduction were therefore used as the evidence trail. Still relevant: oversized Dashboard cards, weak intelligence hierarchy, duplicate Timeline content and inconsistent range calculations. Outdated after PR #94: screenshots showing the old top bar, duplicate page-owned timer, old navigation and misplaced date controls. Reports' large empty chart canvas remains relevant to Phase 4 and is intentionally unchanged here.

## Implementation plan

1. Add pure, tested helpers for day/week periods, clipped entry overlap, category allocation, top-five-plus-Other grouping, goals, previous-period comparison, top category and filter-intent URLs.
2. Replace the legacy Dashboard metric/timeline composition with compact summaries, allocation, progress/insight and review/activity sections while consuming the existing shell runtime.
3. Consolidate Dashboard styles in the existing stylesheet sections and reuse the Phase 1 segmented control.
4. Validate calculations, accessibility, responsive/theme states and browser behaviour before opening a draft PR.

## Architecture and calculation decisions

- `AppShellRuntimeProvider` remains the sole timer owner. Dashboard only consumes `useRuntimePageData`; no timer polling, mutation ownership or active-entry store was added.
- Dashboard combines and de-duplicates existing bootstrap entry collections by ID. Bootstrap time-entry reads are explicitly scoped by both workspace and user before the personal summaries are calculated.
- A running entry is included through the current client instant, matching Reports' use of database `now()`. Dashboard naturally advances on the shell runtime's existing refresh cadence; it does not create another interval.
- Entry duration is clipped to `[periodStart, periodEnd)`. This makes cross-midnight and running entries consistent with Reports overlap semantics.
- Week means Monday through Sunday around the selected date. Day compares with the immediately previous local day; Week compares with the previous Monday-through-Sunday period.
- Category ranking is duration descending with case-insensitive category name, then stable ID, as deterministic tie-breakers. The chart shows the top five categories plus one `Other` slice containing the remaining category IDs.
- Uncategorized is a named category with a hatch marker/slice, so colour is not its only identifier. Exact names, durations and shares are also exposed in linked legend rows, an SVG accessible name and a screen-reader table.
- Dashboard category links preserve `period`, local `start` and comma-separated `categories` intent. Reports does not consume the category parameter until Phase 4; this phase preserves the future-compatible URL without redesigning Reports.
- A missing or non-positive goal produces a safe Settings link. Percentages may exceed 100 while the visual bar clamps at 100. A zero previous period produces factual duration copy and no percentage, avoiding `Infinity`, `NaN` and misleading change claims.

## Motion contract

- Trigger and owner: the Dashboard's local React state owns Day/Week selection; the shared Phase 1 segmented control owns the interaction surface.
- Entrance, update and exit: summary content updates immediately in place with no spatial animation, delayed exit or layout-moving progress state.
- Surrounding layout: cards reflow through responsive grid breakpoints; the shell-owned timer and date context remain mounted and unchanged.
- Interruption and rollback: repeated mode changes are synchronous and latest-selection-wins; there is no async mutation or rollback path.
- Reduce Motion: the feature adds no animation. Existing global reduced-motion rules remain the fallback for shared controls.

## Files and impact

- Dashboard UI: `apps/web/src/components/DashboardRealtime.tsx`
- Pure calculations and focused tests: `apps/web/src/lib/dashboard-intelligence.ts`, `apps/web/src/lib/dashboard-intelligence.test.ts`
- Personal bootstrap entry scoping: `apps/web/src/lib/queries.ts`
- Consolidated Dashboard styling: `apps/web/src/app/globals.css`
- Tracking: this investigation and `docs/feature-fix-tracker.md`

No schema, migration, API route, response shape, timer runtime, event-first write path, mobile contract, Reports component or production configuration changed. No private source data is logged or added to analytics.

## Validation

Automated validation passed on 2026-07-22:

- repository lint and all mobile/web/shared typechecks
- 33 mobile files / 237 tests, 44 web files / 236 tests and 5 shared files / 94 tests
- focused Dashboard intelligence file / 16 tests
- repository and explicit web production builds
- brand-asset contract and `git diff --check`

Actual in-app browser validation used the disposable `dayframe_phase3_qa_20260722` PostGIS database and the production Next.js build.

- 1440x900, 1280x720, 1024x768 and 390x844 each measured zero document-level horizontal overflow, one persistent timer, zero embedded Dashboard timelines, three compact summary metrics, matching visible allocation/accessibility rows and no runtime alert/overlay.
- System, Light and Dark were selected through the actual Settings controls. The System browser reported a dark colour-scheme preference; both explicit companion themes retained chart contrast and layout.
- Day and Week switched in place. Week changed the period to 20-26 July, selected the 40-hour weekly goal, changed comparison wording to previous week, and retained zero phone overflow. Reload restored the documented default Day state while the running timer remained singular and active.
- The running Learning entry advanced through the existing shell refresh and contributed only through the current instant. A synthetic 10-hour entry owned by another user in the same disposable workspace did not change the signed-in user's Dashboard total.
- A 60-character synthetic category name stayed present in the accessible chart summary/table and truncated only its visible legend label at narrow widths. The allocation link opened `/reports` with day/start/category intent intact.
- A future selected day produced the useful no-tracked-time state, `0m` total and safe `0%` daily-goal progress while the shell's currently active timer remained visible.
- Keyboard focus on the shared segmented control showed one two-pixel focus outline with no stacked shadow. The browser automation surface focused controls correctly but did not dispatch Enter/Space activation; pointer activation and state semantics were exercised separately.
- The loaded production CSS contains the global `(prefers-reduced-motion: reduce)` rule that collapses transition/animation duration, and the Dashboard introduces no transition or animation of its own. The in-app browser exposed viewport emulation but no motion-media emulation, and macOS rejected a temporary `com.apple.universalaccess` preference write, so an actual `matchMedia(...reduce)` state could not be forced in this run.
- The in-app browser exposed no console-log stream. The production server terminal stayed clean, browser runtime alerts/overlays were empty, and all navigation/refresh interactions completed without a runtime error.

The disposable database contains only synthetic seeded QA rows. No production or hosted data was queried or modified.

## Release and rollback

No merge, deployment, hosted database operation or Phase 4 work is authorised. Rollback is a focused PR revert; no database rollback is required.

## PR

Draft PR [#95](https://github.com/kwabiwe/dayframe/pull/95) from `codex/web-dashboard-intelligence`; review only.
