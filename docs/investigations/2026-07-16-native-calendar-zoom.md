# Native SwiftUI Calendar zoom correction

Date: 2026-07-16
Baseline: `main` after PR #71, TestFlight `0.1.0 (46)`
Planned branch: `codex/native-calendar-swiftui`

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

## Accepted architecture direction

- Keep the existing Expo/React Native app and native tab route.
- Add a standard iOS-only local Expo native-view module for the Calendar presentation surface. Export an `ExpoView`, retain one `UIHostingController`, and use typed Expo `Record` props/view events for the bridge; do not use the experimental inline-module path.
- Build the Calendar UI in SwiftUI. It may wrap a UIKit `UIScrollView` through `UIViewRepresentable` for the timeline's continuous focal-point-preserving pinch/scroll behaviour.
- Keep React Native responsible for bootstrap/authenticated data, active-timer truth, mutations, selected route state, and the existing active/completed/review sheets.
- Pass a serializable presentation model into Swift and emit semantic callbacks with stable identifiers. Swift must not call Dayframe APIs, write the offline queue, or create another timer/data store.
- Give the timeline one native gesture/scroll owner and preserve native view identity across `now` ticks and ordinary data refreshes.
- Keep this PR iOS-only and Calendar-only. A separate preview app or broader Swift migration remains future work.

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
