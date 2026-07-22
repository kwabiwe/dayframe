# Web Reports Overhaul

## Scope and baseline

Phase 4 of the Dayframe web-overhaul programme only. This change rebuilds Reports as a personal analysis surface. It does not begin Phase 5, alter the persistent timer owner, redesign Dashboard, add project/client presentation, deploy, merge, or add a database migration.

Base: `origin/main` at `d30bb1cbb517a1f2cc8873749a41e472e0ed485c`, confirmed as the exact merge commit for PR #95.

Branch: `codex/web-reports-overhaul`.

## Current-main reproduction and original review

The untouched PR #95 merge was linted, typechecked, tested, built, and run in the actual in-app browser at 1440x900 and 390x844 against a disposable seeded PostGIS database before editing.

Still relevant from the programme's recorded PDF review:

- Reports did not answer total, daily average, active-day, previous-period, tag, or matching-entry questions in one coherent flow.
- The range control exposed only Day, Week, Month and a confusing Custom form with no Cancel action.
- Filters, bookmarkable state, CSV export and entry detail were absent.
- Source and place competed with category as primary analysis, while tags were missing.
- The daily chart had a severe empty-day error: the left join plus `coalesce(te.stopped_at, now())` treated an unmatched row as a full day. A three-hour selected total rendered as 51 hours across the trend.

Outdated after Phases 1-3: screenshots of the old top bar, duplicated timer ownership, old navigation, purple focus treatment and earlier Dashboard composition. Those foundations were preserved rather than redesigned.

The standalone original PDF was not present in the supplied attachment or repository. The complete attached programme, the prior Phase 3 evidence note and current-main browser reproduction were used to distinguish current issues from stale screenshots.

## Implementation plan

1. Establish one typed, validated URL filter/range model and normalize provisional Dashboard URLs.
2. Replace independent report queries with one user/workspace-scoped candidate set, clipped current/previous ranges and a structured response.
3. Recompose Reports around summary, trend, category, tag, secondary insight and bounded detail sections using Phase 1 controls.
4. Add an authenticated CSV route that reuses the same parser and filtered-entry CTE.
5. Validate calculation/security contracts, real SQL/query plans and the full browser matrix before opening a draft PR.

## Information architecture and filter model

The page now follows this order:

1. Date range and period navigation.
2. Always-visible Categories and Tags filters, applied chips and collapsed More filters.
3. Total tracked, daily average, active days and previous-period comparison.
4. Daily trend.
5. Category allocation and ranked tag breakdown.
6. Collapsed place/source insights.
7. Matching entry detail with edit and pagination.

The URL is the single source of truth. The canonical schema is:

`/reports?range=<preset>&from=YYYY-MM-DD&to=YYYY-MM-DD&categories=<ids>&tags=<ids>&places=<ids>&sources=<values>&description=<text>&sort=<newest|duration>&page=<n>`

- Lists are comma-separated, de-duplicated and bounded.
- Category and place filters support `uncategorized` and `no-place`.
- Unknown presets, dates, sources, UUIDs, sort values and pages fall back safely.
- Valid UUIDs not present in the current workspace options are removed before querying.
- The serializer owns links for filters, chips, navigation, Dashboard and CSV.
- Legacy `period/start/end` links normalize to the canonical custom range.
- Back, Forward, refresh and direct bookmarks reconstruct state from the URL; local storage is not used.
- Clear all returns to an unfiltered This week view.

## Date and duration rules

Presets: Today, Yesterday, This week, Last week, Last 7 days, This month, Last month and Last 30 days, plus Custom.

- Custom displays From, inclusive To, Apply and Cancel.
- The server converts the visible To date to the next local midnight as an exclusive boundary.
- Previous/next shifts the complete calendar-day duration and preserves all other filters.
- Future navigation is disabled when the next period begins after today.
- Custom ranges are capped at 366 calendar days.
- Boundaries are built by local calendar arithmetic, not fixed 24-hour milliseconds, so DST days remain correct.

Matching uses:

`te.started_at < range_end and coalesce(te.stopped_at, captured_now) > range_start`

Duration uses:

`least(coalesce(te.stopped_at, captured_now), range_end) - greatest(te.started_at, range_start)`

The same captured `now` parameter is reused through one report request. Running entries are clipped to now/range, labelled Running in detail, and exported with a Running finish label.

