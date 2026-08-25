# Validation Matrix

Use this to select the right checks. Run the narrowest checks for small changes and broader checks for shared contracts or user-facing flows.

## Baseline Commands

General repo:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:docs
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
- On mobile, verify separate Review cards with a square-ended category rail inset from the rounded top/bottom, prominent activity/time, five confidence dots with one VoiceOver `N of 5` label, and an About disclosure with no Health diagnostics. For each Location V2 reason, verify one concise user-facing explanation; overlap must say why automatic logging paused without rendering a duplicate overlap row. Check narrow width, Dynamic Type, Light/Dark/System, Reduce Motion, and rapid confirm/dismiss reflow.
- On mobile Location Evidence, verify activity plus minute-level range and map without raw DTO/sample/anchor/retention/millisecond/standalone uncertainty copy. A commute must show explicit Start and End markers, a solid observed approximation or dashed labelled fallback, no tappable `Significant location change` callout, and no Where/Route-detected section. Confirm `Commute` replaces `Possible journey` and split, merge, place correction, save-place, record-once, confirm, and ignore remain reachable.
- In mobile Location Evidence, verify Where/What/When for stays and What/When only for commutes. When must show only editable Start/End `HH:mm` and live read-only Duration, with no date action or truncation; saving preserves each detected endpoint date, hidden seconds/milliseconds, and a cross-midnight suggestion's two original days. An unmatched stay must issue one native nearby request on open, use a 750-metre radius, render no more than three `Nearby places`, call them nearby rather than likely, and issue no proactive request for a commute or saved-place match. A fixture with repeated distinctive site names may issue exactly one additional local contextual request; generic or locality-only repetition must not. Require the contextual venue, one dining result, and one activity/leisure result ahead of duplicate retail tenants and utilities while preserving deterministic provider-order/distance/name ties inside each group. Reject merged results outside 750 metres, fall back to the base list if enrichment fails, and publish only one visible final list so it does not reorder after entrance. Type one character without replacing nearby results; type two to replace them with search results; clear to restore nearby results. Select a result and verify the map proposal updates, `Save for future visits` defaults off, and the primary action reads `Use once and record`; enable it and require `Save place and record`. The generated unknown-visit title must remain header copy while Activity starts empty with optional placeholder text; genuine activity copy must remain editable. Category choices must use a 32 pt visual pill inside a 44 pt target, announce selected state, and avoid a redundant checkmark. With nearby results present, focus Search; then focus Activity lower in the form. The outer scroll owner must keep each complete field above the iOS keyboard at normal and large Dynamic Type, allow user-drag interruption, reveal immediately under Reduce Motion, and ignore stale callbacks after rapid focus changes or route exit. Exercise cancellation during base and contextual search, stale response, unavailable/offline/no-results states, explicit search, map pin, and record-unknown fallback.
- Verify one-time selection sends exactly one `record_poi_once` action containing only the trimmed name plus entry edits. Confirm the derived row has `place_label`, no `place_id`, and no Apple identifier/address/coordinate/raw response; saved-place selection has `place_id` and clears `place_label`; ordinary activity/category/time/tag edits preserve the label. Retry the same resolution, reject cross-user/workspace access, and check the database exclusivity constraint. Verify `placeName`/`placeKind` in bootstrap and integrations, location rendering in Timeline/history and native Calendar, case-insensitive normalized grouping in Reports, Search matching, and CSV/JSON export.
- Check normal and Reduce Motion for nearby load, typed replacement/clear, selection, save-toggle state, More-options reflow/exit, rapid time edits, rapid search/disclosure actions, and failed resolution. Nearby and typed search each have one cancellable owner; stale native/API results cannot replace a reopened screen. Check 44-point targets, VoiceOver labels/selection/toggle value, Dynamic Type stacking/scrolling, Light/Dark/System, and no horizontal overflow. Run both native Swift packages, mobile/shared/web focused tests, mobile typecheck, a full native iOS simulator build, and a signed staging build after applying `202608120001_time_entry_place_label.sql`.
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
- Stall the Review POST beyond 15 seconds and verify it aborts into durable
  retry-wait. Pending/in-flight work must show saving copy without `Retry now`;
  retry-wait alone offers that action, while sign-in and permanent issues keep
  their dedicated guidance.
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
- In each eligible web picker—idle timer, running timer, Add Time, Timeline List edit, Calendar create, and Calendar edit—prepare distinct Description, Tags, Start and Finish values, then create a category with pointer and keyboard. Verify Create uses one Category name compound control with its 44px accessible colour-dot action inside the leading edge and no separate Colour row. First leave the dot untouched and verify one name-only-equivalent request, deterministic automatic valid palette colour, `isPinned=false`, immediate selection and cross-picker availability, persistence after refresh and entry discard, and zero surrounding timer/time-entry Save, Start, Stop, Restart, dismissal, or draft reset. Repeat with an explicit colour from the canonical 30-choice, five-column palette and verify that exact key persists without pinning. Closed fields, list options and colour choices must show circular swatches with no grey border or shadow. Repeat blank, case-insensitive duplicate, server/network failure and retry; exact draft/name/chosen-colour/focus must survive. Before opening, after opening the list, after entering Create and with Colour open, record the surrounding editor bounds, `scrollHeight`, and `scrollTop`; all must remain unchanged while only the picker or colour palette scrolls. Confirm body portal placement for timer/List/Calendar, nearest-native-dialog placement for Add Time, a field-width category panel that prefers 6px below then flips above, independently viewport-clamped Colour placement, and 12px viewport gutters after page/visual-viewport scroll, resize and zoom. Exercise category arrows/Home/End, colour-grid arrows/Home/End, Enter, Tab, three-stage Escape, outside click, Calendar consumed-pointer ownership, modal focus trapping, 390px width, 200% zoom, Light/Dark/System and Reduced Motion. Confirm Reports, Review, Places and Automations expose no contextual create option.
- Compare computed category-create styles in the idle/running timer, Add Time, Timeline List, Calendar create and Calendar edit. Require a 14px/650 heading and actions, 12px/650 Name label, 14px input/options, one 20px swatch centred in a 44px leading target, a 14px outer-border-to-visible-dot inset, and a separate 1px divider inset 12px with 6px clearance before the rounded Create row. The divider has no radius or rounded inset-shadow corners. Confirm host selectors target only direct picker option rows and do not change the shared create form, nested colour trigger or action buttons.
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
- In Running, Completed Entry Edit and Add Past Time, verify the timer form itself never scrolls and every control fits at the supported small/current-large iPhone heights. Running omits Round Duration, places unfilled `SET TO LAST STOP TIME` under Start and Delete below the dial. Completed/Add place unfilled `ROUND STOP TIME` under End and Round Duration inside the dial. Keyboard occlusion may cover lower controls until tap-outside dismissal; horizontal Category and bounded result-list scrolling remain available.
- Create a new tag in every time-entry sheet mode, close/discard without saving the entry, refresh bootstrap and verify the catalogue row remains. Race Create against immediate Done/Discard and require one normalized server row. Simulate failure and verify the exact hashtag/focus returns only when no newer typing superseded it.
- Enter Tags with Add a tag and typed `#`, then delete the only `#`. Require continuous Description focus/keyboard with zero native blur-recovery events, a closed Tags panel and no empty Suggestions reopen. Tap unhandled empty form space and require intentional keyboard dismissal, then refocus and type matching text to require the existing live Suggestions ranking to return.
- Drag from each rectangular corner outside the visible duration dial and require the sheet gesture to respond. Repeat on the ring, start/end/range handles and inside Round Duration action; those regions must never start sheet dismissal and dial cancellation must restore its snapshot.
- Empty mobile Play creates one bare timer, opens the shared running editor with an explicit blank-start presentation generation, and focuses the real Description input exactly once after Modal, custom-sheet, input, and anchor readiness. Reopening an existing active timer creates a distinct presentation that neither autofocuses nor shows history until deliberate Description focus; optimistic-ID replacement and bootstrap refresh do not reset either presentation.
- Query genuine mobile history from the shared editor in running, completed, Add, and Review modes. Verify case-insensitive exact/prefix/word-prefix/substring ranking with `bau`, current-entry exclusion, deterministic shuffle/ties/limits, separately selectable same-Description metadata variants, and selection patches containing only Description, Category, and Tags. Running selection issues one update and never another timer-start request; completed/Add/Review retain their existing temporal and review semantics.
- Historical results float directly below Description outside form flow, use bounded internal scrolling, and leave the base sheet and Description bounds unchanged within one point for one, six, and long result sets. Verify opening, late updates, selection, blur, close, keyboard movement, small-screen collision, Dynamic Type, and hashtag precedence without sheet remeasurement or clipped actions.
- With VoiceOver, verify the floating results temporarily hide only the controls they visually obscure while Description, the results and the committed sheet-dismiss affordance remain reachable. Selection must announce the applied Description/category/tags only after local or durable acceptance; a failed running selection must restore the exact prior values and announce rollback without a false success announcement.
- Normal mobile timer mutations show no spinner, progress bar, layout-moving loading state, or reserved idle Stop-status copy row. Idle Today orders `What are you working on?`, the small muted uppercase `QUICK ACTIONS` label, then the pills. Start, edit, delete, and suggestion-apply update optimistically; Stop dismisses only after the storage-only outbox write, while the shared header sync icon represents retained durable work. Pull-to-refresh remains the explicit visible-refresh path.
- Exercise an unresolved optimistic blank start with immediate suggestion, Save, Stop and Delete actions. Stop persistence must not wait behind an in-flight general queue sync; its original timestamp, account owner, optimistic identity, and stable client event ID survive force-quit. Correlation makes only the same account's Stop deliverable. A permanent start rejection removes that dependent Stop instead of retargeting it. Suggestion/Save/Delete retain their existing dependency and rollback contracts.
- For direct and replayed mobile Stop, assert `/api/events`, the exact canonical UUID, original timestamp, stable `clientEventId`, and 8-second deadline. Success, duplicate, and `superseded` remove one logical intent; timeout, network failure, `timer_busy`, and retryable 5xx retain it without UI rollback; ordinary permanent 4xx remains visible and is not classified as offline. Switch accounts while the bearer read is deferred and prove no request uses the replacement session. Seed malformed JSON and a non-array outbox container, then prove recovery accepts and reloads the next durable Stop.
- On relaunch/foreground, read pending Stops before correlation/bootstrap publication, project a matching pending Stop over stale bootstrap, reconcile ActivityKit from that projected state, then retry delivery. Pending A must hide stale bootstrap A but never hide or stop newer B. A permanently failed local outbox write leaves the exact running timer/sheet in place.
- Hold the user's Postgres advisory lock on one real connection and perform an entry-scoped Stop on another; it must bypass that lock. Separately hold the target row lock and require bounded `timer_busy`, then release and replay the same `clientEventId` to one event/Stop. Retain current-scope compatibility and one-active-timer start/replacement coverage.
- Seed optimistic, canonical, duplicate-canonical, stopped-but-ActivityKit-active, and stale-generation Live Activities. Cleanup must receive only exact captured IDs, await native end operations, re-read at immediate/250ms/1s bounds, and converge to zero or one canonical survivor. Registration and Stop enablement must occur only after revalidation; A→B and Stop-during-cleanup cannot end or enable B incorrectly. Exercise Reduce Motion through the unchanged sheet owner.
- Delete once from running and completed sheets and verify immediate optimistic removal, coordinated sheet/backdrop exit before Modal unmount, then an exactly five-second visible shared Undo interval. Cover Undo at 4,999 ms versus expiry at 5,000 ms, direct durable commit, exact active/completed restoration, stale callbacks, duplicate taps, rapid second deletion, quiet refresh tombstones, optimistic-to-persisted IDs, offline queue deletion, persistence failure, background/foreground expiry, Live Activity stop/restore, and starting another timer while active deletion is pending.
- Run the executable native sheet harness from a freshly built clean source revision. Require the source fingerprint to match the new native build manifest, `noBuild=false`, `noMetro=false`, and an unused Metro port owned by the runner with recorded PID/project root; diagnostic bypass or stale-product reuse is not final evidence. Cover all sheet journeys and keyboard/swipe/date-picker/reopen interruptions in normal and Reduce Motion; then run 30 normal, 30 reduced and 10 deletion iterations with zero stale callbacks, overlay-visibility drops or duplicate/rejected completions.
- Analyze original-timestamp VFR recordings with `--require-complete`. Scope every presentation by run ID plus presentation ID from open-start through matching finished exit; require calibrated native sheet/Description coverage during entrance, stable states and moving exit, overlay coverage when expected, and nonzero eligible adjacent decoded-frame comparisons. Reject missing landmarks over a populated underlay, zero-opacity update gaps, unexplained jumps above two points, settled live-sheet/Description deltas above one point, incomplete guardrail evidence or an unevaluated interval. Repeat the layout matrix on a small and a current standard/large iPhone Simulator in Light/Dark and default/accessibility-large Dynamic Type.
- XCUITest coordinate drags may produce no intermediate interactive keyboard-frame events and cannot hold one UIScrollView drag while a second finger starts the sheet handle. When that occurs, record the unchanged before/after interactive-frame count and fallback mode; demonstrate a real keyboard dismissal with the same sheet mounted, real Description refocus/keyboard/results reopen, then swipe cancel/commit/reopen. Pair it with the deterministic reducer case for commit during in-flight interactive dismissal. Do not claim native overlap; keep the simultaneous two-gesture path as a physical-iPhone before-merge check.
- When Expo dependency metadata or the iOS Pod lock changes, distinguish the baseline and final SDK versions in the investigation. Run `npx expo install --check`, deployment-mode CocoaPods installation and the full clean native Simulator build from the final lock graph; enumerate direct/transitive Pod scope and do not describe SDK-compatible patch reconciliation as a React Native or Expo SDK upgrade.
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

