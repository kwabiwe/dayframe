# Live Activity and edit-sheet keyboard regressions

## Report

- Starting a timer from Today no longer reliably creates the Live Activity on the Lock Screen or Dynamic Island.
- Focusing the running-entry start-time field leaves the field row partially behind the iOS keyboard.
- Reported from TestFlight build `0.1.0 (62)` on 2026-07-22.

## Root causes

### Live Activity

The dashboard deliberately calls Live Activity reconciliation without awaiting it. The optimistic timer flow introduced after the original Live Activity implementation changes one user start into multiple React states: idle, an optimistic active entry, then the same entry with its persisted server ID. Each state could enter the native controller concurrently. ActivityKit `start` first ends existing activities, so an older reconciliation could finish after a newer one and dismiss the newly created activity. The existing tests awaited every reconciliation sequentially and did not exercise this ordering.

The fix gives reconciliation one owner, serializes native operations, and keeps processing until the latest requested entry is represented. Stale completions can no longer become the cached synced state.

### Start-time keyboard avoidance

The sheet correctly measures and lifts itself above the keyboard, but the form ScrollView did not reveal the focused start-time control after the viewport became shorter. The row could therefore remain at the old scroll position with its lower portion on the keyboard boundary. The fix retains the current keyboard-coupled sheet animation and scrolls the form to reveal the complete start-time group when that field is focused or the keyboard frame changes.

## Motion contract

- Trigger: focus the start-time input or change the iOS keyboard frame.
- Owner: the existing React Native sheet and its form ScrollView.
- Update: the sheet follows the native keyboard animation; the ScrollView reveals the complete start-time group.
- Interruption: repeated keyboard frames reveal against the latest frame.
- Async outcome: none.
- Accessibility: Reduce Motion keeps the state change but removes animated scrolling; the focused input remains mounted.

## Validation

- Unit regression: overlapping idle/optimistic/persisted Live Activity requests.
- Existing Live Activity retry and deduplication coverage.
- Mobile TypeScript check.
- Signed physical-iPhone development build and launch succeeded on KB's iPhone 17 Pro.
- PR #91 merged to `main` as `84a0bfc` after GitHub checks passed.
- TestFlight build `0.1.0 (63)` was archived from merged `main` with production API `https://dayframe-web.vercel.app`, exported, and uploaded with delivery/build ID `f0f3683b-c37c-4b2e-b457-906f129712cf`.
- App Store Connect reports `VALID`, export compliance false, en-GB notes set, all-build access through `Internal Health Debug`, and `IN_BETA_TESTING`.
- KB explicitly skipped the pre-release physical interaction check. Dynamic Island, Lock Screen, and exact keyboard placement remain `Watch` items for build 63.
