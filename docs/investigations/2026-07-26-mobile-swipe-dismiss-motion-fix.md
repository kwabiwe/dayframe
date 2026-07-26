# Mobile swipe-dismiss motion fix

Date: 2026-07-26

## Scope and base

- Branch: `fix/mobile-swipe-dismiss-motion`
- Exact base: `0d5725520e8151ad9f1c34add4ff7806aa5de528`
- The base contains merged PR #118 (`cb43983e16f3bf3a22e2976d52759358066d7934`), PR #119 (`dd5b10ff9d7308076f5d9b2d7ed2adf3e7e9b5aa`), and PR #120 (`0d5725520e8151ad9f1c34add4ff7806aa5de528`).
- Reported build: internal TestFlight `0.1.0 (67)`, delivery/build ID `cc8acc89-0580-483e-978a-8e4aaec00ba7`, archived from the PR #118 implementation with production API base `https://dayframe-web.vercel.app`.
- This change is limited to shared mobile sheet motion. Automatic-category behaviour, timer/location/HealthKit data contracts, and the Edit entry/Edit timer design are unchanged.

## Supplied evidence and reproduction

The supplied attachment is a single 230 × 500 JPEG frame, not an animated GIF, so it cannot honestly support a frame-by-frame timing claim. It shows the Today screen still covered by the translucent dark overlay while no sheet is visible. That is direct visual evidence of the ghost-backdrop state and is consistent with the user-reported sequence: custom downward translation, visible reset, native Modal exit.

The physical-iPhone build-67 reproduction was reported by the user. Local App Store Connect evidence confirms build 67 is `VALID` and `IN_BETA_TESTING` in `Internal Health Debug`. No connected physical iPhone was available to this session, so the device reproduction and 60 fps recording were not rerun.

Before editing, the exact current-main code received a clean arm64 iOS Simulator build after running the PR #119 CocoaPods repair and using isolated DerivedData. The app installed, bundled, and launched on an iPhone 17 Pro Max simulator running iOS 26.5. The locked Mac host left the development-client confirmation above the app and prevented automated touch gestures. Simulator gesture reproduction is therefore not claimed.

## Confirmed causes

1. `SwipeDismissSheet` reset its visible `dragY` to zero before calling `onDismiss` after a successful exit.
2. The shared sheet performed a custom downward timing animation while Edit entry/Edit timer and learned-place details also used `Modal animationType="slide"`.
3. The resulting owners could render custom exit → reset at rest → native Modal slide exit.
4. Each consumer rendered a static sibling backdrop whose opacity was unrelated to sheet translation.
5. Rejected releases used a fixed 260 ms timing-to-zero. That discarded release velocity and felt like an abrupt reverse or bounce, even though the easing did not mathematically overshoot.
6. PanResponder wrote `Animated.Value` from the JavaScript thread during direct manipulation.
7. Edit timer/entry added keyboard lift and swipe drag into one transform, so keyboard frame updates could compete with the drag.
8. Termination settled without a committed-dismiss state, leaving competing callback/settlement paths possible during interruption.

Lowering the old 96-point threshold would not repair any of these ownership or ordering failures.

## Final motion contract

- Trigger: a downward pan beginning on the dedicated 44-point handle. The form ScrollView does not own the pan.
- Owner: `SwipeDismissSheet` is the only entrance, direct-manipulation, backdrop, rejected-settlement, and exit owner. Parent React Native Modals are transparent with `animationType="none"`.
- Entrance: normal motion begins below the viewport and times to rest over the existing 260 ms sheet duration while the backdrop becomes visible from the same translation progress.
- Update: Gesture Handler and Reanimated update positive-only translation on the UI thread. Horizontal travel outside ±24 points fails activation.
- Rejected release: a damping-36/stiffness-320/mass-1 spring returns from the exact position with overshoot clamped. Interruption of an entrance or prior settle starts from the current shared translation rather than snapping.
- Successful release: the sheet continues from its exact current translation to a target at least one viewport plus 32 points below rest. Backdrop progress reaches zero from that same shared value. The parent callback runs only after the UI-thread exit completes; translation is not reset while visible.
- Interruption: a UI-thread committed flag plus a callback coordinator makes the latest committed outcome terminal, ignores later settle paths, and invokes dismissal once. Hidden lifecycle reset is the only coordinator reset.
- Reduce Motion: translation remains at rest and entrance/exit use a 70 ms opacity-only transition.

## Dismissal decision

The decision uses:

`projected endpoint = positive translationY + positive velocityY × 0.14 seconds`

