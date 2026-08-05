# Validation Matrix

Use this to select the right checks. Run the narrowest checks for small changes and broader checks for shared contracts or user-facing flows.

## Baseline Commands

General repo:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:brand-assets
git diff --check
```

Mobile:

```bash
npm run typecheck -w @dayframe/mobile
npm run test -w @dayframe/mobile
npm run ios -w @dayframe/mobile
```

Web/API:

```bash
npm run typecheck -w @dayframe/web
npm run test -w @dayframe/web
npm run build -w @dayframe/web
```

Shared:

```bash
npm run typecheck -w @dayframe/shared
npm run test -w @dayframe/shared
```

Do not claim a command passed if it was not run. If a command is skipped, state why.

## Interaction Motion

Required whenever a feature adds or changes navigation, presentation, gestures, list insertion/removal/reordering, expanding content, status feedback, Undo, or other visible movement:

- Add the `.codex/reference/motion.md` motion contract to the investigation note or PR description: trigger, one owner, entrance/update/exit, surrounding reflow, interruption, async outcomes, and Reduce Motion.
- Compare with the nearest existing Dayframe interaction and reuse the established owner and semantic duration where appropriate.
- Check normal motion and Reduce Motion for entrance, update/reflow, exit, cancellation, rapid repeat, and timeout/Undo/failure rollback states that apply.
- Verify stable keys and stale timer/callback handling so a prior transition cannot remove or restore newer state.
- Check Dynamic Type and VoiceOver when content geometry, focus, or announcements change.
- Record a simulator video for ordinary presence/layout motion. Use a physical iPhone for direct manipulation, native surfaces, frame pacing, background behaviour, or device-only APIs, and inspect frame pacing with Xcode tooling when the issue warrants it.
- Do not claim smoothness from unit tests or still screenshots alone. Record any device or tooling limitation explicitly.

## Health And Review

Required checks when touching Health import, Review, Confirm/Dismiss, or reprocess:

- Mobile Health unit tests.
- Web event-service tests.
- Web review route tests.
- Web reprocess-health route tests.
- One physical-device validation when HealthKit sample shape matters.
- Vercel logs for production validation.
- Database check for open timers and overlap blockers.
- Health debug export for real iPhone issues.

Manual evidence:

- Review before action.
- Confirm or Dismiss action.
- Review after action.
- Calendar/Timer/Reports showing created entry where applicable.
- Reprocess diagnostics.
- Reason shown for Health items left in Review.

Offline Review mutation changes additionally require:

- `npm run validate:review-sync-sqlite` against a temporary SQLite database.
- `DATABASE_URL=..._test npm run validate:review-mutation-db` against a
  disposable local Postgres database.
- Confirm, Dismiss, and Edit-and-confirm after local SQLite acknowledgement,
  with a local-write failure proving that the card/form stays actionable.
- Restart-persistent cache/tombstones, account switching/logout isolation,
  bounded retry, session-expiry preservation, same-account reauthentication,
  conflict/Discard diagnostics, and lost-response receipt replay without a
  duplicate entry.
- A clean iOS native build and the physical-iPhone Airplane Mode,
  force-quit/reopen, reconnect, conflict, System/Light/Dark, Dynamic Type,
  VoiceOver, and Reduce Motion matrices.
- Explicit limitations: timers and non-terminal location operations are outside
  this outbox; detailed Location Evidence may require a connection; force-quit
  does not guarantee background synchronisation.

## Timer And Sync

Required checks:

- Web start timer.
- Web stop timer.
- Mobile start timer.
- Mobile stop timer.
- Active timer refresh on both surfaces.
- Offline queue fallback path.
- Completed entry persistence.
- No duplicate active timers.
- Web Dashboard and Timeline render exactly one shell-owned timer. Navigate in both directions while it is active and while details/start time are being edited; active-entry identity, elapsed time and edits must remain continuous.
- Delay a Timeline period response through the fetched-data/URL hand-off and verify the persistent timer retains stable shell data while period content stays URL-matched; it must never disappear.
- Measure browser requests for one explicit start and one explicit stop. Each action, including `Shift+Space`, must emit exactly one timer mutation through the shell owner.
- With a timer already active, use Start Again/Continue on a previous entry. Verify one replacement start closes the old entry and starts the selected task at the same boundary timestamp; failure restores the original timer without a duplicate or idle flash.
- Remove each selected tag directly from the timer strip and verify the active entry persists the reduced tag set with keyboard and pointer input.
- Open the running timer's three-dot menu and delete it without a second confirmation. Verify optimistic removal from every collection, exact rollback on failure, Escape/outside-click dismissal, focus return, and no duplicate mutation.
- Exercise web optimistic success and network-failure rollback, then refresh and confirm bootstrap reconciliation restores the persisted active state.
- The shell Plus action opens the shared manual-entry dialog; one submission creates exactly one entry. `/entries` redirects to `/timeline?view=list` and `/automation` redirects to the approved Places destination.
- In Add time, focus “What did you work on?”, filter and keyboard-select a suggestion, and verify Description, Category, and Tags fill without a timer-start request. Open Tags without changing the dialog scroll position; verify the panel is fully visible above the form and long lists scroll internally.
- Compare idle and running timer geometry: Description, Category, elapsed, Play/Stop, and the final Plus/More slot must keep identical bounds. The running Delete menu must anchor beneath More without moving Stop.
- Open the Timeline period label on current and historical dates. Verify arrows and label stay fixed, the shared calendar control opens, Today navigates immediately, long labels do not truncate, and no selected-day/week caption or conditional reset button changes the row.
- In Calendar, verify zoom is always visible, its controls still change density, and no instruction/disclosure copy occupies the header.
- Browser-check the shared web timer and account access at 1440x900, 1280x720, 1024x768 and 390x844 in System, Light and Dark, with keyboard-only navigation and Reduced Motion. Record horizontal overflow and console/runtime errors.
- Open timer Suggestions, Tags, Categories, and the running start-time editor at each timer breakpoint. Verify no panel clipping, clear surface contrast, bounded internal scrolling, outside-click/Escape dismissal, trigger focus return, and no page scrim for the anchored start editor.
- In Add time, verify the hard-limited Suggestions panel contains only complete rows, manual Tags opens directly beneath the tag icon on desktop, Category matches the timer picker, native Start/Finish selection still works, the dialog has no browser-default focus outline, and rounded corners/menu bounds hold in Light, Dark, System, phone, compact-height and 200%-zoom-equivalent layouts.
- In Add time and Timeline, verify the shared calendar always renders six complete weeks, shows muted selectable adjacent-month dates, changes month when an adjacent date is chosen, and keeps its surface behind the entire grid. Type and paste compact Start/Finish times (`725`, `07:25`), verify normalisation to `07:25`, and verify invalid hours/minutes remain open with an inline error.
- In Reports, open Categories, Tags, and More filters and verify each floats over the page without changing the bounds of the summary cards or charts. Check internal scrolling, multi-select, URL persistence, outside-click/Escape dismissal, keyboard focus, contrast, Light/Dark/System, phone, compact-height, and zoomed layouts.
- With a running timer, open More at the right edge and verify Delete is directly below the trigger, remains inside the viewport, dismisses on outside click/Escape, and returns focus to More.
- Edit a running timer's start date/time with pointer Save and with Enter. Each path must issue exactly one update, recalculate elapsed time immediately, persist after reload, and never navigate, flash `Loading Dayframe`, or submit the outer timer form. Tab through date segments, time segments, Cancel, and Save; calendar and clock affordances must not add stops.
- In Settings, verify the active workspace is shown in one compact selector, selection switches immediately, and Rename/New reveal only one relevant form at a time. In the profile menu, verify workspace rows use the same flat fill-led treatment as Settings and Log out without individual shadows.
- In Categories, verify existing and new colour choices are circular, borderless, shadowless, keyboard-selectable, and retain a clear selected state. Save must be text-only and Edit must use a pencil.
- Verify the icon-only Light/Dark control sits immediately above Help & Shortcuts, has an accurate accessible name, switches the resolved theme, and does not introduce horizontal overflow in desktop, phone, or compact-height layouts.
- Navigate away from and back to Settings under normal, slow, and failed bootstrap refreshes. Last successful same-session/same-workspace Settings must remain visible while reconciliation runs; only a fresh tab without cached data may show the full loading state, and an active form must not be overwritten.
- In the Places editor, verify “Suggest visits here” has a stable 52×30 px pill track and 24 px circular thumb in desktop, phone, and iPad portrait/landscape layouts across Light, Dark, and System.
- Call `GET /api/integrations/v1/time/entries` with a `time:read` integration token. Verify required/maximum range and limit validation, overlap semantics, newest-first opaque cursor pagination, running-entry handling, complete metadata, insufficient-scope denial, and two-user/same-workspace plus cross-workspace isolation.
- For location-derived commutes, verify a post-gap sample or departure anchor that still matches the origin replaces an older stay cutoff. A same-place round trip requires route evidence; near-simultaneous same-place exit/enter restoration pairs must not close the stay, and provider/geofence registration bursts without new route samples must not create a commute.
- Active timer card and running edit sheet use the same exact active-entry timestamp and display the same elapsed seconds.
- Empty mobile Play creates one timer, then opens the running edit sheet without showing start-state controls.
- Pressing mobile Play while a timer is already running opens the same running edit sheet/suggestion flow instead of bypassing suggestions or starting a duplicate.
- Applying a running-timer suggestion issues one entry update and never another timer-start request.
- Running-sheet suggestions stay above Description/Category/Start time, cap at six, dismiss outside, and hide when Description receives focus.
- Suggestions that arrive after the running sheet opens may appear only while the description is still untouched; they must not reopen after manual entry has begun.
- Normal mobile timer mutations show no spinner, progress bar, or layout-moving loading state. Start, stop, edit, delete, and suggestion-apply should update optimistically and reconcile silently; pull-to-refresh remains the explicit visible-refresh path.
- Edit Timer delete confirmation does not unmount/collapse the suggestions area or reflow the sheet content underneath.
- Today history left-swipe keeps one smooth horizontal gesture on the UI thread: the danger action and icon travel with the row edge, the row settles without a release-time pop, ordinary vertical scrolling does not open actions accidentally, and the duration retains a 14-point surface gap before the revealed action.
- Today history delete begins immediately without a confirmation surface and opens the five-second inverse-colour Undo bean. Verify animated row/group removal and surrounding list reflow, Undo entrance/exit, expiry, rapid replacement, exact restoration, rollback on failure, individual rows, directly deletable blank uncategorized entries, expanded grouped children, and collapsed-group safety. Confirm the swipe fill uses `danger` with `onDanger` icon/text, and the bean uses the documented inverse surface with a coral action, in light and dark themes.

## Location Learning And Places

Required checks when changing background location sampling, learned places, or detected-stay Review behavior:

- Shared classification tests for weak/noise, one-off activity, and repeated place evidence.
- Mobile geofence and offline queue tests.
- Web event-service and learned-place route tests.
- Shared, mobile, and web typechecks.
- Apply/verify the latest hosted learned-place migration before testing a deployed API.
- On a physical iPhone, verify weak pass-through samples stay hidden, one long visit appears only in Review, repeated visits can appear under Learned places, and saved-place commute behavior is unchanged.
- Open the learned-place detail sheet at phone width and verify the address and coordinates copy actions, internal scrolling, close control, and no horizontal overflow.
- Check that cached geocoding prevents repeated lookups and that a coordinate-only legacy candidate resolves lazily when Apple/Expo returns an address.

Location Intelligence V2 adds these mandatory checks:

- Verify all four server-controlled rollout modes: `v1`, `v2_shadow`, `v2_review`, and `v2_enabled`. Prove shadow emits no user-visible V2 semantics, review/enabled suppress competing V1 location semantics, a same-mode client acknowledgement is required for semantic cutover, and pre-cutover shadow segments cannot backfill. The checked-in/default environment value must remain `v2_shadow`.
- Run shared deterministic fixtures for `A -> B -> A`, sports–Home–sports, the 14-minute intermediate stop/two journeys, nearby-place ambiguity/correction, visit-supported gaps, contradictory visit evidence, poor accuracy, duplicate/reordered batches, teleport rejection, route vs straight-line distance, Europe/London midnight/BST/DST, and generated segment invariants.
- Run mobile SQLite/task coverage for migration, WAL/foreign keys, insert/dedupe/rollback, account isolation, native drain acknowledgement/corruption, 100-item batch bounds, `401`/`413`/`422`/`5xx`, retry jitter, retention, full-catalogue vs 20-region selection, service disable, and coordinate-free diagnostics.
- Run native Swift tests and `npx pod-install`; verify the local Expo module and AppDelegate subscriber autolink; build the checked-in iOS workspace without destructive prebuild cleanup.
- Apply `202607200001_location_intelligence_v2.sql` to a disposable PostGIS database and run it twice where safe. Inspect checks, GiST/time/idempotency indexes, owner trigger, user-only RLS policies, two-user same-workspace denial, bounded cleanup, cascading raw-lineage deletion, and preservation of derived segments/reviews.
- Run web/server tests for schema/body bounds, idempotent insert/replay/review creation, coordinate-free activity summaries, owner filters, private/no-store headers, expired evidence, GeoJSON `[longitude, latitude]`, `ST_DWithin`, atomic edit/split/merge/save, rollback, correction feedback, lock conflict, and legacy Accept/Ignore.
- Browser-check Review at desktop and phone widths in light/dark mode: map/fallback/loading/error/expired states, split preview, saved-place selection, failed mutation retaining the card, 44px targets, focus, no horizontal overflow, no console/runtime overlay, and MapLibre cleanup/client-only behavior. If `NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL` is set, verify authorised tiles/assets and attribution; if absent, verify the tile-free canvas.
- Run `npm run validate:location-v2-sqlite`. Run `DATABASE_URL=..._test npm run validate:location-v2-db` against both a fresh base schema and the all-migrations-in-order schema; the validator must refuse a non-local host or a database name without the `_test` suffix.
- Apply the V2 migration to fresh, representative upgraded, and complete ordered disposable databases; apply it twice where intended. Test user-only RLS with two ordinary non-superusers in one workspace, not a superuser or service role. Separately verify the service-only retention grant, seven-day deletion, raw-lineage cascade, and preservation of derived/confirmed history.
- Verify `vercel.json` schedules `/api/cron/location-retention`, the route fails closed without the `CRON_SECRET` bearer value, authenticated users cannot execute the cleanup function, cleanup is bounded/locked, and failures/backlog warnings are coordinate-free. After an authorised hosted deployment, verify the production-only UTC schedule, secret, database role, and Vercel invocation logs; local route tests are not proof that the hosted cron ran.

Physical iPhone/TestFlight results must be recorded individually as `PASS`, `FAIL`, or `NOT RUN` for: foreground, background, locked, suspended, eligible system relaunch, explicit force-quit limitation, Background App Refresh off, Precise off, Always downgraded, Location Services cycle, reboot, hours offline/reconnect, duplicate retry, 300–350m walk, venue–Home–venue, 10–15m stop, long drive, 150–200m nearby places, 24-hour battery measurement, and mobile/web parity. Never infer these from simulator tests.

For the synthetic journey specifically verify two sports stays, Home not nearby school, the intermediate stop, two separated journeys, `MUM_HOME -> CHURCH -> MUM_HOME`, visible uncertainty, and identical canonical mobile/web segments. Battery evidence must list device, iOS, build, start/end battery, duration, approximate movement, foreground/background mix, and comparison baseline if one exists.

## Calendar And Review UI

Required checks:

- Calendar, List, and Timesheet render.
- Time blocks are clickable/editable.
- On web Calendar, single-click a completed, running, blank/uncategorized, tagged/place-backed, short, overlapping, lower-edge and cross-midnight fragment. Verify exactly one compact editor portal opens from the selected visible fragment; no old bottom card or advanced dialog remains; both completed/new Start and Finish use one seamless inset compound with a bare calendar icon and one neutral focus perimeter; a later Finish date shows the correct `+N`; completed/new Duration is editable and normalized minute-only `HH:MM`; running Finish says `Running` and live Duration is read-only/minute-only until stop. Leave a running editor untouched across multiple one-second refreshes and verify it stays clean.
- Verify pointer-open on an existing block leaves focus unchanged, while click-create and every keyboard route focus Description. Space, Enter, and double click use the same shared editor; repeated activation of the already selected block must not reset a dirty draft. Every icon action has an accessible name and 44px target. Text/date/time fields show a neutral grey focused border for pointer and keyboard focus; buttons, links, tabs, dropdown triggers and icon actions show only a neutral `:focus-visible` indicator. Check Light/Dark and pointer/keyboard modality. Keyboard-open both date pickers, choose a date and Escape back to its trigger without closing the editor. First Escape closes Category and the next reaches the editor. Close/Escape and outside dismissal preserve the exact `Discard changes?` decision with `Go back` and `Discard`; changed drafts block the underlying action, restore exact focus/draft on Go back, and cannot leak rapid outside/navigation/block clicks.
- Open Edit from Timeline List single rows, grouped representative rows, expanded occurrences, and Reports matching entries. Verify each is the same `TimeEntryQuickEditor` panel/controller as Calendar inside a centred focus-trapped modal; focus returns to the invoking action; Cancel, backdrop, Escape, nested Tags, and nested date pickers use the same dirty/discard and focus-return rules. Timeline List exposes Start again/Delete and preserves grouped representative behavior plus shared five-second Undo. Reports exposes neither. Confirm no mounted or imported `EditTimeEntryDialog` remains.
- In Calendar create and Calendar/List/Reports edit, hydrate existing tags, remove/select/create tags, exercise the shared 24-tag maximum and `+N` overflow disclosure, and save tag-only plus mixed edits. Inspect partial payloads for only `description`, `categoryId`, `tagNames`, `startedAt`, and `stoppedAt`; never `placeId`, project/client, source, or task-suggestion metadata. Verify Place remains on the persisted row and in every optimistic/bootstrap collection after completed and active-running saves.
- In Calendar Day and Week scopes, single-click eligible empty day-body space with a primary fine mouse pointer at representative pixel offsets and verify local time floors to the previous 15-minute slot, Finish is exactly 30 minutes later and 23:45 becomes next-day 00:15. Repeat after vertical and horizontal scroll and at every Calendar zoom; the dashed provisional anchor must remain `aria-hidden`, non-interactive, aligned to the exact edited Start/Finish geometry, and absent from canonical entries, totals and lane layout.
- Verify touch/coarse pointer, right-click, drag beyond threshold, pointer cancellation, scroll during press, day header, time axis, scrollbar, existing block, Play/action, resize handle, provisional anchor and the visual one-pixel gap inside a block's semantic time rectangle create nothing. With a clean editor open, the first empty click dismisses only and the second independent click creates; prove the consumed pointer token survives document capture through Calendar's React `pointerup` and is cleared only afterward. With a dirty existing or create editor, the first click opens the discard decision and creates nothing; Go back preserves the exact target/draft; Discard followed by a later click creates; stale exit/session callbacks never close the newer draft.
- In Calendar create mode verify blank Description, no selected Tags, Uncategorized Category, explicit Start/Finish dates and times, editable `00:30` Duration, Close/Save, no Play/Delete and no automatic focus stop on the provisional anchor. Save untouched, tag-selected, duration-edited, overlapping and cross-midnight drafts; inspect exactly one event-first POST with the selected `tagNames`, trimmed optional Description/Category, no hidden compatibility fields and exact timestamps. Pending POST, outside-pointer consumption, failure retention, canonical-refresh dismissal and active-timer invariance remain required.
- Inspect completed compact-save requests and persisted rows: no-change emits no PATCH; changed saves contain only owned fields; clear values become `null`; untouched timestamp seconds, sub-minute exactness and hidden metadata survive. Exercise live complete Start-owner, Finish-owner and Duration-owner updates; incomplete raw input/error deferral; `30`, `30m`, `90`, `90m`, `1:30`, `01:30`, `1h 30m`, compatibility `1:30:00`; rejection of non-zero seconds; one minute; over 24 hours; same-day, midnight and multi-day dates; and blur-through with no ownership change. Verify plain Description Enter Save/exit, no-op close, failure retention, hashtag selection, modifiers, IME and rapid mutation gating. Keep manual Finish <= Start raw with exactly `Finish must be after Start`; reject future edges. While an unrelated timer mutation is busy, completed PATCH remains enabled; create/running mutations stay gated. Exercise stoppedAt-only API PATCHes against stored Start and all future/reversed/valid partial combinations.
- In `TZ=Europe/London` and `TZ=America/New_York`, reject clicks and edited wall times inside the spring-forward gap. For fall-back repetition, preserve untouched source ISO instants byte-for-byte, require a positive duration and positive rendered geometry even when displayed wall-clock Finish precedes Start, and recompute only the timestamp field the user actually edits.
- Exercise full Add time client validation and the authoritative manual-entry POST with one captured `now`: malformed Start/Finish, Finish-before-Start, future Start, future Finish, ordinary valid past times and a valid cross-midnight entry. Assert the specific 400 error text and prove no event/entry write occurs for rejected input.
- Scroll a clean, dirty and pending-save editor until its anchor leaves the visible Calendar. Clean dismisses with focus policy intact; dirty opens one discard decision per out-of-view excursion and Go back restores exact focus/draft without an immediate repeat; pending save stays mounted and blocks navigation/replacement until success or failure.
- With an active timer, change Description/Category/Start through Calendar and verify the Calendar block and persistent timer update together, one mutation gate admits only one Save, exactly one partial PATCH and one forced bootstrap refresh occur, authoritative `updatedAt` reconciles, hidden metadata remains, and simulated failure restores the exact bootstrap/timer-draft snapshots without an old debounced PATCH.
- At 1440x900, 1280x720, 1024x768, 768px, 390x844, 350px, a short-wide viewport and a 200%-zoom equivalent in System/Light/Dark, verify anchored and modal editors keep a 12px viewport gutter, bounded internal scrolling, 44px actions, and no horizontal overflow. The temporal row stays one line when practical, wraps Duration first, then stacks only when needed. For Calendar also verify the 8px preferred gap, above flip and 12px clamp through scroll, window/visual-viewport resize, zoom/layout change, same-duration Start/Finish movement, anchor/panel resize, anchor removal, lower-edge placement, interruption and rapid block replacement. Measure both provisional and canonical `z-index` in overlap cases; provisional must stay below real entries. Measure the outer editor before and after validation error, overlap changes and discard confirmation: one reserved feedback/action region must keep its size and position fixed, long overlap text must remain bounded at 320px, and no `top`/`left` animation may occur. Reduce Motion makes entrance/exit effectively instant while preserving the same focus and dismissal semantics.
- Start again must ignore unsaved compact draft values and use the canonical entry through the shell timer owner; compact-editor failure preserves the draft/error, while standalone inline failure appears as an accessible fixed alert without Calendar reflow. Delete closes immediately into the shared five-second Undo owner; verify Undo, expiry, rapid replacement and rollback remain shared with List/Timeline.
- The iOS Calendar native view is provided by the expected local Expo module, autolinks through CocoaPods, and compiles in a full native build. Expo Go or a web render is not acceptable evidence.
- Mobile pinch zoom and vertical scrolling have one native owner. Check for continuous focal-point anchoring, no release-time snap/re-layout, no blank frame, no competing outer-scroll movement, and no obvious dropped-frame feel.
- Hour labels, grid lines, blocks, continuation edges, and the current-time line remain aligned at minimum, default, intermediate, and maximum zoom.
- Ordinary prop refreshes—including the one-second `now` tick, bootstrap refresh, entry updates, and optimistic-to-persisted ID reconciliation—do not recreate the native view or reset useful zoom/scroll state.
- Day/week navigation, day selection, 24-hour boundaries, cross-midnight clipping, empty state, active entries, completed entries, and review candidates match the existing Calendar behaviour.
- Native entry/review callbacks open the existing React Native sheets/routes using stable IDs and do not make direct API/timer mutations.
- Repeated Today entries collapse by normalized description and category, descriptionless entries collapse when they have a category, truly blank uncategorized entries stay individual, totals sum grouped children, and expanded children remain individually editable.
- Review action buttons remain tappable and readable on phone width.
- No duplicate React keys or runtime overlays.
- Light and dark theme remain legible.
- For overlap changes, cover boundary-touch, sub-minute boundary noise, containment, partial overlap, chains, three-plus concurrency, cross-midnight/DST clipping, running entries with one captured `now`, input-order stability, and invalid/reversed intervals.
- Verify manual Add/Edit, Calendar resize, direct Review confirm, edit-and-confirm, record-once, split-and-confirm, merge-and-confirm, offline enqueue/retry/replay, and web/mobile bootstrap reconciliation all preserve an overlap of at least one minute.
- Verify intersections shorter than one minute remain stored exactly but do not trigger Overlap copy, markers, collision layout, automatic Health/location Review decisions, or overlap totals.
- Re-run source idempotency and one-active-timer cases so overlap permission cannot weaken technical duplicate prevention.
- Verify hybrid Calendar geometry: full-width isolated blocks, inset overlays only for substantially shorter contained pairs, lanes for partial/similar pairs, compact lanes for dense collisions, width-aware text suppression, deterministic z-order, and taps reaching the intended visible block.
- Verify `Total logged`, `Time covered`, overlap markers, and goal-covered semantics across Dashboard, Timeline/History, Reports, and Settings copy.

Native Calendar evidence:

- Run deterministic TypeScript bridge/serialization tests and Swift unit tests for native date clipping, block metrics, zoom bounds/state restoration, and callback identity where those helpers live.
- Run `npx pod-install` (or the repository-equivalent CocoaPods install) after adding/changing the local native module; do not use destructive `expo prebuild --clean` as a shortcut over the checked-in native project.
- Run the mobile typecheck, full mobile tests, and a full iOS simulator build.
- On a physical iPhone, record repeated pinch-in/pinch-out while moving the midpoint, vertical pan at multiple zoom levels, day/week navigation, and entry/review taps. Inspect frame pacing with Xcode tooling when available; screenshots alone cannot validate gesture smoothness.
- Verify System, Light, and Dark, Dynamic Type, VoiceOver, Reduce Motion, Reduce Transparency, and the minimum supported iOS version.

Native Calendar block styling additionally requires:

- Swift behaviour tests proving one nominal compact radius, a one-point visual-only gap, zero gap for next-day continuation, positive tiny geometry, unchanged semantic text thresholds, and semantic hit height.
- Source/bridge contracts proving the old half-height capsule rule is absent; active/Review dashes and Uncategorized hatch remain; styling adds no Play, networking, mutation, model-version bump, hosting controller, or additional gesture owner beyond the one documented Calendar creation recognizer.
- Rendered tall, short, tiny, exact sequential, active, Review, Uncategorized, tagged, long-title, contained/partial/dense overlap, and both continuation directions at minimum/default/maximum zoom.
- Measure a stable `1pt` vertical separation and `1pt` border at each zoom/display scale. Confirm no false midnight gap, no time/grid/current-line drift, no overlap-lane change, and no text/marker clipping from the one-point paint inset.
- Tap every fixture, including both sides of a sequential boundary and dense/contained lanes. Verify isolated `44pt` targets and semantic-height overlap targets route to the intended existing React editor/Review flow.
- Use a physical staging iPhone for short-block shape, Light/Dark/System, Reduce Transparency, Dynamic Type, VoiceOver, repeated pinch/scroll, active-tick refresh, optimistic reconciliation, and callback accuracy. Record each result as PASS, FAIL, or NOT RUN; simulator/source evidence cannot substitute.

Native Calendar long-press creation additionally requires:

- Swift behaviour tests for initial grab offset, one-slot and multi-slot movement in both directions, no update/haptic inside one slot, 00:00/23:45 clamping, min/default/max zoom equivalence, scrolled content coordinates, invalid/non-finite input, fixed 30-minute/cross-midnight preview geometry, state-reducer end/cancel ordering, and edge-zone direction/speed/boundary clamping. Retain the semantic Button hit-frame fixtures for tall/short/sequential/active/Review/contained/partial/dense/continuation entries.
- Bridge and source contracts must prove exactly one `UILongPressGestureRecognizer` in `DayframeCalendarScrollCoordinator`, no SwiftUI or React Native duplicate gesture, one-finger/0.50-second/11-point configuration, and the continuous contract: `.began` creates an ephemeral native preview and emits nothing, `.changed` updates only changed snapped slots, `.ended` clears then emits exactly one `dayKey` plus `startMinute`, and cancel/failure/interruption clears with no request. Prove the preview remains outside `modelJSON`/`presentation.entries`, is non-interactive/accessibility-hidden, and carries no native timestamps/networking/persistence or presentation-version bump.
- Source and build inspection must prove one retained coordinator-owned `CADisplayLink`, no repeating `Timer`, non-animated per-frame offset changes, immediate display-link/preview/gesture-lock cleanup on every exit, same-day presentation-tick preservation, token-safe stale cleanup, and restoration of vertical scroll, horizontal day swipe, pinch and entry taps.
- TypeScript tests in an explicit local timezone for native-event validation, defensive floor/clamp, exact 1,800-second duration, midnight rollover, blank/Uncategorized/tag-free metadata, unique draft identity, nonexistent spring time, deterministic repeated-hour handling, and stale-day rejection.
- On a physical staging iPhone, record PASS/FAIL/NOT RUN for recognition-only preview, no pre-release sheet, no-move release, multi-slot drag/grab-offset stability, activation and per-slot haptics without spam, edge autoscroll and day-boundary clamps, release-only single sheet/event, cancellation/interruption/stale-state cleanup, and no stuck gesture lock. Also cover every zoom/scroll position; entry/44-point/gap/overlap-lane/hour-axis initial rejection; post-activation overlap acceptance; short tap; vertical scroll; horizontal swipe; pinch; pull-to-refresh; movement; second finger; Add defaults/overlap warning; Cancel/failure/success; Light/Dark/System; Dynamic Type; Reduce Motion/Transparency; VoiceOver alternative; and creation while one active timer and Live Activity remain unchanged.
- Verify the saved entry through stable staging web, edit/delete cross-surface, refresh iOS, and prove one active timer plus one completed entry. Use the exact Ready PR Preview and an EAS `preview` internal build targeting `https://dayframe-staging.vercel.app`; never substitute production/TestFlight or infer physical gesture quality from source, tests, simulator, or still images.

