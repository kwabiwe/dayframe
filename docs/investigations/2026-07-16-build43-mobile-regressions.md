# Build 43 mobile regressions

## Scope and shipped baseline

- Reported baseline: TestFlight `0.1.0 (43)` from PR #68.
- Verified repo baseline: `main` at `1d68f7b`; PR #68 merged as `7ec7a76`; no open PRs when the investigation branch was created.
- Affected paths: mobile timer mutations, running-timer suggestions, edit-sheet delete confirmation, shared task-suggestion ranking, iOS geofencing, and mobile Calendar pinch zoom.

## Documentation conflict

`docs/feature-fix-tracker.md` still describes PR #67's sheet-edge mutation progress bar as shipped behaviour to verify. The newer `AGENTS.md`, `docs/dayframe-regression-checklist.md`, `.codex/reference/components.md`, `.codex/reference/validation-matrix.md`, and this regression report explicitly prohibit visible spinners or progress bars for normal timer mutations. This fix follows the newer, repeated no-visible-loading contract and updates the tracker wording in the PR.

## Evidence and hypotheses before implementation

### Timer loading and Play flow

1. Ordinary loads may be driving the pull-to-refresh spinner.
   - Proof target: dashboard `RefreshControl.refreshing` is tied to a general loading flag rather than an explicit pull gesture.
   - Disproof target: a separate refresh-only flag is already used.
2. Mutation-specific progress UI may still be mounted.
   - Proof target: active-card or edit-sheet progress components render from start/stop/save/delete state.
   - Disproof target: mutation state is internal only and has no visual consumer.
3. Active Play may still call the start endpoint.
   - Proof target: the Play handler lacks an active-entry guard before `startTimer()`.
   - Disproof target: active Play exits by opening the running edit sheet.

### Delete confirmation stability

1. Opening confirmation may dismiss the suggestion panel through the sheet's outside-touch handler.
   - Proof target: delete touch bubbles through the scroll container before the native confirmation opens.
2. Confirmation may replace or conditionally unmount form content.
   - Proof target: delete-confirm state selects a different content tree instead of overlaying the existing sheet.

### Suggestion quality

1. A hard recent-first selection rule may override the score.
   - Proof target: compact ordering inserts the newest item before contextual/frequent candidates.
2. The query may train on only a recent slice and may not distinguish explicit review acceptance from automatic confirmation.
   - Proof target: a short time window or row cap truncates older routines, while provenance only checks `source`/`review_status`.

### Geofence reliability

1. Re-registering unchanged regions may create apparent false enters because Expo reports initial iOS region state at startup.
   - Proof target: Settings refresh calls `startGeofencingAsync()` unconditionally and transition handling cannot distinguish duplicate/current-state callbacks.
2. Missed visits may come from stale registration rather than event processing.
   - Proof target: geofences are refreshed only from Settings/Places, not authenticated app bootstrap/foreground rehydration.
3. Configured radii and the 20-region limit may be unsafe or opaque.
   - Proof target: sub-reliable radii are passed directly to iOS, selection is silently truncated, and diagnostics report stored rather than live registration state.
4. Region callbacks may be accepted without supporting evidence.
   - Proof target: enter/exit handling does not inspect a recent location fix or persist a reasoned transition decision.

### Calendar zoom

1. Gesture moves may rerender all eagerly mounted tabs.
   - Proof target: pinch calls provider-level React state on every move.
2. Anchor math may ignore movement of the gesture midpoint.
   - Proof target: scroll correction uses scale but not the delta between initial and current midpoint.
3. Uncoalesced scroll updates may queue work faster than frames are committed.
   - Proof target: every move schedules its own React update and `requestAnimationFrame` scroll.

## Initial findings

