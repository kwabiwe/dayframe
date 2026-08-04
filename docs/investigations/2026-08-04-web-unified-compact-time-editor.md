# Web Unified Compact Time Editor

Date: 2026-08-04
Status: Active branch, draft PR pending
Baseline: `136b049` (`origin/main`, including PR #158)
Branch: `codex/web-unified-compact-time-editor`

## Problem

Dayframe had two web time-entry editing implementations. Calendar used the newer anchored compact editor, while Timeline List and Reports still mounted `EditTimeEntryDialog`. The split duplicated temporal, tag, validation, focus, discard, mutation and responsive behavior, and left Calendar Enter/double-click on a separate advanced path. The Calendar editor also did not own reusable tag editing, used visibly separate date text, and could not express a multi-day Finish compactly.

The target is one category/task-first quick editor across Calendar, Timeline List and Reports. Place stays visible in surrounding rows but is intentionally not editable here; task Suggestions and legacy project/client controls are also outside this surface.

## Implemented Architecture

- `TimeEntryQuickEditor` now owns one controller and one panel for entry/create drafts, temporal synchronization, tag/category selection, validation/overlap feedback, discard state, motion, save/start/delete actions and live running presentation.
- Calendar keeps its exact-fragment anchored portal and positioning owner but renders the shared panel. Pointer, Space, Enter and double-click all resolve to the same idempotent selection/editor path; repeated activation cannot replace a dirty draft.
- Timeline List and Reports render that panel inside one centred, focus-trapped, mobile-safe modal. List keeps representative-occurrence editing, Start again, Delete and Timeline's existing five-second Undo owner. Reports omits Start again and Delete.
- The legacy `EditTimeEntryDialog` is deleted. Its Place, task-suggestion and full-form UI are not copied into the new editor.
- Description reuses `InlineTagInput`. Existing tags hydrate into the draft; create/select/remove and the shared 24-tag cap work inside the same save/discard boundary. Portalled tag/suggestion panels are viewport-clamped nested surfaces.
- The temporal row contains time plus an icon-only portalled shared date picker. Closed pickers expose the selected date in their accessible name; Escape/selection returns focus to the icon. Finish renders a visible and accessible `+N` when its local date follows Start.
- Draft/save plans include `tagNames`. Completed and running saves emit only quick-editor-owned partial fields and never `placeId` or compatibility metadata. The active-timer optimistic projection carries the same tags through every bootstrap/timer collection while preserving Place and other hidden fields.
- A live running-duration refresh is explicitly excluded from dirty comparison because Duration is read-only presentation state until the entry stops.

## Motion Contract

- Triggers: Calendar select/create, Timeline List Edit, Reports Edit, clean/dirty dismissal, nested picker open/close, save success/failure, Start again, Delete and active-entry stop transition.
- Single owners: Calendar owns anchored top/left placement; the modal backdrop owns centring; `TimeEntryQuickEditor` owns panel entrance/exit and footer state; nested tag/date components own only their own portals.
- Entrance/update/exit: anchored entrance is 140ms opacity plus at most 4px translation; modal entrance is 180ms with the same bounded translation; feedback state crossfades in one fixed-height plane without editor reflow; exit is 90ms and pointer-disabled.
- Surrounding layout: all editor surfaces are `document.body` portals. Calendar coordinates never animate. Modal backdrop is fixed. Category/tag/date menus float out of flow. At narrow widths Duration wraps before the temporal controls stack.
- Interruption: a close token invalidates stale exits; Calendar selection sessions reject stale dismissals; an already selected block is idempotent; nested Escape closes only the nested owner; busy mutations block replacement/dismissal.
- Async and rollback: completed saves retain the draft/error on failure. Running saves use the shell mutation gate, one partial PATCH, one canonical refresh and exact bootstrap/timer-draft rollback. Delete hands off to Timeline's existing Undo lifecycle.
- Reduce Motion: entrance/exit and feedback transitions reduce to effectively instant opacity with no spatial movement; focus, dismissal, rollback and state ownership remain identical.

## Automated Coverage

Coverage includes:

- tag hydration, create/select/remove, tag-only/mixed partial payloads and create payloads;
- Place omission/preservation across description, category, tags and temporal edits;
- exact timestamp/DST ownership, multi-day offsets and running-to-completed transition;
- running optimistic tags across all collections with one PATCH/refresh and exact rollback;
- Calendar click/Space/Enter/double-click routing and dirty-draft idempotence;
- shared modal fields/actions, nested tag/date Escape, focus return, Cancel/backdrop discard and Reports action restrictions;
- deletion of the legacy dialog contract and shared Calendar/List/Reports architecture.

Primary files:

- `apps/web/src/components/TimeEntryQuickEditor.tsx`
- `apps/web/src/components/timeEntryQuickEditor.dom.test.tsx`
- `apps/web/src/lib/calendar-entry-compact-editor.test.ts`
- `apps/web/src/lib/timer-runtime.test.ts`
- `apps/web/src/components/calendarClickCreate.dom.test.tsx`
- `apps/web/src/components/calendarEntryActions.contract.test.ts`

## Local Browser Evidence

Local optimized build, supported `DAYFRAME_AUTH_MODE=dev`, local demo workspace only. No hosted or production credentials/data were used.

PASS so far:

- Calendar running-entry editor at 1440x1000 in Dark: exact anchored portal, hydrated tag, icon-only Start date, `Running` Finish, live read-only Duration and bounded lower-edge placement (`top 613.94`, `bottom 988`, 12px viewport margin).
- Nested Tags and Start date pickers remained portalled; Escape closed the nested surface and returned focus to the exact trigger without closing the editor.
- Timeline List used the same modal panel with Start again/Delete/Cancel/Save. Reports used the same modal without Start again/Delete.
- Dirty Reports Cancel switched to the exact fixed `Discard changes?` / `Go back` / `Discard` plane; Discard closed without persisting the disposable draft.
- Responsive measurements had no horizontal overflow at 390x844, 350x700 or 720x450. The 390px modal was 366px wide with 12px gutters; the 350px footer used its reserved 104px two-row geometry; the short-wide modal remained bounded.
- Explicit Light and Dark surfaces rendered with no document overflow. Captures are stored outside the repository under `/tmp/dayframe-qa/web-unified-compact-time-editor/`.
- The browser pass exposed a running-duration dirty-state regression after the Calendar's clipped running entry refreshed. The fix excludes presentation-only live Duration from active-entry dirty comparison and adds a focused regression test. After the final build, the rebuilt editor remained in `data-feedback-mode="default"` through the live refresh and nested Tags round-trip, then Close removed it with no discard dialog.
- Final rebuilt-browser console inspection returned no warnings or errors.

Current limits:

- The local browser reported normal motion (`prefers-reduced-motion: reduce` was false). Reduce Motion remains automated CSS/contract evidence unless a reduced-motion browser session is available.
- The local seeded range exposed one long-running entry, so completed/cross-midnight/overlap/tag-create persistence remains automated coverage rather than claimed rendered local evidence.

## Validation

Final local results:

- PASS: focused quick-editor temporal/modal tests, 26 tests.
- PASS: `npm run lint`.
- PASS: `npm run typecheck` across mobile, web and shared.
- PASS: `npm run test` with 1,132 tests: 330 mobile, 664 web and 138 shared.
- PASS: `npm run build`, optimized Next.js build with 32 generated static pages.
- PASS: `npm run check:brand-assets`.
- PASS: `git diff --check`.
- PASS: rebuilt local optimized-browser verification and zero console warnings/errors.

The Preview/staging evidence and exact hosted limitations remain pending until the branch is published.

## Hosted Preview And Staging

Pending draft PR and Ready Preview. Production must remain unchanged. Stable staging may move only to the exact Ready branch Preview; authenticated staging and the mobile preview-profile smoke are recorded `PASS`, `FAIL`, or `NOT RUN` independently.