## SQL design and isolation review

`ReportQueryInput` is parsed once. `report-service.ts` builds one statement with:

- `candidate_entries`: current and previous period candidates, scoped by both `te.workspace_id = session.workspaceId` and `te.user_id = session.userId`;
- `filtered_entries`: current-period clipped rows;
- `previous_filtered_entries`: previous-period clipped rows;
- category, tag, place, source, daily and bounded detail projections from the same matching set.

Category and place joins are workspace-qualified. Tag filters use `EXISTS` with ANY semantics, so multiple selected tags do not multiply entry duration. Tag totals may overlap by design; category totals partition the report total. Detail tags are correlated aggregates after pagination, avoiding duplicate rows and N+1 application queries. Description search uses a trimmed bound parameter with `position(lower($value) in lower(description))`; `%` and `_` are literal text rather than wildcards.

Filter option IDs are read only from the active workspace. Every entry query remains personally scoped. On the representative disposable database the selected user's 37 entries/34,395 seconds and another user's 73 entries/172,800 seconds remained distinct in the same workspace. Foreign-workspace category, tag and place IDs produced no chips, exposed no foreign labels, and did not narrow or broaden the signed-in user's dataset.

## Response and presentation decisions

The structured result contains range/applied-filter metadata, total and previous seconds, comparison, daily average, active days, category/tag/place/source rows, zero-filled daily series, bounded entries, pagination and captured now.

- Daily average divides by selected calendar days; active days count positive daily buckets.
- Previous-period copy is factual and handles zero denominators without Infinity or NaN.
- Ranges through 62 days render one accessible bar per day. Longer ranges aggregate sequential seven-day buckets; 366 days render 53 readable bars.
- Category allocation reuses Phase 3's tested top-five-plus-Other helper. Its total is centred in the donut; linked legend and exact table provide equivalent keyboard/text access.
- Donut segments and filter options have explicit Enter/Space activation.
- Uncategorized has named, hatched treatment and is never identified only by colour.
- Tags use ranked bars and explicitly explain overlap.
- Places and friendly source labels sit under More insights.
- Detail is a semantic table on wider screens and a labelled card/list layout below 760px. It defaults newest-first, supports duration sort, pages at 25 entries, and reuses `EditTimeEntryDialog`; save refreshes the current URL.

## Motion contract

- Trigger and owner: Next URL navigation owns filter/range/sort/page updates. Native details/select controls own disclosure presentation; the shared dialog owns edit presentation.
- Entrance/update/exit: report data replaces in place after navigation. No chart entrance, spatial filter transition or layout hand-off was introduced.
- Surrounding layout: responsive CSS grids reflow cards and detail rows without a second animation owner.
- Interruption and rollback: browser history is authoritative. Repeated selections are latest-navigation-wins. Existing edit-dialog error handling owns failed saves; successful saves refresh without changing the URL.
- Reduce Motion: the only new transition is a short disclosure-chevron rotation. Dayframe's global reduced-motion rule collapses transition and animation durations; data and focus state do not depend on motion.

## CSV design

`GET /api/reports/export` resolves an authenticated `exports:read` request session, parses the same URL model, sanitizes the same scoped option IDs and reuses the filtered-entry CTE. It returns private/no-store UTF-8 CSV with an attachment filename containing the inclusive date range.

Columns: Date, Start, Finish, Duration, Description, Tags, Category, Place and friendly Source. Commas, quotes, CR/LF and Unicode are escaped/preserved. Internal IDs, confidence, review state, raw payloads and credentials are not emitted.

## Query-plan findings and database impact

Existing relevant indexes include:

- `idx_time_entries_completed_health_overlap_lookup (workspace_id, user_id, started_at, stopped_at)` for confirmed/accepted entries;
- `idx_time_entries_active (workspace_id, user_id)` for running rows;
- `idx_time_entry_tags_workspace_entry` and `idx_time_entry_tags_workspace_tag`.

A disposable database was expanded with 50,000 second-user history rows and 50,000 old rows for the selected user, then analyzed. Exact generated statements were run with `EXPLAIN (ANALYZE, BUFFERS)`:

