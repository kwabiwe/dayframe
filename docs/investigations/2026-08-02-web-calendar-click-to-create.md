# Web Calendar Click-To-Create

Date: 2026-08-02
Status: Draft PR [#156](https://github.com/kwabiwe/dayframe/pull/156) on `codex/web-calendar-click-to-create`; keep it unmerged until the remaining authenticated hosted and physical-device items below are complete.

## Scope

This slice adds a web-only empty-slot interaction to Timeline Calendar. One eligible primary fine mouse-pointer sequence on empty day-body space opens the existing compact Calendar editor in a real create mode. The clicked local wall time floors to the preceding 15-minute slot and proposes an exact 30-minute manual entry.

The change does not add mobile/native long-press creation, change resize snapping, introduce a migration, alter production configuration, deploy production, change TestFlight, or add a staging bundle identity.

## Baseline and source audit

- Baseline: `origin/main` at `0c83f45c86e4e9c0d0bce4558a777493a55aebf7` (merged PR #155).
- Existing local `.codex/qa/` artifacts were treated as protected and were not read, changed or staged.
- Baseline optimized browser behavior: empty Calendar day-body clicks did nothing; an entry click opened one compact editor; a clean outside click dismissed it; the persistent Plus path retained the full Add time editor.
- `CalendarReview` owns Calendar block geometry, selection, resize and editor targets.
- `CalendarEntryCompactEditor` owns its portalled panel, fixed feedback plane, validation, dirty decision, placement and transition.
- `AppShellRuntime.createManualEntry()` already owns manual-entry POST, mutation gating, the event-first route and canonical forced refresh.
- The compact editor's outside `pointerdown` listener runs in document capture, before the Calendar day body's bubble handler. Without explicit pointer identity, one blank-space pointer could dismiss the current editor and then create a new draft underneath it.

Baseline screenshot: `/tmp/dayframe-qa/web-calendar-click-to-create/baseline-calendar-day.png`.

## Interaction contract

An empty-space create sequence is accepted only when all of these remain true:

- primary `pointerType === "mouse"` input with button 0 and no control-click;
- down and up belong to the same pointer and visible day;
- the down target is the day body itself;
- movement stays below the existing six-pixel drag threshold;
- Calendar scroll changes by no more than one pixel during the sequence;
- no resize is active;
- the release target is still eligible day-body space;
- the pointer is not the exact pointer synchronously consumed by an editor's document-capture dismissal;
- the point is outside every block's semantic time rectangle, not merely outside its one-pixel-inset visual paint.

Touch/coarse input, right-click, drag, scroll, cancellation, lost capture, headers, the time axis, native scrollbars, blocks, inline actions, resize handles and the provisional anchor do not create.

If an editor is open, its outside-pointer owner publishes `{ pointerId, pointerDownTimeStamp, sessionId }` before clean dismissal or dirty-discard handling. The Calendar rejects that same sequence. A later independent click may create. Dirty Close, Escape and outside dismissal all use the existing `Discard unsaved changes?` decision.

## Time and target model

- Creation uses a separate floor-to-slot calculation; existing resize retains nearest-15-minute snapping.
- `10:07` floors to `10:00`; `10:14` also floors to `10:00`; `10:15` remains `10:15`.
- The default Finish is Start plus exactly 1,800,000 milliseconds, including DST boundaries.
- `23:45` becomes `00:15` on the next local date.
- The editor target is a discriminated `CalendarCreateEditorTarget`, not a fabricated persisted `TimeEntryRow`.
- Its baseline timestamps remain stable while `draftStartedAt` and `draftStoppedAt` drive provisional geometry.
- Visible date/scope is part of target identity, so navigation makes an old target ineligible without an effect-driven state cascade.

## Create editor and payload

Create mode reuses the compact editor's responsive placement, Description, Category, Start, Finish, Duration, overlap warning, validation, fixed feedback region, dirty decision and Reduce Motion behavior.

It differs from entry editing as follows:

- header label is `Create Calendar entry` / `New Calendar entry`;
- Description starts blank;
- Category starts Uncategorized;
- Duration uses full `h:mm:ss`, so the default reads `0:30:00`;
- Play/Start again and Delete are absent;
- Close and Save remain;
- the untouched click baseline is clean for dismissal but is a valid Save;
- successful Save calls `createManualEntry()` with only exact Start/Finish, `tagNames: []`, and nonblank trimmed Description/Category;
- no place, project, client or other compatibility metadata is invented;
- the active timer is not started, stopped or replaced.

A synchronous busy ref closes the rapid-activation window before React commits disabled state. Save keeps the target/editor open until the runtime reports success after canonical refresh. Failure clears busy state, announces the runtime error, and retains the exact draft and anchor.

## Provisional anchor and visual direction

The visual direction stays within Dayframe Midnight Core: the existing canvas/surface/inset system and coral action state remain unchanged. The new draft is a restrained neutral dashed slot with a soft surface tint. It is intentionally quieter than a canonical category-coloured entry.

The anchor:

- is a temporary `div` in the selected day body;
- has `aria-hidden="true"` and `pointer-events: none`;
- does not enter entries, totals, lane calculation or overlap analysis;
- clips at the day boundary and indicates next-day continuation;
- recomputes immediately from edited Start/Finish and the current pixels-per-hour zoom;
- is the real placement anchor registered before the portalled editor mounts.

## Motion contract

- Trigger: eligible blank-space pointer, field edit, Save, Close/Escape, clean outside dismissal, dirty decision, Calendar zoom/scroll and view/date/scope change.
- Owners: `CalendarReview` exclusively owns provisional anchor presence/geometry; `CalendarEntryCompactEditor` owns panel and feedback entrance/exit; the runtime owns mutation and refresh; canonical Calendar rendering owns the saved block.
- Entrance: anchor opacity only; editor uses its existing restrained opacity/maximum-four-pixel transition.
- Update: Start/Finish and zoom update anchor geometry immediately with no competing transform or layout animation.
- Exit: clean dismissal removes editor and anchor; dirty discard uses the existing decision; Save retains both while pending and exits only after refresh; failure retains both.
- Interruption: session identity rejects stale registration, dismissal and exit callbacks; exact consumed-pointer identity prevents dismiss-plus-create; rapid Save is gated synchronously.
- Reduce Motion: no travel is required for the anchor, and its opacity animation becomes effectively immediate alongside the existing editor treatment.

## Implementation map

- `apps/web/src/lib/calendar-click-create.ts`: floor snapping, cross-midnight/default-duration math, zoom-responsive anchor geometry, pointer eligibility/sequence/consumed-token checks and semantic-block hit testing.
- `apps/web/src/lib/calendar-entry-compact-editor.ts`: create source/draft/plan and exact minimal manual-entry input.
- `apps/web/src/components/TimeReviewViews.tsx`: create target/session, day-body pointer ownership, two-click consumed-pointer contract, semantic block data, provisional anchor and runtime save bridge.
- `apps/web/src/components/CalendarEntryCompactEditor.tsx`: discriminated entry/create modes, create actions/content, exact draft retention, full create duration, dirty Close/Escape and rapid-save gate.
- `apps/web/src/app/globals.css`: non-interactive dashed provisional anchor and Reduce Motion treatment.

## Automated validation

Focused checks completed during implementation:

- `npm run lint -w @dayframe/web` — PASS.
- `npm run typecheck -w @dayframe/web` — PASS.
- focused Vitest run covering click-create helpers, create plans and Calendar/editor/runtime contracts — PASS, 66 tests; the narrower post-guard run passed 51 tests.
- `DATABASE_URL=postgres://dayframe:dayframe@localhost:54322/dayframe_calendar_click_create_qa_test DAYFRAME_AUTH_MODE=dev npm run build -w @dayframe/web` — PASS after the dirty Close/Escape guard.
- final root `npm run lint` — PASS.
- final root `npm run typecheck` — PASS for mobile, web and shared.
- final root `npm run test` — PASS: mobile 44 files/314 tests, web 93 files/631 tests, shared 8 files/138 tests; 1,083 tests total.
- final root `npm run build` — PASS.
- `npm run check:brand-assets` — PASS.
- `git diff --check` — PASS.

Focused coverage includes floor examples, bottom edge, exact 30-minute duration, DST, 23:45 cross-midnight, zoom and scroll geometry, edited anchor geometry, mouse eligibility, right/secondary input, movement, scroll, cancel/lost sequence, exact consumed pointer, later independent pointer, semantic block gap, blank/trimmed/edited create inputs, hidden-field omission, invalid/reversed time and existing compact/timer contracts.

The final source-scope audit is repeated immediately before commit because any later code change invalidates the recorded gate.

## Optimized local browser and database evidence

Environment:

- optimized Next.js server with `DAYFRAME_AUTH_MODE=dev`;
- disposable database `dayframe_calendar_click_create_qa_test` on local port 54322;
- in-app browser at `http://localhost:3000/timeline?date=2026-08-02&scope=day&view=calendar`;
- seeded running timer left active throughout manual-entry creation.

Completed checks:

- `10:07` click opened create mode at `10:00`–`10:30`, `0:30:00` — PASS.
- provisional geometry measured 32 px at 64 px/hour and moved to 48 px for edited `10:15`–`11:00` — PASS.
- anchor measured `pointer-events: none`, `aria-hidden=true`, and canonical article count stayed unchanged before Save — PASS.
- dirty create outside click opened the discard decision and did not retarget — PASS.
- existing clean editor: first blank click dismissed only; second independent click created `12:00`–`12:30` — PASS.
- dirty Close and dirty Escape both opened the discard decision while preserving the exact field value and provisional target — PASS.
- right-click and >6 px drag created nothing — PASS.
- time-axis and day-header clicks created nothing — PASS. A macOS overlay scrollbar has no stable rendered hit strip; native-scrollbar rejection remains covered by target ownership and requires hardware/browser parity confirmation.
- the one-pixel visual gap below a rendered block resolved to the day body but was rejected by semantic geometry — PASS.
- Day and Week creation, including leftmost `2026-07-27` and rightmost `2026-08-02` Week columns — PASS.
- one-hour, 30-minute and 15-minute zooms produced the same `01:00`–`01:30` timestamps with proportional 32/46/64 px anchors — PASS.
- 1440×900, 1280×720, 1024×768, 768×844 and 390×844 fine-pointer layout checks opened a viewport-safe create editor with no horizontal document overflow — PASS.
- at the 720×450 compact-height equivalent, shrinking an open editor made its Calendar anchor non-visible and cleanly dismissed editor/anchor with no horizontal overflow. The existing responsive shell gives the Calendar scroller zero height at this artificial viewport, so new creation at that exact size was not possible — recorded limitation, not introduced by this diff.
- Light and Dark desktop/narrow create layouts — PASS. System appearance was not separately forced because the browser exposes only the app's Light/Dark toggle.
- Reduce Motion logic — PASS by CSS/contract inspection; browser media emulation was unavailable, so rendered transition timing is NOT RUN.
- untouched blank/Uncategorized Save at `10:00` created exactly one entry despite rapid double activation — PASS.
- persisted entry was `09:00`–`09:30 UTC` (`10:00`–`10:30 Europe/London`), with null Description/Category/Place and zero tag rows — PASS.
- `activity_events` count increased from 2 to 3 through the existing event-first runtime — PASS.
- seeded active entry `80000000-0000-4000-8000-000000000003`, Start `2026-08-02 18:15:04.501301+00`, null Finish and Description `Study session` was unchanged after creation — PASS.
- the overlap warning reported `Overlaps 1 entry by 15m`; warning-only Save persisted exactly one `16:30`–`17:00` local entry — PASS.
- the idle fixture exposed `Add time manually`; the full `Add time` dialog retained Category, Description, Tags, Start and Finish. The seeded active row was restored byte-for-byte immediately after this isolated route check — PASS.
- a disposable-database insert-failure trigger forced the manual POST to fail; the transaction rolled back and exact `Failure probe`, `11:00`–`11:30`, anchor and announced error remained — PASS. The trigger and function were removed immediately afterward.
- final optimized rebuild settled with five canonical blocks, no visible alert, no Next.js runtime overlay and no server error output — PASS. The in-app browser runtime did not expose console-message history, so a separate DevTools console-history assertion is NOT RUN.

Screenshot: `/tmp/dayframe-qa/web-calendar-click-to-create/create-light-10-00.png`.
Responsive stills: `/tmp/dayframe-qa/web-calendar-click-to-create/create-narrow-light-390x844.png` and `/tmp/dayframe-qa/web-calendar-click-to-create/create-narrow-dark-390x844.png`.
Short interaction recording: NOT RUN; the in-app browser control available in this session does not expose video recording. The complete sequence was exercised as individual real-pointer interactions instead.

## Hosted and device validation

Initial implementation-commit deployment evidence:

- PR: draft [#156](https://github.com/kwabiwe/dayframe/pull/156), base `main`, implementation commit `2f57d8b76e0e16c240f3ef764305b7db11b90e3d`.
- Vercel deployment: `dpl_HcriCiPb6onzuMgqovvdpYVjGBoj`, `target=preview`, `status=Ready`, URL `https://dayframe-2qpcf22ll-dayframeworkshop.vercel.app`.
- Vercel Preview exposes encrypted Preview-scoped `NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV`, provider-auth, public Supabase, database and location-rollout variables. Vercel redacted their values in this agent session, so variable presence and Preview targeting passed while an independent project-ref comparison was NOT RUN.
- Exact Preview `/login` returned Dayframe HTTP 200 and anonymous `/api/bootstrap` returned 401; no Vercel SSO barrier — PASS.
- The exact Ready Preview was assigned to `https://dayframe-staging.vercel.app`; Vercel inspection resolved the alias back to the same Preview deployment, staging `/login` returned 200 and anonymous `/api/bootstrap` returned 401 — PASS.
- Production `dayframe-web.vercel.app` remained on separate Ready production deployment `dpl_3RjPENnphD3vRqSR7tcYWKotJVwP`; no production alias/config/deployment was changed — PASS.
- A browser visit to the stable staging Timeline redirected to Dayframe `/login`; no staging credentials or authenticated session were available. Authenticated Calendar Day/Week, persistence, overlap, active-timer, Light/Dark, narrow and console checks are NOT RUN.
- This evidence-only documentation follow-up creates a newer PR-head commit/Preview. Its exact Ready deployment and final staging-alias target are recorded in the PR status and implementation handoff to avoid an endless deployment-observer commit loop.

Still pending:

- run the authenticated staging Calendar matrix with an authorised staging account;
- run the mobile preview profile against staging on a physical iPhone for compatibility only;
- verify touch/coarse web interaction does not create;
- verify physical mouse/trackpad native scrollbar behavior;
- verify Reduce Motion and hardware hover behavior.

Do not use production credentials/data, do not move `dayframe-web.vercel.app`, and do not merge from this implementation task.

## Physical iPhone checklist

If no physical iPhone is available, leave these explicitly not run:

1. Install/use the `preview` profile targeting `https://dayframe-staging.vercel.app`.
2. Confirm normal mobile bootstrap, timer start/stop and queued event sync remain compatible.
3. Confirm there is no new native Calendar long-press or dashboard permission UI.
4. Open the hosted web Calendar in mobile Safari and confirm touch/long-press/scroll never creates an empty-slot draft.
5. Confirm account/logout mobile overlays remain reachable and no horizontal overflow was introduced.

## Closure criteria

- final repository-wide validation passes;
- exact PR-head commit is deployed Ready on Vercel Preview;
- only the staging alias is promoted and inspected;
- hosted authenticated checks are completed or explicitly recorded as not run with the exact blocker;
- physical-device checks are completed or explicitly recorded as not run;
- diff contains no mobile source, migrations, production configuration, secrets or generated QA screenshots;
- draft PR remains unmerged.
