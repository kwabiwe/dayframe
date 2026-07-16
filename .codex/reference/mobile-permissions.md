# Mobile Permission Guidelines

Use this when changing iOS onboarding, Settings, geofencing, HealthKit, or mobile dashboard behavior.

## Placement

- Location and HealthKit permission controls belong in onboarding and Settings.
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

## Geofence Runtime Guardrails

- Keep the geofence task definition at module top level and keep `location` in the iOS background modes.
- Rehydrate saved-place monitoring after authenticated bootstrap, not only after visiting Settings or Places.
- Persist a fingerprint of the registered regions and skip unchanged `startGeofencingAsync` calls. iOS can report a region's initial state when monitoring starts, so unnecessary re-registration can look like a false enter.
- Register saved places in deterministic priority order and expose every place excluded by iOS's 20-region limit in Settings diagnostics.
- Pass the saved radius through to iOS after enforcing the product's 25-2000m bounds. Do not silently replace a user's radius with a different monitoring radius.
- Treat a recent accurate location fix as corroborating evidence, not a requirement. Reject an enter only when the fix is clearly outside the saved radius plus the conservative boundary buffer; keep exit evidence so missed transitions remain diagnosable.
- Persist privacy-safe transition evidence on device: place name, configured radius, distance/accuracy summary, outcome, and timestamp. Do not log raw coordinates or location payloads.

## HealthKit State

HealthKit requires a native iOS build and real-device validation. Expo Go and many simulator paths cannot fully exercise it.

Use friendly states for:

- unavailable/native build required
- permission not determined or promptable
- permission requested
- denied or restricted
- ready to sync
- synced with count and timestamp
- sync failed with actionable copy

Do not surface raw native errors such as `Authorization not determined` in alerts. Convert native errors into user-friendly messages and next actions.

Sleep and workout permissions may be requested from onboarding or Settings. Imports should continue to queue event-first payloads and should not include route/location-like HealthKit metadata.