- In a disposable database, ingest evidence before its finalisation lag, advance only server processing time, call retained-evidence replay with no new batch, and require exactly one newly eligible Review/automatic result. Repeat replay and concurrent ingest/replay to prove no duplicate or dual entry/Review output; repeat in shadow, missing-acknowledgement, and pre-cutover states to prove semantic suppression.
- On mobile, cover zero-signal foreground replay, local current-time processing, five-by-100 native drain bounds, five-batch upload bounds, per-request upload/replay timeout, non-blocking bootstrap geofence refresh, permanent rejection continuation, retryable-stop behavior, replay throttling, forced-foreground bypass, concurrent coalescing, account isolation, stale Keychain-read invalidation across logout/login, and `401/403` session clearing. Defer an A-owned request and switch to B before batch selection, before dispatch and before response processing; no B payload may use A's token, and the stale response must not acknowledge, reject or reschedule either account's records. Settings/export diagnostics must remain coordinate-free.
- Verify all four server-controlled rollout modes: `v1`, `v2_shadow`, `v2_review`, and `v2_enabled`. Prove shadow emits no user-visible V2 semantics, review/enabled suppress competing V1 location semantics, a same-mode client acknowledgement is required for semantic cutover, and pre-cutover shadow segments cannot backfill. The checked-in/default environment value must remain `v2_shadow`.
- In `v2_enabled`, prove one finalised, continuous, route-backed `medium_high`/`high` commute between two saved Dayframe places creates exactly one confirmed category-only `Commute` entry and no Review item. Prove unknown/ambiguous endpoints, lower confidence, endpoint-only evidence, uncertain continuity, and a confirmed-time overlap remain Review-first. Remove the overlap and replay to prove an existing Review item is not promoted; ignore it and replay to prove the terminal decision remains ignored; delete an automatic commute and replay to prove it is not recreated.
- Run shared deterministic fixtures for `A -> B -> A`, sports–Home–sports, the 14-minute intermediate stop/two journeys, nearby-place ambiguity/correction, visit-supported gaps, contradictory visit evidence, poor accuracy, duplicate/reordered batches, teleport rejection, route vs straight-line distance, Europe/London midnight/BST/DST, and generated segment invariants.
- Run mobile SQLite/task coverage for migration, WAL/foreign keys, insert/dedupe/rollback, account isolation, native drain acknowledgement/corruption, 100-item batch bounds, `401`/`413`/`422`/`5xx`, retry jitter, retention, full-catalogue vs 20-region selection, service disable, and coordinate-free diagnostics.
- Run native Swift tests and `npx pod-install`; verify the local Expo module and AppDelegate subscriber autolink; build the checked-in iOS workspace without destructive prebuild cleanup.
- Apply `202607200001_location_intelligence_v2.sql` to a disposable PostGIS database and run it twice where safe. Inspect checks, GiST/time/idempotency indexes, owner trigger, user-only RLS policies, two-user same-workspace denial, bounded cleanup, cascading raw-lineage deletion, and preservation of derived segments/reviews.
- Run web/server tests for schema/body bounds, idempotent insert/replay/review creation, coordinate-free activity summaries, owner filters, private/no-store headers, expired evidence, GeoJSON `[longitude, latitude]`, `ST_DWithin`, atomic edit/split/merge/save, rollback, correction feedback, lock conflict, and legacy Accept/Ignore.
- Browser-check Review at desktop and phone widths in light/dark mode: observed-route, endpoint-estimate, no-coordinate, loading, provider-error and expired states; split preview; saved-place selection; failed mutation retaining the card; 44px targets; focus; no horizontal overflow; no console/runtime overlay; and MapLibre cleanup/client-only behavior. With `GEOAPIFY_API_KEY`, verify the authenticated same-origin style/tile path, private browser caching, coordinate-free auth diagnostics, bounded/cancelled chunked provider bodies, no key leakage, and visible Geoapify/OpenMapTiles/OpenStreetMap attribution. Without it, verify the explicit tile-free canvas. If `NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL` overrides the default, verify its authorised assets, CSP hosts, and attribution separately.
- Run `npm run validate:location-v2-sqlite`. Run `DATABASE_URL=..._test npm run validate:location-v2-db` against both a fresh base schema and the all-migrations-in-order schema; the validator must refuse a non-local host or a database name without the `_test` suffix.
- Apply the V2 migration to fresh, representative upgraded, and complete ordered disposable databases; apply it twice where intended. Test user-only RLS with two ordinary non-superusers in one workspace, not a superuser or service role. Separately verify the service-only retention grant, seven-day deletion, raw-lineage cascade, and preservation of derived/confirmed history.
- Verify `vercel.json` schedules `/api/cron/location-retention`, the route fails closed without the `CRON_SECRET` bearer value, authenticated users cannot execute the cleanup function, cleanup is bounded/locked, and failures/backlog warnings are coordinate-free. After an authorised hosted deployment, verify the production-only UTC schedule, secret, database role, and Vercel invocation logs; local route tests are not proof that the hosted cron ran.