## Native iOS Tabs And App Chrome

Required checks when changing the mobile root navigator or tab bar:

- Run the mobile typecheck and full mobile unit suite.
- Run an iOS native build; a web or Expo Go render does not validate the native tab controller.
- Verify Today, Calendar and Reports use real routes and retain their state when switching tabs.
- Verify the system owns tab material and safe-area insets; do not add a second `GlassView`, manual tab height or bottom spacer.
- On iOS 26, check native Liquid Glass, system tab spacing and scroll-down minimisation in both light and dark appearance.
- On the minimum supported iOS version, check the standard native tab fallback remains readable and reachable.
- Re-test Settings/Review/Places push and swipe-back, Today timer start/stop/edit, Calendar scroll/swipe/pinch, pull-to-refresh, Reduce Motion and Reduce Transparency.

## Brand, Theme, And Visual Reskins

Required checks when changing brand artwork, shared theme tokens, app chrome or visual-system documentation:

- Run `npm run check:brand-assets` to verify canonical geometry, fill-only wordmark variants, public mirrors and the symbol favicon.
- Run shared token tests plus web/mobile typechecks.
- Build web and verify every public SVG returns successfully without unsafe remote-SVG configuration.
- If mobile brand components or app-icon configuration changes, run Expo iOS prebuild and an iOS bundle/simulator build where feasible.
- Search application source for legacy PNG banner references and CSS filters used to manufacture logo variants.
- Confirm semantic token values remain aligned across shared TypeScript, web CSS and mobile theme resolution.

