# Web Timeline unified workspace follow-up

Date: 2026-07-31
Status: implemented and validated
Scope: Web Timeline composition, active-entry reconciliation, compact tag presentation, and tag mutation compatibility

## Inputs and preflight

- Reviewed the unified-workspace follow-up plan, annotated PDF, and both supplied screenshots.
- Read the PRD, feature/fix tracker, regression checklist, brand guide, product model, style, components, motion, debugging playbook, validation matrix, and the four related Timeline/timer investigations.
- Fast-forwarded local `main` to `origin/main` at `857b477` and created `codex/web-timeline-unified-workspace-followup`.
- The only pre-existing worktree state was clean. Generated PDF inspection files under `tmp/pdfs/` are local QA artifacts and must not be committed.

Baseline checks before editing:

```text
npm run typecheck -w @dayframe/web
PASS

npm run test -w @dayframe/web -- src/lib/timeline-view.test.ts src/lib/timeline-calculations.test.ts src/lib/timeline-entry-groups.test.ts src/lib/timeline-delete-undo-controller.test.ts src/components/timelineRangeToolbar.contract.test.ts src/components/webGroupedTimelineSettings.contract.test.ts src/components/persistentTimerShell.contract.test.ts src/components/inlineTagInput.contract.test.ts src/components/calendarEntryActions.contract.test.ts
PASS: 9 files, 78 tests

npm run build -w @dayframe/web
PASS: Next.js 16.2.9 production build, 32 pages
```

## Evidence and root causes

### Detached view width and surface

`AppShell` rendered the timer shell and Timeline `main` as siblings, while the toolbar and each view added their own surface/radius. Independent horizontal padding and rounded owners made Calendar/List/Timesheet read as detached cards. The fix gives the route one shell-owned semantic surface and makes the timer, toolbar, and selected view direct sections inside it. Dashboard retains its standalone timer presentation.

### Calendar overlap and sticky gap

Calendar block lane layout assigned increasing `z-index` values, while the sticky date headings used only `z-index: 3`. Dense blocks could therefore paint over the headings. The day bodies also did not form isolated stacking contexts. The fix raises the fixed header layer and isolates every day body, with the per-view scroller remaining the single scroll owner. Removing the extra view-title row eliminates the exposed strip between the toolbar and sticky header.

### Running-entry grouping

The shared grouping key used only category, normalized description, and tags. A running entry matching a completed entry therefore joined the completed occurrence group. A running row now has the unique key `running:<entry-id>`; completed and Uncategorized grouping rules are unchanged.

### Active metadata switching

Bootstrap payloads did not expose `time_entries.updated_at`. `AppShellRuntime.commitData` accepted page hydration, cached date data, and network payloads without comparing versions, and its timer fingerprint initialized once with `updatedAt: null`. A stale RSC/cache payload could overwrite a newer optimistic/canonical active entry, while polling could repeatedly rediscover the same version mismatch. Browser testing also exposed the converse edge: the timer draft only rehydrated when the active ID changed, so a genuinely newer same-ID external edit could be accepted and then autosaved over by the older draft. The fix exposes an authoritative entry version, reconciles same-entry versions before commit, keys draft hydration by ID and version, prevents passive hydration from reviving stale active state, advances the timer fingerprint after accepted canonical commits, and consumes the PATCH version before refresh. Canonical fetches still accept genuine newer edits, stops, and active-id switches.

## Documentation conflict

The earlier fixed-workspace investigations described a dedicated fixed title row for each selected view. The current plan and annotated revision explicitly remove Calendar, List, and Timesheet title rows. This investigation follows the newer requested composition while retaining the earlier ownership invariants: one URL range/view owner, one shell timer owner, one scroller per selected view, fixed browser document, and Timeline-level delete/Undo.

## Motion contract

- Triggers: date/scope/view changes, per-view scrolling, Calendar zoom, tag selection/removal/overflow, Play restart, active-entry refresh, delete/Undo, and responsive reflow.
- Owners: the runtime shell owns timer data and mutations; the outer Timeline surface owns composition; each selected view owns exactly one scroller; `InlineTagInput` owns its selector; bootstrap reconciliation owns version acceptance.
- Entrance/update/exit: view and range updates reuse the existing client URL transition and scroll-memory behavior; local running totals tick without network or layout replacement; tag pills update in place; delete/Undo retains its existing enter/exit notice.
- Interruption: the timer mutation gate rejects rapid repeat mutations; request ids reject superseded loads; entry versions reject stale same-entry commits; a newer canonical stop or active-id change is accepted.
- Async rollback: failed timer mutations restore the captured bootstrap/draft and retain calm inline feedback; failed date loads keep the current view; delete/Undo keeps its established rollback owner.
- Surrounding layout: controls and headers reserve their final geometry. The view body is the only scroll region and does not move the timer or toolbar.
- Reduce Motion: no new essential animation is introduced. Existing motion is disabled or reduced by the established media query; local clocks and semantic state updates remain available without animation.