Physical iPhone/TestFlight results must be recorded individually as `PASS`, `FAIL`, or `NOT RUN` for: foreground, background, locked, suspended, eligible system relaunch, explicit force-quit limitation, Background App Refresh off, Precise off, Always downgraded, Location Services cycle, reboot, hours offline/reconnect, duplicate retry, 300–350m walk, venue–Home–venue, 10–15m stop, long drive, 150–200m nearby places, 24-hour battery measurement, and mobile/web parity. Never infer these from simulator tests.

For the synthetic journey specifically verify two sports stays, Home not nearby school, the intermediate stop, two separated journeys, `MUM_HOME -> CHURCH -> MUM_HOME`, visible uncertainty, and identical canonical mobile/web segments. Battery evidence must list device, iOS, build, start/end battery, duration, approximate movement, foreground/background mix, and comparison baseline if one exists.

## Calendar And Review UI

Required checks:

- Calendar, List, and Timesheet render.
- Time blocks are clickable/editable.
- On web Calendar, single-click a completed, running, blank/uncategorized, tagged/place-backed, short, overlapping, lower-edge and cross-midnight fragment. Verify exactly one compact editor portal opens from the selected visible fragment; no old bottom card or advanced dialog remains; both completed/new Start and Finish use one seamless inset compound with a bare calendar icon and one neutral focus perimeter; a later Finish date shows the correct `+N`; every Start, Finish and Duration value uses 15px/21px regular foreground typography; completed/new Duration is editable and normalized minute-only `HH:MM`; running Finish says `Running`, live Duration is read-only/minute-only until stop, and subtle `Running timer` status sits below the header title rather than in the footer. Leave a running editor untouched across multiple one-second refreshes and verify it stays clean.
- Verify pointer-open on an existing block leaves focus unchanged, while click-create and every keyboard route focus Description. Space, Enter, and double click use the same shared editor; repeated activation of the already selected block must not reset a dirty draft. Every icon action has an accessible name and 44px target. Text/date/time fields show a neutral grey focused border for pointer and keyboard focus; buttons, links, tabs, dropdown triggers and icon actions show only a neutral `:focus-visible` indicator. Check Light/Dark and pointer/keyboard modality. Keyboard-open both date pickers, choose a date and Escape back to its trigger without closing the editor. First Escape closes Category and the next reaches the editor. Close/Escape and outside dismissal preserve the exact `Discard changes?` decision with `Go back` and `Discard`; changed drafts block the underlying action, restore exact focus/draft on Go back, and cannot leak rapid outside/navigation/block clicks.
- Open Edit from Timeline List single rows, grouped representative rows, expanded occurrences, and Reports matching entries. Verify each is the same `TimeEntryQuickEditor` panel/controller as Calendar inside a centred focus-trapped modal; focus returns to the invoking action; Cancel, backdrop, Escape, nested Tags, and nested date pickers use the same dirty/discard and focus-return rules. Timeline List exposes Start again/Delete and preserves grouped representative behavior plus shared five-second Undo. Reports exposes neither. Confirm no mounted or imported `EditTimeEntryDialog` remains.
- In Calendar create and Calendar/List/Reports edit, hydrate existing tags, remove/select/create tags, exercise the shared 24-tag maximum and `+N` overflow disclosure, and save tag-only plus mixed edits. Inspect partial payloads for only `description`, `categoryId`, `tagNames`, `startedAt`, and `stoppedAt`; never `placeId`, project/client, source, or task-suggestion metadata. Verify Place remains on the persisted row and in every optimistic/bootstrap collection after completed and active-running saves.
- In Calendar Day and Week scopes, single-click eligible empty day-body space with a primary fine mouse pointer at representative pixel offsets and verify local time floors to the previous 15-minute slot, Finish is exactly 30 minutes later and 23:45 becomes next-day 00:15. Repeat after vertical and horizontal scroll and at every Calendar zoom; the dashed provisional anchor must remain `aria-hidden`, non-interactive, aligned to the exact edited Start/Finish geometry, and absent from canonical entries, totals and lane layout.
- Verify touch/coarse pointer, right-click, drag beyond threshold, pointer cancellation, scroll during press, day header, time axis, scrollbar, existing block, Play/action, resize handle, provisional anchor and the visual one-pixel gap inside a block's semantic time rectangle create nothing. With a clean editor open, the first empty click dismisses only and the second independent click creates; prove the consumed pointer token survives document capture through Calendar's React `pointerup` and is cleared only afterward. With a dirty existing or create editor, the first click opens the discard decision and creates nothing; Go back preserves the exact target/draft; Discard followed by a later click creates; stale exit/session callbacks never close the newer draft.
- In Calendar create mode verify blank Description, no selected Tags, Uncategorized Category, explicit Start/Finish dates and times, editable `00:30` Duration, Close/Cancel/Save, no Play/Delete and no automatic focus stop on the provisional anchor. Calendar running and completed edit states must expose the same Cancel action beside Save while retaining outside dismissal. Save untouched, tag-selected, duration-edited, overlapping and cross-midnight drafts; inspect exactly one event-first POST with the selected `tagNames`, trimmed optional Description/Category, no hidden compatibility fields and exact timestamps. Pending POST, outside-pointer consumption, failure retention, canonical-refresh dismissal and active-timer invariance remain required.
- Inspect completed compact-save requests and persisted rows: no-change emits no PATCH; changed saves contain only owned fields; clear values become `null`; untouched timestamp seconds, sub-minute exactness and hidden metadata survive. Exercise live complete Start-owner, Finish-owner and Duration-owner updates; incomplete raw input/error deferral; `30`, `30m`, `90`, `90m`, `1:30`, `01:30`, `1h 30m`, compatibility `1:30:00`; rejection of non-zero seconds; one minute; over 24 hours; same-day, midnight and multi-day dates; and blur-through with no ownership change. Verify plain Description Enter Save/exit, no-op close, failure retention, hashtag selection, modifiers, IME and rapid mutation gating. During deferred Save/Delete, verify Description, selected tags, tag picker, temporal fields and every conflicting action are disabled, `aria-busy` plus the live mutation status are present, duplicates are rejected, and failure re-enables the form with the exact draft and initiating focus. For Start, Finish and Duration failures, verify `aria-describedby` points to one mounted, unique editor error ID and is removed when the error plane is not rendered. Keep manual Finish <= Start raw with exactly `Finish must be after Start`; reject a future Start but allow a completed entry to Finish in the future without an error or danger cue. While an unrelated timer mutation is busy, completed PATCH remains enabled; create/running mutations stay gated. Exercise stoppedAt-only API PATCHes against stored Start and all future/reversed/valid partial combinations.
- In `TZ=Europe/London` and `TZ=America/New_York`, reject clicks and edited wall times inside the spring-forward gap. For fall-back repetition, preserve untouched source ISO instants byte-for-byte, require a positive duration and positive rendered geometry even when displayed wall-clock Finish precedes Start, and recompute only the timestamp field the user actually edits.
- Exercise full Add time client validation and the authoritative manual-entry POST with one captured `now`: malformed Start/Finish, Finish-before-Start, future Start, future Finish, ordinary valid past times and a valid cross-midnight entry. Future-dated manual windows are allowed when Finish is after Start and the entry is no longer than 24 hours; assert specific 400 text and no write only for malformed, reversed or overlong windows.
- With empty and cleared Description values, verify historical task suggestions open from keyboard or pointer focus in Add Time, running/completed Edit Entry and the running toolbar even when Category is Uncategorized. Outside pointer input dismisses only the suggestion owner; blank Description-label gutter does not count as the input; Arrow navigation reaches every option; selection applies Description/Category/Tags, closes once and restores focus without reopening. On the running toolbar, selection updates the active draft and never starts a second timer.
- At phone widths, verify Add Time Suggestions, Tags and Start/Finish date-time panels remain fixed to the visual viewport rather than a query-container ancestor. Start and Finish retain programmatic names and time-only visible values without a date subline; their accessible names still expose the full date, Finish shows a visible/accessibly described `+N` for cross-midnight windows, and overlap feedback wraps on its own row without clipping.
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
- Review cards remain visually distinct at phone width; the title/time hierarchy, five-step confidence control, concise overlap row, and Location Evidence activity/time/map hierarchy remain legible with Dynamic Type and VoiceOver. Review list and Location Evidence detail chrome must match Settings with right-aligned `Review` and `Location evidence` page titles, not a repeated Dayframe brand lock-up.
- With an existing active-account cache, open Review offline and require cached cards within 300 ms without bootstrap or Health reprocess completion. Health reprocess may disable only Health items. Pull-to-refresh alone owns the visible spinner; failed background refresh retains cached content and shows Review-specific stale copy.
- For Confirm, Dismiss, and complete Edit-and-confirm from both list and Location Evidence detail, require one SQLite transaction before card/route removal, immediate existing-owner exit/reflow, no awaited network, and stable hidden state across timeout, `408`, `429`, `5xx`, `review_item_locked`, session expiry, background, force-quit, and reopen. A canonical-open permanent conflict restores exactly once at stored surviving anchors; canonical-resolved conflict stays hidden. Local SQLite failure retains the card/editor and exact draft.
- Validate Location Evidence SQLite v4 migration, DTO schema/Review-ID validation, account ownership, earlier-of-server-or-seven-day expiry, 25-row and 5-MiB UTF-8 LRU bounds, malformed deletion, canonical-open pruning, logout/account-switch cascade, cache hit/miss/age/bytes diagnostics, request deduplication, serial foreground prefetch, first-failure stop/restart, and no token/raw upload-journal duplication. Cancellation must reach the actual network fetch, keep owner-abort observation through shared persistence, mark that request identity invalid, evict only that identity, and let immediate reopen/re-entry create and retain a replacement rather than attaching to stale work. Every deduplicated consumer must recheck validity/current identity after the shared cache-write await and reject an invalid request. Hold persistence open, cancel its owner, complete the replacement, then release the stale write: cancelled evidence must not return or remain cached, and exact account/Review/time/payload cleanup must not remove replacement data.
- Exercise cached evidence with no network and unavailable Apple map tiles: times, category, textual summary, route coordinates, Back, Confirm, Ignore, and complete Edit-and-confirm remain usable. A warm cache hit that resolves within the 300 ms target must not mount the full-screen hydration panel or spinner even transiently; only a cold or unusually slow hydration may reveal loading feedback after that grace period. Fresh same-item revalidation must not remount the editor or erase a draft. Evidence GET stops at 10 seconds; complex direct-only actions stop at 15 seconds, retain the draft, and show no native exception text.
- In a disposable local Postgres `_test` database, prove Review receipt fast replay, non-blocking advisory contention, 8-second statement/1.5-second lock bounds, deterministic Review/event/exact-segment row locks, one canonical winner, rollback, and workspace/user isolation. For Location Evidence, compare representative `EXPLAIN (ANALYZE, BUFFERS)` before adding any index; accepted/rejected/nearby reads may run in parallel only after the scoped Review row resolves, with byte-identical ordering/DTO semantics.
- On a physical staging iPhone, record `PASS`, `FAIL`, or `NOT RUN` separately for warm/cold Review launch, Airplane Mode, slow/stalled network, cached/uncached evidence, map-tile loss, prefetch tap deduplication, offline durable actions, direct-only action failure, background/foreground, force-quit/reopen, session expiry/same-account login, account switch/logout, web conflict, overlap, Health reprocess isolation, timers, Live Activities, HealthKit, Location Intelligence, VoiceOver, Reduce Motion, large Dynamic Type, and System/Light/Dark. Simulator/unit evidence cannot substitute.
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