Manual evidence in System, Light and Dark:

- Header, authentication and public-page lock-ups use the correct wordmark tone without a wrong-colour flash.
- Symbol geometry and colours are unchanged; no white rectangle appears around transparent artwork.
- Favicon and iOS app icon use the symbol only; the iOS icon is opaque and legible at home-screen size.
- Meaningful lock-ups expose one accessible name and decorative artwork exposes none.
- Primary, secondary, destructive, selected, disabled, loading, empty and error states remain distinguishable.
- Charts retain exact totals, labels and non-colour cues.
- Categories creation keeps its focused name field, all 12 perceptually distinct swatches, pin state and actions above the iOS keyboard; selected-state labels remain usable with Dynamic Type and VoiceOver.
- Web is checked at desktop, tablet and phone widths; iOS is checked with Dynamic Type, VoiceOver, Reduce Motion and Reduce Transparency.

## Auth, Workspace, And Deployment

Required checks:

- `DAYFRAME_AUTH_MODE=dev` if local dev flow is involved.
- `DAYFRAME_AUTH_MODE=local` if local email/password is involved.
- Provider/Supabase auth against the staging Supabase project for PR testing; production auth only for explicit post-merge verification.
- Never use a prefetchable GET link for logout or another state change. Verify rendering Profile, Settings, and troubleshooting makes no logout request; explicit logout is one POST; GET is side-effect free; repeated POST is safe.
- Test missing, invalid, expired, revoked, valid, database-failure, and missing-scope paths. Only a structured session `401` may replace the browser location; `403` and `500` must remain in place.
- Validate session TTL configuration at startup and prove cookie `maxAge` and database expiry share the resolved bounded value. Treat sliding renewal as a separate security/product design.
- In an optimized web build, test Enter/click, wrong-then-correct credentials, duplicate submission, slow network, one continuous branded opening state, hard refresh, Back/Forward, direct `/login`, two tabs, timer start/stop, and console/network output at desktop and phone widths.
- Measure authenticated reconciliation traffic. Keep elapsed display ticking locally; use a bounded active-timer fingerprint for near-real-time checks, stop checks while hidden/backgrounded, allow only one check in flight, back off repeated failures, and run heavyweight bootstrap only after detected change plus initial/mutation/focus/visibility and conservative broader reconciliation.
- Hosted auth changes require a provider-auth Vercel Preview pass against staging before merge, including a 10-minute visible-tab observation, tab switching, safe Vercel reason logs, explicit logout/login, Safari/WebKit where available, and canonical/custom hostname checks for host-scoped cookies.
- Confirm the selected Ready Preview is manually promoted to `dayframe-staging.vercel.app`; the alias does not follow branches automatically.
- Apply required migrations to staging before hosted checks. Confirm the visible `STAGING` badge, staging account/workspace and staging Supabase project before mutating data.
- Mobile preview builds must report `https://dayframe-staging.vercel.app`; production/TestFlight builds must report `https://dayframe-web.vercel.app`. Until a separate staging bundle identity exists, note that installing preview may replace the existing app.
- Mobile bearer session still works.
- On iOS, gate the initial bearer-token read on active app state; test transient
  `errSecInteractionNotAllowed` recovery, legacy-token migration, explicit
  background-safe device-only Keychain accessibility, and logout/`401` clearing
  without exposing a raw SecureStore exception.