The projected endpoint must reach a sheet-relative distance of 20%, clamped to 96–128 points, after at least 12 points of downward travel. This supports slow qualifying drags and short fast flicks without a visible threshold effect. Upward, disabled, and primarily horizontal releases reject. The decision reads only gesture translation/velocity; keyboard lift cannot change it.

These values have behavioral boundary coverage but remain provisional until the required physical-iPhone feel pass.

## Backdrop and close ownership

The theme retains its existing overlay colour. Its opacity is now:

`1 - positive translationY / off-screen target`

clamped to 0–1 and multiplied by presentation presence. A rejected spring restores sheet and backdrop together; a committed exit reaches a clear backdrop when the sheet reaches its target. The backdrop Pressable lives inside the shared owner and uses the same exit coordinator.

Swipe, backdrop, Done/save, timer stop, successful entry deletion, native request-close, explicit close buttons, learned-place Save/Edit navigation, and successful learned-place Ignore/Forget all route through the coordinator. Blocking date pickers and delete confirmations continue to disable the handle gesture.

## Keyboard coordination

Edit timer/entry now has nested motion layers: the outer core Animated layer owns keyboard lift, while the inner Reanimated layer owns swipe translation. Starting a handle gesture freezes keyboard layout application. A rejected settle applies the latest queued keyboard frame once the spring completes. A committed exit keeps keyboard lift frozen and dismisses the keyboard so a keyboard-hide event cannot pull the sheet upward during exit. The off-screen target remains at least a full viewport, including when the sheet began lifted above the keyboard.

The active entry is retained as a presentation snapshot while visible, so optimistic stop/delete state cannot unmount the sheet before its coordinated exit finishes.

## Consumers

Updated shared consumers:

- Edit entry
- Edit running timer
- learned-place details
- saved-place/location information
- location-suggestions information

Content height, safe-area padding, form and horizontal category scrolling, keyboard-aware sizing, existing busy/disabled gates, and close accessibility labels remain owned by their existing consumers.

## Files changed

- `apps/mobile/src/components/SwipeDismissSheet.tsx`
- `apps/mobile/src/components/ActiveTimerEditSheet.tsx`
- `apps/mobile/app/places.tsx`
- `apps/mobile/app/settings.tsx`
- `apps/mobile/src/lib/swipeDismissMotion.ts`
- `apps/mobile/src/lib/mobileTheme.ts`
- mobile swipe-dismiss behavioral/ownership tests
- this investigation, the feature/fix tracker, and the regression checklist

No automatic-category, API, database, location, timer, or HealthKit contract file changed.

## Automated validation

Focused motion tests:

- `src/lib/swipeDismissMotion.test.ts`
- `src/components/swipeDismissConsumers.contract.test.ts`
- 2 files, 28 tests passed

Complete mobile suite:

- 38 files, 274 tests passed
- mobile TypeScript check passed
- Metro produced the iOS bundle without an error

Complete workspace suite:

- 117 files, 828 tests passed: mobile 38/274, web 74/459, shared 5/95
- `npm run lint` passed
- `npm run typecheck` passed
- `npm run test` passed
- `npm run check:brand-assets` passed
- `npm run typecheck -w @dayframe/mobile` passed
- `npm run test -w @dayframe/mobile` passed
- `git diff --check` passed

## Manual and accessibility validation

- iOS Simulator native build/install/launch: baseline and fixed arm64 Debug builds passed; the fixed app installed, bundled, and launched without a runtime overlay.
- Simulator touch matrix: not run because the Mac host was locked and the development-client confirmation could not be operated.
- Physical iPhone and 60 fps frame-by-frame matrix: not run; no device was connected.
- Light/Dark visual matrix: not run.
- Reduce Motion: implementation and behavioral lifecycle coverage passed; physical visual check not run.
- Dynamic Type: measured exit target is dynamic; manual size-category check not run.
- VoiceOver: the handle is a labelled 44-point button with a double-tap dismissal action, and explicit close/Done alternatives remain; manual focus/announcement check not run.

These are merge blockers, not inferred passes.

## Remaining limitations and merge gates

Before merge, run the full physical-iPhone matrix from the issue, capture 60 fps where possible, and verify frame by frame:

- no upward frame after commit
- no second downward/native exit
- no sheet-at-rest frame before close
- no lingering or blank translucent backdrop
- no JavaScript-contention stutter
- keyboard-open/closed, Description, hashtag, date picker, category scroll, delete confirmation, long form scroll
- Light/Dark, Reduce Motion, Dynamic Type, VoiceOver handle and alternative close

Physically tune the 0.14-second projection and 96–128-point distance only if that evidence shows the decision feel is wrong; do not use threshold tuning to mask an ownership defect.

## Rollback

Revert this focused PR. No migration, persisted data, API contract, automatic category, build-number, TestFlight, or release rollback is required.