## Mobile Connectivity And Reconnect

Required whenever the global reachability owner, HTTP evidence boundary, durable projection/retry ordering, root status overlay, or connectivity-aware Review copy changes:

- Run the connectivity state/monitor/recovery, secure-session, mobile-network, finite timer-background-execution, durable projection and each recovery-owned outbox test, the complete mobile suite and typecheck, `swift test --package-path apps/mobile/modules/dayframe-background-execution`, `npx expo install --check`, `npx pod-install`, Review and Location SQLite validators, and a clean unsigned iOS Simulator build with fresh Derived Data. Review both JavaScript lockfile and `Podfile.lock` changes. Reproduce a new native dependency from the frozen base in a clean checkout. Reject unrelated checksum churn: React Native prebuilt-pod checksums may vary when generated podspec JSON embeds a different absolute artifact or CLI path, but that path-local noise must be restored to the frozen base values before commit so the accepted full-PR lock delta contains only the intended dependency graph. Do not use Expo Go as native execution evidence.
- Re-run timer Stop/outbox, Live Activity, general queue, Review cache/outbox, Location Evidence cache, Location Intelligence, HealthKit, account/session, native tab, sheet/keyboard, navigation, motion, theme and accessibility regression coverage. Reachability must never replace a durable owner or disable an offline-capable action.
- Hands-on validation uses the exact Ready PR Vercel Preview, manually promoted `dayframe-staging.vercel.app` alias, staging Supabase, and a signed EAS `preview` build. Never use production credentials/data. Record every item below individually as `PASS`, `FAIL`, or `NOT RUN`; Simulator/unit results cannot establish physical network behaviour.

