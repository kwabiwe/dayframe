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
- Active timer card and running edit sheet use the same exact active-entry timestamp and display the same elapsed seconds.
- Empty mobile Play creates one timer, then opens the running edit sheet without showing start-state controls.
- Pressing mobile Play while a timer is already running opens the same running edit sheet/suggestion flow instead of bypassing suggestions or starting a duplicate.
- Applying a running-timer suggestion issues one entry update and never another timer-start request.
- Running-sheet suggestions stay above Description/Category/Start time, cap at six, dismiss outside, and hide when Description receives focus.
- Suggestions that arrive after the running sheet opens may appear only while the description is still untouched; they must not reopen after manual entry has begun.
- Normal mobile timer mutations show no spinner, progress bar, or layout-moving loading state. Start, stop, edit, delete, and suggestion-apply should update optimistically and reconcile silently; pull-to-refresh remains the explicit visible-refresh path.
- Edit Timer delete confirmation does not unmount/collapse the suggestions area or reflow the sheet content underneath.
- Today history left-swipe keeps one smooth horizontal gesture on the UI thread: the danger action and icon travel with the row edge, the row settles without a release-time pop, and ordinary vertical scrolling does not open actions accidentally.
- Today history delete uses the same app-owned borderless confirmation as Edit Timer, never the system alert. Verify Cancel, optimistic Delete, rollback on failure, individual rows, expanded grouped children, and collapsed-group safety.

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
- Repeated Today entries collapse by normalized description and category, descriptionless entries collapse by category, totals sum their children, and expanded children remain individually editable.
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
- Web is checked at desktop, tablet and phone widths; iOS is checked with Dynamic Type, VoiceOver, Reduce Motion and Reduce Transparency.

## Auth, Workspace, And Deployment

Required checks:

- `DAYFRAME_AUTH_MODE=dev` if local dev flow is involved.
- `DAYFRAME_AUTH_MODE=local` if local email/password is involved.
- Provider/Supabase auth if production is involved.
- Mobile bearer session still works.
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
