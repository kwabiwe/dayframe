# Web Unified Compact Time Editor

Date: 2026-08-04
Status: Draft PR [#159](https://github.com/kwabiwe/dayframe/pull/159), unmerged
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

## PR #159 Follow-up: Quick Editor And Calendar Blocks

Reported regressions covered by this follow-up were the selected-tag `X` sitting above its text baseline, date icons reading as separate circular buttons, second-precision Duration copy, blur-only temporal synchronization, running ticks affecting dismissal, no Description Enter-to-save shortcut, fragmented Calendar block metadata, and Play disappearing solely because a lane suppressed text.

Implementation decisions:

- The editable draft now carries internal `durationSeconds` separately from the visible minute-only `HH:MM` value. Untouched `01:15:29` displays `01:15` while no-op, Description-only and tag-only saves retain the original exact instants and 4,529 seconds. Untouched sub-minute entries display `00:00` and remain exact. A deliberate Duration edit becomes a whole-minute value.
- Duration accepts `30`, `30m`, `90`, `90m`, `1:30`, `01:30`, `1h30m`, `1h 30m` and compatibility `1:30:00`; explicit non-zero seconds are rejected. Edited duration has a one-minute minimum and unbounded hours.
- Complete valid Start, Finish and Duration input synchronizes its dependent fields during `onChange`. Incomplete input such as `11:` remains raw and preserves the last valid dependent fields without an error until blur or Save.
- Plain Enter from Description calls the same mutation-gated Save function as the button. Inline hashtag suggestions consume Enter first; modifier Enter and IME composition do not save. Validation/server failure retains the exact editor draft, while a no-op existing entry closes without PATCH.
- Dirty state compares the live draft against one immutable editor-session baseline. The one-second running clock remains presentation-only. A running-to-stopped hydration updates only the new Finish/Duration baseline and preserves any genuine user Start edit.
- The Start/Finish time input and date trigger are one `focus-within` compound field. The trigger retains a 44px target but has no circular fill in normal, hover, focus or open states. Invalid focus keeps the neutral compound perimeter plus a separate danger inset cue.
- Selected tag visuals use baseline alignment with the Lucide `X` optically lowered by 1px; the existing 44px target, 24px visual wrapper and hidden width measure remain shared.
- Calendar primary content is `Description · Category · #FirstTag +N`; blank Description falls back to Category and blank Uncategorized falls back to `Uncategorized`. The secondary line is the full canonical `Duration (Start – Finish)`, using `now` for running entries and local `+N` for cross-day Finish. All tag names remain in the accessible block label.
- Density is height/lane driven: below 18px no text; 18–23px fallback only; 24–39px full primary; 40px and above primary plus secondary; `title` lanes use fallback and `none` lanes use no text. Direct resize remains 48px and above.
- Completed blocks at least 24px high may mount pointer-hover Play regardless of lane text density. Selected, running and resizing blocks reject it; a named inline-size container hides it below 28px rendered width. The stable right action lane prevents hover reflow, and the first click owns the action while a double-click cannot start twice.

Motion contract remains owned by the existing React editor/Calendar CSS paths: the follow-up changes content and state updates inside the current entrance/update/exit surfaces, adds no animation owner, preserves the fixed feedback plane and stable block geometry, and retains the existing Reduce Motion overrides.

Follow-up local browser evidence used the optimized development-auth build with disposable event-first QA entries, all removed through the normal API after capture:

- PASS: Calendar rendered the full primary metadata order and complete secondary `Duration (Start – Finish)` line, including all-tag accessible names, `+N`, `now`, compact fallbacks and no text below 18px.
- PASS: completed blocks at least 24px high retained the stable Play lane even where lane text density suppressed text; automated contracts cover the selected/running/resizing/coarse-pointer/tiny-block exclusions and one-click ownership. The automation browser could not synthesize a real CSS `:hover`, so rendered hardware-hover reveal remains NOT RUN.
- PASS: the completed editor displayed `01:15` for an exact 4,529-second entry, normalized `90m` to `01:30` and moved Finish immediately, retained incomplete `11:` without dependent movement or error until blur, and then showed the validation error in the fixed feedback plane.
- PASS: plain Description Enter saved and closed from Calendar; no-op Enter closed without a mutation from Timeline List and Reports through the same shared panel. Focused DOM coverage supplies failure retention, modifier/IME exclusion, tag-suggestion precedence and rapid-repeat mutation gating.
- PASS: the date icon stayed visually seamless inside the compound Start/Finish field in normal, hover, focus and open states; tag text and `X` shared a measured baseline while preserving the 44px target.
- PASS: 1440x900, 1280x720, 1024x768, 768x844, 390x844, 350x844 and 720x450 had zero document-width overflow. The phone editor was 366px wide with 12px gutters and remained inside the 390x844 viewport. Explicit Light and Dark captures are outside the repository under `/tmp/dayframe-qa/pr159-editor-calendar-followup/`.
- NOT RUN: an emulated Reduce Motion browser session; the active browser reported normal motion. The existing CSS and contract coverage remains the evidence for that path.

## Validation

Final local results:

- PASS: focused quick-editor temporal/modal suites, including the final shorthand-completeness regression.
- PASS: `npm run lint`.
- PASS: `npm run typecheck` across mobile, web and shared.
- PASS: `npm run test` with 1,148 tests: 330 mobile, 680 web and 138 shared.
- PASS: `npm run build`, optimized Next.js build with 32 generated static pages.
- PASS: `npm run check:brand-assets`.
- PASS: `git diff --check`.
- PASS: rebuilt local optimized-browser verification and zero console warnings/errors.

The Preview/staging evidence and exact hosted limitations remain pending until the branch is published.

## Hosted Preview And Staging

- PASS: draft PR [#159](https://github.com/kwabiwe/dayframe/pull/159) remains open, draft and unmerged on `codex/web-unified-compact-time-editor`. The follow-up implementation commit is `b1aa669251fe8b9e042a97d4ef38401d18591d74`.
- PASS: follow-up Vercel deployment `dpl_5mk2azVJVetsCm3a6HSmrxXMyMKS` completed as target `preview`, status `Ready`, at `https://dayframe-cr7b0yx7f-dayframeworkshop.vercel.app`.
- PASS: direct Preview `/login` returned `200` and rendered the Dayframe provider login; anonymous `/api/bootstrap` returned JSON `401`. The deployment uses the project's Preview-scoped environment, including the configured staging identity variables; Vercel masks their values in CLI output.
- PASS: the existing staging tag schema required by this editor was checked read-only: tag/workspace columns, normalized-name/workspace unique constraints, workspace-qualified association foreign keys, and workspace-member tag/association RLS policies are present. This PR adds no migration.
- PASS: the stable `dayframe-staging.vercel.app` alias was explicitly assigned to that exact Ready Preview. `vercel inspect` resolved the alias to `dpl_5mk2azVJVetsCm3a6HSmrxXMyMKS`; stable staging `/login` returned `200`, and anonymous `/api/bootstrap` returned JSON `401`.
- PASS: production was not moved. `dayframe-web.vercel.app` continued to resolve to separate Ready production deployment `dpl_AcNzWzah1knjLxMwy43KbZek6qbu` at `https://dayframe-7be352pod-dayframeworkshop.vercel.app`.
- NOT RUN: authenticated staging Calendar/List/Reports edit/save/delete/Undo parity. No staging login credentials were available in the workspace or connector session, so no authenticated data mutation is claimed.
- NOT RUN: staging-pinned mobile `preview` profile smoke on a physical iPhone. No device/build session was available, and this PR changes no mobile code or web/mobile API route contract.

This documentation evidence creates a final docs-only branch head after the implementation Preview above. The stable alias must be rechecked against the final Ready branch Preview before handoff; production remains untouched.