Physical-iPhone matrix:

1. Cold launch online: the fixed header slot remains visually empty with no status flash and no initial cloud-check.
2. Cold launch in Airplane Mode: the neutral cloud-slash appears; Login or a same-account cached Dashboard remains usable, and no generic opening-timeout modal blocks cached operation once offline is known.
3. Online to Airplane Mode: the cloud-slash appears after approximately 300 ms in the fixed 44-point slot immediately after the wordmark, moves no header/page content and blocks no unrelated touch.
4. Airplane Mode to online with durable work: neutral circular arrows remain static while work waits and rotate only during an active recovery/delivery attempt unless Reduce Motion is enabled. Only a live pending-count change from non-zero to zero changes the same slot in place to a neutral cloud-check for approximately two seconds, then leaves it visually empty; no exit/re-entry flicker or header shift is allowed.
5. Reconnect then immediately disconnect: cloud-slash supersedes other presentation and no stale timer hides it. Force a retryable owner failure and verify static sync arrows remain while queued work is retained/backing off, rotate again only for the next attempt, and expose no raw/internal API alert. Force a permanent time-entry rejection and verify the cloud-X action opens Settings > Sync & diagnostics; while confirmed offline, cloud-slash remains the one-slot priority and cloud-X returns after reconnect.
6. Wi-Fi to cellular and cellular to Wi-Fi: no false offline flash.
7. Weak/blackholed connection: one isolated failure stays neutral; repeated request deadlines/transport failures in the bounded window confirm offline, while caller cancellation remains neutral. With unchanged NetInfo online evidence, force Offline from HTTP failures and prove the next native refresh repairs it only after the normal online debounce. Capture requests on both sides of that offline/reconnect generation: stale success must not clear current failure evidence, and stale failure must not flip the new online epoch offline. A retained Edit/Delete stops awaiting at its configured deadline and later retries.
8. API `5xx`: no incorrect offline notice.
9. Background offline, reconnect while backgrounded, then foreground: current state refreshes and exactly one recovery occurs, even when every durable queue currently reports zero so Location replay and the final bootstrap still run. Also background during an active ordered pass: an already-started timer phase may finish under its one finite assertion, but Review, Location Intelligence, and bootstrap must interrupt and resume on foreground without an unordered fallback, parallel pass or stuck status.
10. Repeated foreground/background: no duplicate listener, strip transition, recovery or stale account-owned presentation.
11. Signed-out/Login route.
12. Opening Dayframe state.
13. Today route.
14. Calendar route.
15. Reports route.
16. Review route.
17. Location Evidence detail.
18. Settings route.
19. Places and place editor.
20. Interactive swipe-back.
21. Active timer edit sheet opened while a header status is visible: the sheet contains no duplicate, Done remains reachable, and returning reveals the same current header state.
22. Completed-entry and Add-time sheets: neither contains a duplicate status or form clipping.
23. Overflow menu.
24. Date picker.
25. Keyboard shown and hidden.
26. Native tab bar expanded and minimised.
27. General queued activity event drains on reconnect without duplication.
27a. Launch or remain offline with a same-account cached Dashboard, start one timer, restore connectivity, and verify the durable Start reaches `/api/events`, receives one canonical timer ID, leaves no queued Start, and converges to the same running timer on iPhone and staging web without disappearing during bootstrap.
28. Canonical pending timer Stop delivers exactly once before ordinary backlog.
29. Stop awaiting optimistic-start correlation receives its canonical ID and targets only that timer, including when foreground/background recovery already owns the activity-queue drain.
30. Offline Review Confirm, Edit-and-confirm and Dismiss remain hidden/durable and produce one receipt/entry after reconnect; interrupt a replay once and verify its returned retryable result prevents later recovery owners/bootstrap until a newer reconnect.
31. Location Evidence upload outbox resumes without duplicate evidence or segment; interrupt upload/replay once and verify its returned retryable result prevents bootstrap until a newer reconnect.
32. Cached Review open during reconnect refreshes silently without spinner/card flash.
33. Cached Location Evidence open during reconnect revalidates silently and retains the draft.
34. No pending work leaves the fixed slot visually empty, produces no startup cloud-check and causes no request storm. A real reconnect epoch and an explicit foreground transition must still run one ordered recovery pass with zero pending work; ordinary initial-online startup at epoch zero must not. When the same durable work survives consecutive completed passes, verify retry delays increase through the bounded jittered sequence instead of resetting to the first delay; reset only after work clears or a genuine reconnect/new-work epoch arrives.
35. Rapid flapping keeps bounded requests and existing in-flight gates. An active ordinary time-entry drain must retain a later forced reconnect request and bypass obsolete retry wait once its current request settles. A scheduled retry must request a forced pass without masquerading as newly arrived work.
36. Session expiry while offline preserves the correct auth-required/sign-out path.
37. Account switch before reconnect never sends old-account work under the new account. Persist bearer plus verified user/workspace in one SecureStore envelope, then simulate interruption before the AsyncStorage active-owner update: general events, Stops, Edit/Delete, Review and Location delivery must all fail closed on the owner mismatch. For Location, switch A → B before selection, dispatch and response acceptance; the pinned A pass must never select B evidence or mutate either account from a stale response. A legacy unbound bearer must not project cached account data or replay commands until a successful bootstrap verifies and binds its owner.
38. Timer start/stop regression: while offline perform Start → Edit description/category → Stop, pull-to-refresh repeatedly, force-quit and relaunch, then reconnect. One final stopped entry remains continuously visible and converges exactly once on web. Repeat Start-only and concurrent-drain cases. Seed older Health, Location Evidence, and Location Intelligence events ahead of a newer explicit Start/Switch: the explicit timer may use the finite timer phase first, but every older event must remain durable, process once on foreground, preserve its original `occurredAt`, and never replace the newer timer; overlapping Health must remain Review-first. While recovery's final bootstrap is in flight, tap Stop and separately save an Edit; the recovered snapshot must be rejected through the ordinary mutation-revision/deletion guard, queue a fresh projected load and never visibly resume or revert the entry. For online Start, Switch, Stop, Edit and Delete, background immediately after the action and verify acknowledgement/settlement when iOS grants time; on native expiry or offline failure verify exact-once task cleanup, no loop, retained work and one retry after foreground/relaunch. Repeat logout and account replacement during transmission.
39. Live Activity start/stop/convergence regression.
40. Today, Calendar and Reports data regression.
41. Review cache-first warm-launch regression.
42. Location Evidence cache/prefetch cancellation and replacement protection.
43. HealthKit import and Review regression; reconnect alone performs no import.
44. Location Intelligence capture/upload/replay regression.
45. Settings queue/Review/Location diagnostics regression, including cloud-X tap routing directly to Sync & diagnostics and account-owned plain-language Retry/Discard actions for permanent timer Stops and time-entry Edit/Delete commands.
46. System, Light and Dark appearance.
47. Large Dynamic Type/no horizontal overflow. On iPhone 11 and the current supported wide phone, compare idle/running cards with empty/long descriptions and zero/one/many/long Quick Actions: 136-point baseline cards, shared Play/Stop and Plus centres, fixed top controls, 14-point visible top/bottom padding, Plus-to-visible-pill bottom alignment at card-relative `y=122`, trailing partial-pill scroll affordance, 44-point effective targets around the 32-point pill bodies, unclipped press states, and no card-column translation. For larger content, verify the cards grow without moving the top controls or losing the 14-point visible bottom inset.
48. VoiceOver: one root announcement per distinct visible transition, including a repeated Offline transition after a settled empty state; no forced focus move. On the focused tab, the icon is manually revisitable as one labelled element/button with no duplicate SVG traversal; inactive eager tab routes expose no duplicate status.
49. Reduce Motion: pending and transmitting arrows remain static; state changes retain restrained opacity only with no layout or travel. With motion enabled, pending/backoff remains static and only active transmission rotates.
50. Reduce Transparency and contrast/non-colour status cues.
51. Permanently reject a timer Stop plus an offline Edit and Delete with validation/not-found responses. Each rejected command must leave the live pending count, count toward cloud-X attention, stop affecting the Dashboard projection, restore canonical server truth, and appear under Settings > Sync & diagnostics with owned plain-language Retry and Discard actions; retryable backoff must remain distinct and continue projecting. Retrying or discarding one account's issue must not mutate another account's command.
52. Seed malformed time-entry outbox JSON, a non-array container and one invalid record beside a valid record. Invalid bytes must be quarantined with bounded local-only diagnostics rather than silently disappearing, while valid owned commands remain replayable and no quarantined payload is logged or projected. Recoverable owner fields must scope the diagnostic and clear action to that account; account A cannot see or clear B's forensic record. Ownerless corruption must be labelled device-wide and cleared only through its separate action.

