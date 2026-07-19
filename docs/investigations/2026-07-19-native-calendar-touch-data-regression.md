# Native Calendar touch and data regression

Date: 2026-07-19
Reported build: internal TestFlight `0.1.0 (57)`
Baseline commit: `2bd012b` (`main`, release evidence after PR #84)
Branch: `agent/calendar-touch-data-regression`

## Reported physical-iPhone symptoms

- Tapping a weekday in the native week strip does not change the selected day.
- Horizontal swipes on the Calendar timeline do not navigate between days.
- Horizontal swipes on the week strip do not navigate between weeks.
- Calendar renders `0m` and `No tracked time for this day` while the screenshot's Dayframe Live Activity indicates an active timer.

The screenshot shows Sunday 19 selected and the heading `Today`, so it does not itself prove a mismatched selected-day key. The failed taps/swipes prove that the user cannot visibly change that state. The Live Activity is evidence of a recently active timer, but it is not sufficient by itself to prove the current bootstrap response contains that active entry; Live Activity and bootstrap reconciliation must be checked independently.

## Shipped-state and documentation audit

- PR #84 changed Calendar presentation only from `Image(systemName: "tag")` to `tag.fill`; it did not change native callbacks, the hosting controller, selected-day React state, bootstrap loading, or entry serialization.
- The native view/hosting/event implementation remains the version introduced by PR #72/build 47. Its physical-device acceptance remained `Watch`; simulator evidence had covered taps/navigation, but no physical iPhone was available in that implementation session.
- PR #79 expanded Calendar entry inputs to refreshed `historyEntries`/`dayEntries`; PRs #82-#84 added tag serialization/presentation without changing gesture ownership.
- The repository had stale current-state documentation: the tracker verification snapshot still named PR #82 as the local baseline despite builds 56/57; PRD readiness lines still named builds 47/48; production readiness still named build 47; the Tags investigation still described the superseded outline icon.
- Trello also lagged shipped state: reusable Tags and configurable goals remained in `Future / Later`, and recent Categories, Calendar refresh, and Today swipe work had no current cards.

## Current ownership path

1. SwiftUI owns weekday buttons and the week-strip drag gesture.
2. The native timeline `UIScrollView` owns vertical scroll/pinch and has a native horizontal pan recognizer for day changes.
3. `DayframeCalendarExpoView` converts those semantic actions into Expo `EventDispatcher` events.
4. `DayframeDashboard` receives the event, updates `selectedDayKey`, rebuilds `NativeCalendarPresentation`, and passes a new `model` prop to the native view.
5. `DayframeCalendarViewModel.update` publishes the new presentation without recreating the hosting controller.
6. Entries are built independently from `activeEntry`, `historyEntries`, `entries`, `weekEntries`, and `dayEntries`, filtered by overlap with the selected local day.

## Hypotheses before implementation

### H1 — Native actions are not reaching React

This best explains the three touch symptoms sharing one boundary even though weekday taps, week-strip drag, and timeline pan use different Swift gesture primitives.

- Prove with native action counters/logs plus React callback counters: Swift records the gesture but React does not receive the Expo event.
- Disprove if React callback counters increment and `selectedDayKey` changes.
- Likely failure area: Expo native-view event delivery or native hosting/hit-test containment, not the individual gesture thresholds.

### H2 — Actions reach React, but React-to-native model updates are stale

This explains interactions that execute without any visible state change and can also explain a Calendar that remains at an earlier empty presentation after timer/bootstrap updates.

- Prove if React callback/selected-day state changes while the native model's selected key, entry count, and revision do not.
- Disprove if the native model receives each new revision and publishes it.
- Likely failure area: typed model-prop update delivery or retained native-view lifecycle under unstable native tabs.

### H3 — Bootstrap/entry data is absent or rejected independently

This explains `0m` but cannot explain inert weekday buttons and week swipes.

- Prove by comparing bounded bootstrap diagnostics (active-entry presence, collection counts, selected-day overlap count) with the serialized native entry count.
- Disprove if the bridge serializes the active/recent entries while native still shows zero.
- Production DB inspection was not claimed: Vercel correctly returns `[SENSITIVE]` for the production `DATABASE_URL` in a local environment pull. No data-loss conclusion is justified without authenticated diagnostics or a bounded export.

## Root-cause boundary established before code

The regression is not one broken swipe recognizer. Weekday buttons, SwiftUI week drag, UIKit timeline pan, and entry refresh all converge on the retained native Calendar bridge/model. The screenshot is consistent with either a dead native-to-React event boundary, a stale React-to-native model boundary, or both; missing bootstrap data may coexist but cannot be the cause of all interaction failures. Implementation must instrument and test both directions before changing gesture thresholds or entry filtering.

The existing automated contract checks source strings, serialization helpers, and zoom math, but does not execute a native event round-trip or assert that a retained Expo view publishes later model revisions. That gap allowed a Calendar binary to archive successfully without proving the physical interaction/data contract.

## Documentation and Trello reconciliation completed before implementation

- Updated the repo tracker/current-state documents to build 57 and added this regression as `In progress`.
- Updated the stale Tags icon wording.
- Trello `Dayframe Project` now moves reusable Tags to `Watch / Verify`, goals/report ranges and Web Today parity to `Done`, and adds current cards for this regression, Categories keyboard/palette, Calendar refresh/Today actions, and Today swipe-to-delete.

## Fix constraints and closure criteria

- Do not reintroduce a competing React gesture owner around the native Calendar.
- Preserve React ownership of authenticated data, mutations, selected-day state, and edit/review routing.
- Preserve the retained native view and zoom/scroll state across ordinary model refreshes.
- Add executable coverage for native action dispatch and later model revisions, not source-string assertions alone.
- Verify on the physical iPhone: weekday tap, timeline previous/next-day swipe, week-strip previous/next-week swipe, active timer visibility/ticking total, completed entry visibility/tap, refresh, vertical pan, pinch, and tab-away/tab-back.
- A screenshot or successful archive alone cannot close this regression.
