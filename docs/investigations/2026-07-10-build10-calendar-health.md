# Build 10 Calendar Tap Crash And Health Auto-Sync

## Symptoms

- TestFlight build 10 crashes when tapping a completed calendar event.
- Apple Health sleep/workout data only appears after manual sync from Settings.
- Calendar pinch zoom changes density but does not stay anchored around the user's fingers.
- Calendar should always show 24-hour time, without Awake/24h mode controls.
- The current-time line should not render a time label over the left hour axis.

## Findings

- The calendar edit sheet used an early `if (!entry) return null` before a later `useMemo`. Opening a calendar event changes `entry` from `null` to a value, causing React to render a different hook order.
- HealthKit import was only triggered by Settings `syncAppleHealth()`. The app had the HealthKit background-delivery entitlement, but the tracked AppDelegate did not register the native `BackgroundDeliveryManager` on launch.
- The calendar zoom scaled `hourHeight` from the top of the axis only. It did not adjust the parent scroll offset using the pinch midpoint.

## Fix

- Keep all edit-sheet hooks before conditional return so opening a calendar entry preserves hook order.
- Enable HealthKit background delivery when Health permissions are granted, subscribe to sleep/workout observer changes when automatic Health sync is enabled, and quietly import/sync/reprocess on observer callbacks and app foreground.
- Register HealthKit's `BackgroundDeliveryManager` from AppDelegate for cold-launch HealthKit delivery without importing the Nitro-backed Swift module into the app target.
- Make mobile Calendar a fixed 24-hour view, remove mode chips, remove the current-time label, and anchor zoom around the pinch midpoint by adjusting the parent scroll position.

## Verification

- `npm run typecheck -w @dayframe/mobile`
- `npm run test -w @dayframe/mobile -- --run src/lib/health.test.ts src/lib/calendarGestures.test.ts`
- `npm run lint`
- `npm run test -w @dayframe/mobile`
- `npm run typecheck --workspaces --if-present`
- `npm run test --workspaces --if-present`
- `npm run build -w @dayframe/web`
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -quiet -workspace apps/mobile/ios/Dayframe.xcworkspace -scheme Dayframe -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' build`