- All three timer-loading hypotheses are confirmed: the dashboard uses a general `loading` flag for `RefreshControl`, the active card renders `timerProgressSlot`, and `ActiveTimerEditSheet` renders `SheetMutationProgress` for ordinary mutations.
- Active Play is confirmed to fall through to `startTaskWith()` and `startTimer()` when an active entry exists.
- Delete uses a native alert, but the delete press occurs inside the scroll view's outside-touch suggestion dismissal path, so suggestions can collapse before the alert appears.
- Suggestion ordering explicitly adds the newest item first. The query is limited to 120 days / 500 rows and cannot currently identify entries created by an explicit Review acceptance.
- iOS background mode, Always permission strings, and top-level task definitions are present. Registration is nevertheless refreshed from Settings/Places only, is unconditional when reached, silently slices to 20, and reports a persisted count without checking `hasStartedGeofencingAsync()`.
- Expo documents that iOS reports the initial state of registered geofences at app startup and allows updating regions by calling `startGeofencingAsync()` again. Apple documents a 20-condition limit, prioritisation/rehydration responsibility, and boundary hysteresis that can be roughly 200m depending on available location technology.
- Calendar zoom updates provider-level `calendarHourHeight` on every move, schedules one scroll request per move, and omits midpoint translation from its scroll equation.

Official platform references used:

- Expo Location geofencing and background-location contract: <https://docs.expo.dev/versions/latest/sdk/location/>
- Apple region-monitoring limit and relaunch responsibility: <https://developer.apple.com/documentation/CoreLocation/monitoring-the-user-s-proximity-to-geographic-regions>
- Apple region-boundary/hysteresis testing guidance: <https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/RegionMonitoring/RegionMonitoring.html>

## Implemented root-cause fixes

### Timer flow and stable deletion

- Replaced shared mutation-loading flags with an optimistic bootstrap-state layer for start, suggestion apply, edit, stop, and delete. Mutations serialize in the background and reconcile with one silent bootstrap reload after the chain drains.
- Kept a separate refresh-only flag; only an explicit pull gesture controls `RefreshControl.refreshing`.
- Returned the inserted `timeEntryId` from event processing so a bare optimistic timer can adopt its persisted identity before later PATCH/delete operations.
- Guarded the main Play button when a timer exists, so it opens the running Edit Timer sheet and never posts a second start.
- Replaced the native delete alert with an accessibility-modal overlay inside the still-mounted sheet. The delete press stops propagation so the suggestion panel and form beneath do not collapse.

### Suggestions

- Removed hard newest-first placement and reduced the recency weight in favour of frequency, time bucket, weekday/day-kind context, and recurring history.
- Removed the 120-day query boundary and increased the bounded source sample from 500 to 5,000 completed entries.
- Added explicit accepted-Review provenance. Manual/mobile confirmed history remains eligible; automatic/system sources remain excluded unless their Review item was explicitly accepted. Health imports remain excluded because automated Health reprocess also uses accepted status and the current schema does not record who resolved a Review item.

### Geofencing

- Verified the existing iOS `location` background mode, Always/When-In-Use permission strings, and top-level Expo task definition.
- Rehydrates saved regions after authenticated bootstrap/foreground load, persists a region fingerprint, and skips unchanged re-registration. This removes the repeated-start path that can surface iOS initial-state callbacks as apparent new enters.
- Keeps configured radii within the existing 25-2,000m product bounds, selects the first 20 regions deterministically by priority/radius/id, and exposes selected/excluded place names plus live task state in Settings diagnostics.
- Persists privacy-safe enter/exit evidence summaries on device. A recent accurate fix can reject an enter only when it is conclusively beyond the configured radius plus a conservative 100m boundary buffer; missing/stale fixes do not block transitions.
- The PureGym false enter is consistent with unconditional re-registration plus uncorroborated initial-state handling, but build 43 did not retain enough historical evidence to prove that single callback. The missed School visit is consistent with registration being refreshed only from Settings/Places or an opaque 20-region exclusion; the new lifecycle rehydration and diagnostics cover both failure modes.

### Calendar

- Moved pinch density state into `CalendarTab`, preventing each gesture move from rerendering the provider and all eagerly mounted native-tab routes.
- Coalesces move events to one update per animation frame and applies the scroll correction after the new timeline layout commits.
- The anchor equation now includes both scale and the delta between the initial/current gesture midpoint, so two-finger translation does not make content drift away from the fingers.

