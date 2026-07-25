# Mobile sheet gestures and automatic logging categories

Date: 2026-07-25

## Report

The Edit entry sheet and other mobile cards show a drag handle but did not
consistently follow a downward swipe or dismiss. Confirmed commute suggestions
also retained placeholder copy such as `Possible journey`, and automatic
logging settings did not prepare their conventional categories at enable time.

## Implementation

- `SwipeDismissSheet` is the single React Native owner for direct
  manipulation. Edit entry/Edit timer, learned-place detail, and location
  information sheets use it.
- Only the dedicated 44-point drag handle owns the pan responder. Scroll views,
  text fields, keyboards, date pickers and form controls remain independent.
- Downward movement follows the finger. A 96-point distance or a downward
  velocity of 0.85 after initial travel dismisses; an incomplete or interrupted
  drag returns to zero.
- Tapping the existing backdrop still dismisses.
- Commute confirmation and direct auto-creation write a null description, while
  the Review card may retain explanatory suggestion copy before confirmation.
- Enabling sleep, workout or commute automatic logging calls one authenticated,
  workspace-scoped endpoint that ensures `Sleep`, `Health`, or `Commute`.
  Case-insensitive lookup plus a transaction-scoped advisory lock prevents
  duplicates under concurrent enable requests.

## Motion contract

- Trigger: downward drag beginning on the visible sheet handle.
- Owner: `SwipeDismissSheet`; no parent scroll view or second animation layer
  transforms the sheet.
- Entrance: the existing React Native Modal slide remains unchanged.
- Update: `translateY` tracks positive finger movement in real time.
- Exit: threshold/velocity success animates to the viewport bottom, then invokes
  the existing dismissal callback.
- Surrounding layout: not applicable; the sheet overlays the screen.
- Interruption: cancellation/termination settles to zero; sheet-owned blocking
  confirmations and pickers disable the gesture.
- Async outcome: not applicable to the gesture. Existing form mutations retain
  their current optimistic/error behaviour.
- Accessibility: Reduce Motion dismisses or restores immediately. The handle is
  a 44-point adjustable accessibility target; existing close and backdrop
  actions remain available. Physical VoiceOver, Dynamic Type and Reduce Motion
  checks remain required before release.

## Validation

Passed locally:

- focused shared-sheet contract tests
- focused web event-service tests
- all 803 unit tests
- all workspace typechecks
- lint
- optimized web production build
- brand asset contract
- `git diff --check`

Still required:

- physical-iPhone direct-manipulation recording and threshold/cancellation checks
- form scrolling, text fields, keyboard, date picker, backdrop, VoiceOver,
  Dynamic Type, Reduce Motion and rapid-repeat checks
- provider-auth Preview/production endpoint verification

The initial iOS Simulator attempts stopped in ExpoSQLite with unresolved
`exsqlite3_*` symbols. The checked-in Podfile lock and installed CocoaPods
sandbox were out of sync, and the earlier DerivedData cache retained that
inconsistent native module state. Running `pod install`, then rebuilding with
isolated DerivedData, resolved the failure without an ExpoSQLite source change.
The full arm64 iOS Simulator build and signed Release archive both passed.

## TestFlight evidence

- PR #118 merged to `main` as `cb43983`.
- TestFlight `0.1.0 (67)` was archived from merged `main` with production API
  base `https://dayframe-web.vercel.app`.
- Delivery/build ID: `cc8acc89-0580-483e-978a-8e4aaec00ba7`.
- App Store Connect reports `processingState=VALID`,
  `usesNonExemptEncryption=false`, en-GB notes set, and
  `internalBuildState=IN_BETA_TESTING`.
- Internal group: `Internal Health Debug` with all-build access.
- Physical-iPhone acceptance remains open, so the feature stays on Watch.
