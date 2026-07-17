# Native SwiftUI Calendar zoom correction

Date: 2026-07-16
Baseline: `main` after PR #71, TestFlight `0.1.0 (46)`
Branch: `codex/native-calendar-swiftui`

## Reported symptom

- On a physical iPhone, Calendar pinch zoom still feels clanky after PR #71.
- The obvious jitter is reduced, but the overall zoom interaction feels worse and lacks the continuous system feel expected from an iOS calendar.
- This report supersedes the Calendar smoothness acceptance recorded in the PR #71 investigation; the Today grouping and timer-flow portions remain independently under Watch.

## Current interaction path

- `CalendarTab` lives inside `apps/mobile/src/components/DayframeDashboard.tsx` and renders the 24-hour grid, entry blocks, current-time line, week strip, day navigation, and entry actions in React Native.
- During pinch, Reanimated temporarily applies `scaleY` and `translateY` to the whole timeline canvas.
- When the gesture ends, React commits a new `hourHeight`, rebuilds the hour labels and block metrics, scrolls to a calculated offset, and resets the temporary transform.
- The outer dashboard `ScrollView`, React Native pan responders, Gesture Handler pinch recognizer, and post-gesture React layout therefore participate in one direct-manipulation journey.

## Working hypotheses

1. The remaining clank is primarily the handoff between the temporary transformed canvas and the newly laid-out React tree on release.
   - Prove: a release-time snap or geometry/offset discontinuity remains visible even when active-pinch frames are steadier.
   - Disprove: an instrumented build shows continuous geometry/offset with no handoff while the user still reports the same issue.
2. Competing nested scroll/gesture ownership makes the interaction feel unlike a native iOS calendar.
   - Prove: gesture arbitration, outer-scroll locking, or responder transitions correlate with stalls or unexpected movement.
   - Disprove: one native scroll/zoom owner reproduces the same behaviour with the React handlers removed.
3. A naive pure-SwiftUI magnification implementation could repeat the same problem if it changes layout geometry every frame and then normalizes on release.
   - Prove: the SwiftUI prototype still shows layout churn, focal drift, or a release snap.
   - Disprove: physical-device evidence meets the acceptance criteria using pure SwiftUI. Otherwise use `UIScrollView` through `UIViewRepresentable` so the system owns continuous zoom and content offset.

## Verified root cause

- The reported handoff was present in the implementation, not only in the earlier investigation note. The React Native Calendar applied temporary Reanimated `scaleY`/`translateY` values during pinch, then replaced them with a new React `hourHeight`, rebuilt timeline geometry, changed the outer dashboard `ScrollView` offset, and reset the temporary transform on release.
- Calendar vertical scrolling, a Gesture Handler pinch recognizer, React Native pan responders, outer-scroll locking, and React layout therefore shared one direct-manipulation journey.
- The fix removes that ownership split. Geometry shown during native pinch `.changed` is the retained model's committed geometry; gesture end clears coordinator state without a transform-to-layout normalization step.

## Accepted architecture direction

- Keep the existing Expo/React Native app and native tab route.
- Add a standard iOS-only local Expo native-view module for the Calendar presentation surface. Export an `ExpoView`, retain one `UIHostingController`, and use typed Expo `Record` props/view events for the bridge; do not use the experimental inline-module path.
- Build the Calendar UI in SwiftUI. It may wrap a UIKit `UIScrollView` through `UIViewRepresentable` for the timeline's continuous focal-point-preserving pinch/scroll behaviour.
- Keep React Native responsible for bootstrap/authenticated data, active-timer truth, mutations, selected route state, and the existing active/completed/review sheets.
- Pass a serializable presentation model into Swift and emit semantic callbacks with stable identifiers. Swift must not call Dayframe APIs, write the offline queue, or create another timer/data store.
- Give the timeline one native gesture/scroll owner and preserve native view identity across `now` ticks and ordinary data refreshes.
- Keep this PR iOS-only and Calendar-only. A separate preview app or broader Swift migration remains future work.

## Implemented architecture

- `apps/mobile/modules/dayframe-calendar` is a standard iOS-only local Expo module using `ExpoModulesCore`. It exports one `ExpoView`, creates one retained `UIHostingController<DayframeCalendarRootView>`, and updates an observable model on prop changes rather than recreating the controller.
- Typed Expo `Record` values carry one serializable presentation model into Swift. Semantic events carry selected day, day/week deltas, stable entry/review IDs, and deliberate refresh requests back to React Native.
- `apps/mobile/src/lib/nativeCalendarPresentation.ts` owns React-to-native serialization and callback routing. React Native continues to resolve the theme and own bootstrap/auth state, API/offline mutations, selected route state, active/completed editors, and Review navigation.
- The SwiftUI Calendar owns the week strip, selected-day summary, fixed 24-hour grid, current-time line, active/completed/review blocks, compact thresholds, cross-midnight continuation edges, empty state, accessibility metadata, and theme rendering.
- A `UIViewRepresentable` coordinator attaches one `UIPinchGestureRecognizer`, one horizontal day pan, and one `UIRefreshControl` to the SwiftUI timeline's native `UIScrollView`. The scroll view retains one-finger vertical pan/deceleration. Pinch values stay native and never cross the React Native bridge per frame.
- Pinch math records the starting hour height, content offset, midpoint, and logical minute; every update uses the recognizer's absolute scale, clamps hour height to 48-128 points, follows a moving midpoint, and clamps content offset at both day boundaries. Model/now refreshes preserve hour height and useful scroll position.
- The superseded React Native Calendar renderer, outer-scroll lock, temporary transform, gesture helpers, block helpers, and their obsolete tests are removed. Pinned gesture packages remain installed for Expo Router compatibility, but Calendar no longer imports or uses them.

