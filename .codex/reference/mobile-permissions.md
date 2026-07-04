# Mobile Permission Guidelines

Use this when changing iOS onboarding, Settings, geofencing, Apple Health, or mobile dashboard behavior.

## Placement

- Location and Apple Health permission controls belong in onboarding and Settings.
- Do not put permission cards on the main dashboard.
- The dashboard should focus on logo/header, active timer, start task, quick category actions, and Today summary.
- Logout belongs under profile/account management, not as primary dashboard chrome.

## Location State

Expo Location permission responses include:

- `status`: `undetermined`, `granted`, or `denied`
- `granted`
- `canAskAgain`
- `expires`
- iOS `scope`: `whenInUse`, `always`, or `none`
- iOS `accuracy`: `full` or `reduced`

Represent foreground and background permission separately. Do not collapse a foreground grant plus background denial into a generic "denied" state.

Recommended product states:

- checking
- unavailable
- promptable foreground
- foreground granted
- promptable background
- always granted
- denied but askable
- denied and needs Settings
- reduced accuracy

Request foreground location first. Explain background/Always access before requesting it. If `canAskAgain` is false, provide an Open Settings action.

## Apple Health State

Apple Health requires a native iOS build and real-device validation. Expo Go and many simulator paths cannot fully exercise it.

Use friendly states for:

- unavailable/native build required
- permission not determined or promptable
- permission requested
- denied or restricted
- ready to sync
- synced with count and timestamp
- sync failed with actionable copy

Do not surface raw native errors such as `Authorization not determined` in alerts. Convert native errors into user-friendly messages and next actions.

Sleep and workout permissions may be requested from onboarding or Settings. Imports should continue to queue event-first payloads and should not include route/location-like metadata.
