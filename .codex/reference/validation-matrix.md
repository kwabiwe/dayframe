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
- With a running timer, open More at the right edge and verify Delete is directly below the trigger, remains inside the viewport, dismisses on outside click/Escape, and returns focus to More.
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

Native Calendar evidence:

- Run deterministic TypeScript bridge/serialization tests and Swift unit tests for native date clipping, block metrics, zoom bounds/state restoration, and callback identity where those helpers live.
- Run `npx pod-install` (or the repository-equivalent CocoaPods install) after adding/changing the local native module; do not use destructive `expo prebuild --clean` as a shortcut over the checked-in native project.
- Run the mobile typecheck, full mobile tests, and a full iOS simulator build.
- On a physical iPhone, record repeated pinch-in/pinch-out while moving the midpoint, vertical pan at multiple zoom levels, day/week navigation, and entry/review taps. Inspect frame pacing with Xcode tooling when available; screenshots alone cannot validate gesture smoothness.
- Verify System, Light, and Dark, Dynamic Type, VoiceOver, Reduce Motion, Reduce Transparency, and the minimum supported iOS version.

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
- Provider/Supabase auth if production is involved.
- Never use a prefetchable GET link for logout or another state change. Verify rendering Profile, Settings, and troubleshooting makes no logout request; explicit logout is one POST; GET is side-effect free; repeated POST is safe.
- Test missing, invalid, expired, revoked, valid, database-failure, and missing-scope paths. Only a structured session `401` may replace the browser location; `403` and `500` must remain in place.
- Validate session TTL configuration at startup and prove cookie `maxAge` and database expiry share the resolved bounded value. Treat sliding renewal as a separate security/product design.
- In an optimized web build, test Enter/click, wrong-then-correct credentials, duplicate submission, slow network, one continuous branded opening state, hard refresh, Back/Forward, direct `/login`, two tabs, timer start/stop, and console/network output at desktop and phone widths.
- Measure authenticated reconciliation traffic. Keep elapsed display ticking locally while bootstrap uses initial/mutation/focus/visibility plus a conservative foreground interval.
- Hosted auth changes require a provider-auth Vercel Preview pass before merge, including a 10-minute visible-tab observation, tab switching, safe Vercel reason logs, explicit logout/login, Safari/WebKit where available, and canonical/custom hostname checks for host-scoped cookies.
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