- Workspace/user scoping is preserved.
- Hosted Supabase schema has all columns/indexes used by deployed code.

## Release Validation

For docs-only PRs:

- Confirm the diff only changes docs/planning/reference files.
- Run `git diff --check`.
- Open the PR, observe GitHub/Vercel checks, merge, and sync local `main`.

Before telling KB to test an implementation PR:

- Confirm branch and commit.
- Confirm PR state.
- Confirm the Vercel Preview is Ready, backed by staging, and promoted to the stable staging alias when hands-on testing is required.
- Confirm relevant automated checks and hands-on staging checks passed before merge.
- Confirm Vercel production deployment if server code changed.
- Confirm TestFlight version/build if mobile code changed or if the user defined TestFlight as the success criterion.
- Confirm API base URL.
- Confirm migrations.
- Run `npm run testflight:preflight` before mobile archive/export.
- Verify App Store Connect `processingState=VALID`.
- Verify export compliance/encryption answer is set.
- Verify TestFlight notes are set.
- Verify internal testing group assignment and `IN_BETA_TESTING`.
- Restore temporary iOS build-number changes before final repo status.
- Report exact version/build and delivery UUID.
- Note local-only artifacts that were not committed.

## Self-Review Questions

Ask these before opening a PR:

- Did I verify build/deploy/schema state before diagnosing?
- Did I trace the whole user/API/data flow?
- Did I add or update tests for the actual failed path?
- Did I manually validate the user journey where feasible?
- Did I keep the change focused?
- Did I avoid committing local artifacts or sensitive data?
- Did I update the investigation note and any missing guardrail?