- with 50,000 rows isolated under another user, the unfiltered three-day report used `idx_time_entries_completed_health_overlap_lookup` and executed in 21.381 ms;
- with a deliberately extreme 50,000-row old personal history added, PostgreSQL chose a sequential scan and the complete multi-projection report executed in 101.866 ms;
- the tag-filtered report used `EXISTS`, de-duplicated matching entry IDs and used indexed entry lookups; 4.753 ms execution on the 100,000-row table;
- the tiny five-row tag association fixture used a sequential scan, which is appropriate at that cardinality.

No repeated historical full scan, duration-multiplying tag join or application N+1 was observed. Existing indexes are adequate for this phase. No local or Supabase migration was created or applied.

## Files changed

- Page/API: `apps/web/src/app/reports/page.tsx`, `apps/web/src/app/api/reports/export/route.ts`
- UI: `ReportRangeControls`, `ReportFiltersPanel`, `ReportsOverview`, `ReportDonutSegment`, `ReportDetailsTable`, and consolidated report styles
- Models/services: `report-filters.ts`, `report-service.ts`, `report-calculations.ts`, `report-csv.ts`
- Compatibility: Dashboard report links now use the canonical serializer
- Cleanup: removed the superseded `ReportBars` and `report-range` implementation and old report query from `queries.ts`
- Tests: focused filter, calculation, SQL/scope, CSV/route and accessibility/responsive contracts
- Documentation: this note and `docs/feature-fix-tracker.md`

No shared package, mobile contract, event-first write path, timer architecture, database schema or production configuration changed.

## Automated and database validation

Passed on 2026-07-22:

- `npm run lint`
- `npm run typecheck` across mobile, web and shared
- `npm run test`: 33 mobile files / 237 tests, 49 web files / 271 tests, 5 shared files / 94 tests
- `npm run build`
- `npm run check:brand-assets`
- `git diff --check`
- explicit web lint, typecheck, 49 files / 271 tests and production build

Database execution used realistic synthetic rows for multiple categories, Uncategorized, two tags on one entry, No place, cross-midnight, running, empty days, long names, pagination, another user and another workspace. It verified unfiltered and combined category/tag/place/source/description filters, literal case-insensitive description search, unique details, tag overlap, category partition, zero-filled days, current/previous clipping and identical CSV row selection.

## Actual-browser validation

The production Next.js build was exercised in the in-app browser at 1440x900, 1280x720, 1024x768 and 390x844. System, Light and Dark were selected through Settings. All 12 viewport/theme combinations measured zero document, page and detail horizontal overflow.

Validated interactions:

- all eight presets; Custom Apply/Cancel presentation; inclusive custom bookmarks; previous/next period preservation;
- category, multiple category, Uncategorized, tag, combined category/tag, place, No place, friendly source and trimmed description filters;
- More filters and More insights disclosures, filter chips, removing one chip, Clear all;
- refresh, Back/Forward, direct bookmark, current Dashboard link and legacy Dashboard URL normalization;
- keyboard activation of filter options and category donut segments, exact chart tables and visible focus;
- short and 366-day trends, zero-time days, category Other, tag overlap, long category/tag names, empty results and the running row;
- newest/duration sort, 25-row pagination with a 12-row second page, mobile detail cards, shared edit/save with URL/page preservation;
- authenticated filtered CSV download plus HTTP headers/content and escaping;
- mobile listbox internal scrolling and the edit dialog at 390x844: 366px wide from x=12 to x=378, within the viewport, with no page overflow;
- zero Next runtime overlays/error pages in the final pass and a clean production server terminal.

The in-app browser does not expose console messages or reduced-motion media emulation. Runtime overlays/alerts and the server terminal were used for error checks. The loaded production CSS and contract tests verify the global reduced-motion override; the feature adds no required spatial animation. A single in-app browser harness `This page couldn't load` interruption occurred while opening a deeply scrolled mobile dialog, recovered with Reload, and did not recur on two subsequent dialog runs or the final production build.

## Limitations, rollback and stop condition

- Place is multi-select because saved-place options are already available; No tags was intentionally not added.
- Tag semantics are ANY only. ALL is not exposed.
- Daily series aggregate weekly after 62 days; exact source days remain in the server result for current bounded ranges.
- Very large result sets use page-number navigation rather than infinite Load more.

Rollback is a focused PR revert. The old report components/query can be restored together; no data or schema rollback is required.

No merge, deployment, hosted database operation, migration, persistent-timer change, Dashboard redesign or Phase 5 work was performed.