## Behaviour parity requirements

- Fixed 24-hour grid with 00:00 boundaries.
- Week strip, selected day, Today treatment, day selection, and day/week navigation.
- Correct day-overlap totals, cross-midnight clipping/continuation edges, active entry, completed entry, review candidate, and empty state.
- Current-time line for Today.
- Existing compact/tiny block label thresholds and category/review styling.
- Taps route to the existing active timer editor, completed-entry editor, or Review flow.
- System, Light, and Dark themes; Dynamic Type; VoiceOver; Reduce Motion; Reduce Transparency; safe areas; and the minimum supported iOS version.

## Closure criteria

- Repeated physical-iPhone pinch-in and pinch-out remains continuous while the midpoint moves, with stable focal anchoring and no release-time snap, blank frame, or outer-scroll jump.
- Vertical panning and deceleration feel native at minimum, default, intermediate, and maximum zoom.
- Hour labels, grid, blocks, continuation edges, and current-time line remain aligned throughout the interaction.
- One-second time ticks, bootstrap refreshes, and entry updates do not recreate the native view or reset useful zoom/scroll state.
- Day/week navigation and active/completed/review entry taps preserve current behaviour and do not duplicate mutations.
- TypeScript bridge tests, Swift tests, mobile tests/typecheck, repo lint/typecheck/tests/build, brand assets, full iOS native build, `git diff --check`, and TestFlight preflight are recorded accurately.
- Physical-device screen recording and light/dark screenshots are reviewed before the PR is declared ready. If the first SwiftUI implementation still feels clanky, iterate on the native scroll/zoom ownership rather than accepting code-level evidence alone.

## Automated validation

Recorded on 2026-07-16:

- `npx pod-install` from `apps/mobile`: passed; `DayframeCalendar (0.1.0)` autolinked. The repository-root invocation does not detect the nested Expo app, so the successful exact command was run from the app workspace.
- `npm run typecheck -w @dayframe/mobile`: passed.
- `npm run test -w @dayframe/mobile`: passed, 20 files and 168 tests.
- `swift test --package-path apps/mobile/modules/dayframe-calendar`: passed, 9 XCTest cases. Coverage includes clamp bounds, stationary/moving focal anchoring, top/bottom offset clamps, no release normalization, update/day state, stable IDs, cross-midnight metrics, and compact/tiny thresholds.
- `npm run ios -w @dayframe/mobile`: passed and installed on the iPhone 17 simulator. The final build reported the existing duplicate `-lc++` linker warning and no errors.
- `npm run lint`: passed.
- `npm run typecheck`: passed for mobile, web, and shared workspaces.
- `npm run test`: passed: mobile 168, web 138, shared 56.
- `npm run build`: passed; the Next.js production build completed.
- `npm run check:brand-assets`: passed.
- `git diff --check`: passed on the final working tree.
- `npm run testflight:preflight`: blocked before archive/export. Xcode, bundle metadata, and CocoaPods sandbox checks pass, but this machine lacks the Apple Distribution identity, the Dayframe App Store provisioning profile, and `.codex-dayframe-qa/testflight/appstoreconnect/appstoreconnect.env`.

## Simulator evidence

- Ran the installed native build against the existing authenticated development session and real seeded entries. Confirmed selected-day totals, active/completed blocks, a cross-midnight continuation, day selection, horizontal week navigation, vertical scrolling, native pull-to-refresh wiring, and a completed block opening the existing React Native editor without saving changes.
- Accessibility inspection exposed useful week-day selected states, the timeline scroll hint, and semantic entry editor destinations. Maximum simulator Dynamic Type initially exposed oversized spatial labels; the native layout was corrected with an adaptive summary header and bounded dense chart labels while preserving full VoiceOver descriptions.
- Before React Native Calendar captures remain outside git at `/tmp/dayframe-history-motion-audit/02-before-calendar.png` (light) and `/tmp/dayframe-history-motion-audit/09-after-calendar-dark.png` (dark).
- After native captures remain outside git at `/tmp/dayframe-native-calendar-qa/system-light.png`, `/tmp/dayframe-native-calendar-qa/dark.png`, `/tmp/dayframe-native-calendar-qa/system-dark.png`, and `/tmp/dayframe-native-calendar-qa/dynamic-type-max.png`.
- System, explicit Light, and explicit Dark rendering were exercised. The simulator and app appearance/content-size preferences were restored to their original Light/large settings after QA.

## Remaining risks and release state

- No physical iPhone was available in this environment. Simulator screenshots and deterministic pinch math do not prove multi-touch feel, frame pacing, deceleration quality, moving-midpoint behaviour, or the absence of hitches under real touch input.
- Repeated pinch-in/out at minimum/default/intermediate/maximum density, pinch near both day boundaries, active and review taps, one-second updates, Reduce Motion, Reduce Transparency, and Xcode Animation Hitches/Core Animation instrumentation remain physical-device acceptance work.
- No archive, upload, or TestFlight build was attempted because preflight failed on local signing/profile/API credentials. TestFlight remains at `0.1.0 (46)` for this investigation.
- Keep the implementation PR in draft until physical-iPhone Calendar parity and smoothness are genuinely accepted. Do not merge or mark the tracker item Done from simulator/build evidence alone.