## Data and API contract

- `TimeEntryRow.updatedAt` is the canonical active-entry version, selected by range and active-entry queries.
- `PATCH /api/time-entries/:id` returns `{ ok, id, updatedAt }`.
- New/renamed tags use a 32-character mutation boundary.
- Existing 33–48-character tags retain the legacy read/identity boundary and may be removed or reattached. A missing tag over 32 characters is not created implicitly.
- Time-entry tag arrays remain capped at 24.

## Closure evidence

### Browser acceptance

- Exercised the real local app against the disposable Docker Postgres database in the in-app browser.
- Validated 1440×900, 1280×720, 1024×768, 768×844, 720×844, and 390×844. At every size the document had no horizontal or vertical overflow, the timer/toolbar/view shared equal outer edges, exactly one timer was mounted, and all redundant view-title rows were absent.
- Validated light and dark presentation. The host system preference was dark. Reduced Motion emulation was not available in this browser session; the changed experience adds no essential transition and the existing reduced-motion stylesheet path was reviewed.
- Calendar Day and Week: all three zoom heights (1536, 2208, and 3072 CSS pixels), fixed header layer (`z-index: 40`), isolated body layer (`z-index: 0`), blocks passing behind the opaque heading, and adjacent-date/view-switch scroll restoration.
- List: active row isolated from the equivalent stopped segment, Play restart left exactly one active database row, immediate Delete/Undo restored the row, and compact tags/controlled wrapping held at phone width.
- Timesheet: no title row, internal scrolling retained, and Activity remained frozen.
- Reports links resolved exactly to `/reports?range=custom&from=2026-07-31&to=2026-07-31` and `/reports?range=custom&from=2026-07-27&to=2026-08-02`; browser Back returned to Timeline.
- Tag fixtures covered direct removal, `+N` selector access, four and 24 selections, a 32-character new tag, rejection of a 33-character new tag, and removal/reattachment of a seeded 48-character legacy tag.
- Local QA images (not committed): `/tmp/dayframe-qa/timeline-list-light-1440x900.png`, `/tmp/dayframe-qa/timeline-calendar-sticky-light-1440x900.png`, `/tmp/dayframe-qa/timeline-timesheet-light-1440x900.png`, `/tmp/dayframe-qa/timeline-list-light-1024x768.png`, `/tmp/dayframe-qa/timeline-list-light-390x844.png`, and `/tmp/dayframe-qa/timeline-list-dark-390x844.png`.
- The interaction matrix ran against the development server. The optimized production build passed, but the in-app browser tab could not be reattached after the intentional server restart because its local URL was rejected by the browser URL policy; no production-browser claim is made.

### Five-minute reconciliation soak

- Active ID: `52b0371f-a607-4196-9d56-d885147c0879`.
- Edited metadata: `Soak reconciled task`, category `Work`, 23 tags.
- Mutation plus observation window: 116 `GET /api/timer-state`, 2 `GET /api/bootstrap`, 1 `PATCH /api/time-entries/:id`, and no additional POST/DELETE mutation.
- Passive five-minute portion: 105 timer-state requests, 1 scheduled Bootstrap refresh, and 0 PATCH requests.
- Final database check returned exactly one active row with the same ID and edited metadata. Timer bar and List agreed; the stopped pre-restart segment remained separate; no regrouping flicker, old/new switching, duplicate timer, repeated PATCH loop, runtime overlay, or server-console error appeared.

### Automated validation

```text
npm run lint
PASS: web ESLint

npm run typecheck
PASS: mobile, web, and shared TypeScript

npm run test
PASS: mobile 44 files / 311 tests; web 89 files / 548 tests; shared 8 files / 133 tests

npm run build
PASS: Next.js 16.2.9 optimized production build; 32 static pages generated

npm run check:brand-assets
PASS: Brand asset contract OK

git diff --check
PASS
```