For items 11–20 and 23–26, primary tabs must keep the icon in the same fixed 44-point slot immediately after the shared wordmark with no page/header reflow, clipping, covered navigation/content/keyboard/tab bar/home indicator, focus loss, unrelated gesture interception or unsafe native-tab geometry. Settings/detail routes contain no duplicate. Verify the neutral `textSecondary` glyph contrast in Light, Dark and System appearance. For items 21–22, sheets contain no duplicate and returning preserves the current root-owned state. Exercise keyboard shown/hidden, tab minimisation, interactive swipe-back and maximum Dynamic Type. Record physical timings for offline confirmation, reconnect-to-syncing, pending-zero-to-synced, synced-notice duration, initial flashes, automatic retry delay and parallel pass count. Targets are approximately 300 ms, under one second, only after the live count reaches zero, approximately two seconds, zero, bounded jittered backoff and zero parallel passes.

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
- Categories creation keeps its focused name field, all 30 shared swatches in the canonical five-column order, pin state and actions above the iOS keyboard; selected-state labels remain usable with Dynamic Type and VoiceOver.
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
- For `/api/timer-state`, exercise web cookie, mobile app bearer, valid `x-dayframe-ingest-token` with `time:read`, missing scope, invalid/revoked token, two-user/same-workspace and cross-workspace isolation. Verify `private, no-store`, one lightweight timer query, age-bounded integration-token bookkeeping, and no awaited/enqueued Live Activity work on the response path.
- Hold Live Activity/APNs delivery unresolved and fail it after the authoritative mutation. Start, exact Stop, atomic Start-as-Switch, running Edit and Delete responses must settle from their committed database outcome first. Verify the durable revisioned outbox remains retryable, while push failure cannot change a success response.
- On web, hold refresh reconciliation unresolved after Stop A commits, then request Start B. The mutation gate must admit/sequence the newer intent, B must remain the sole running timer, the exact Stop for A must never stop B, and late refresh/mutation responses must not overwrite B. Repeat with duplicate idempotency keys and rapid duplicate controls.
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
- Run `npm run check:docs`.
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