## Residual device risks

- Core Location boundary delivery still depends on real-device radio/location conditions and iOS scheduling. Simulator/unit checks can validate registration and evidence logic but cannot prove background entry/exit delivery.
- The exact PureGym and School incidents cannot be replayed because build 43 stored only the last high-level transition status, not the new evidence history.
- The schema cannot distinguish a manual Health Review acceptance from automated Health reprocess acceptance, so Health history remains conservatively excluded from task training.

## Validation evidence

Automated:

- `npm run lint` passed.
- `npm run typecheck` passed for mobile, web, and shared.
- `npm run test` passed: mobile 164 tests, web 138 tests, shared 56 tests.
- `npm run build` passed for the production Next.js app.
- `npm run check:brand-assets` passed.
- `git diff --check` passed.
- Native Debug simulator build passed with `xcodebuild` for `iPhone 17 Pro, iOS 26.5`. Warnings were confined to existing React Native HealthKit/Expo dependencies and build-phase metadata.

Interactive iPhone 17 simulator:

- Empty Play immediately displayed one active timer and the running `Edit timer` sheet with six suggestions; no spinner, progress bar, or layout-moving state appeared.
- Applying a suggestion updated the existing timer description/category and dismissed suggestions without another start UI or visible mutation loading.
- Pressing Play with that timer active reopened the same running sheet.
- The in-sheet delete confirmation overlaid the still-mounted edit content. Cancelling restored the same content/scroll position; no deletion was performed during QA.
- Stop removed the active timer immediately and returned to Today without mutation progress UI.
- Calendar rendered its 24-hour timeline in the native simulator. Multi-touch pinch cannot be synthesized by the available simulator-control interface, so anchored scale/midpoint behavior is covered by the new gesture-math tests and remains a physical-device feel check.

Release preflight:

- `npm run testflight:preflight` verified Xcode, bundle metadata, and CocoaPods, then stopped as expected because this machine lacks the Apple Distribution identity, App Store provisioning profile, and local App Store Connect API environment file. No archive/export was attempted, and the PR does not change build/version metadata.

Post-merge release:

- After PR #69 merged to `main` as `e1554e4`, the release machine reran `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:brand-assets`, `git diff --check`, and `npm run testflight:preflight`.
- TestFlight build `0.1.0 (44)` was archived, exported, uploaded, and verified in App Store Connect with delivery/build ID `c9c48192-4cc2-47a8-a272-0cf6bd6b5107`, `processingState=VALID`, `usesNonExemptEncryption=false`, en-GB notes set, `Internal Health Debug` all-build access, and `internalBuildState=IN_BETA_TESTING`.
- Vercel production is Ready for commit `e1554e4` at `https://dayframe-ogjqj5sq5-dayframeworkshop.vercel.app`, aliased to `https://dayframe-web.vercel.app`.

## Closure criteria

- Timer start, stop, edit/save, delete, suggestion apply, and opening edit/suggestions have no mutation spinner/progress/layout-loading UI and reconcile silently after optimistic state changes.
- Empty Play creates one bare timer and opens its running sheet; active Play only opens that same sheet; suggestion apply issues a PATCH for that active entry and no start request.
- Delete confirmation overlays the existing sheet without dismissing or reflowing its content.
- Ranking is score/context/frequency-led, uses a broader history, learns from manual entries plus explicitly accepted review history, and excludes unconfirmed automatic/system noise.
- Geofence setup is permission-safe, rehydrated from normal authenticated app lifecycle, avoids unchanged re-registration, records live registration/selection diagnostics, handles the 20-region cap explicitly, preserves configured radii inside product bounds, and records/rejects contradicted transition evidence without exposing raw coordinates.
- Calendar pinch state is isolated from the dashboard provider, frame-coalesced, and uses scale plus midpoint translation to keep the content anchor stable.
