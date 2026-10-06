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

## Account consent and capture lifetime

OS Location permission and Dayframe account consent are separate. Consent is keyed by backend/workspace/user; a new account defaults off. Existing device-wide consent migrates only when the persisted Location binding matches the hydrated active account. Otherwise discard it and request explicit opt-in. Settings and diagnostics expose only the active owner's places and consent.

Explicit logout warns about deleting local unsynchronised Location evidence and clears the captured owner's local stores/caches even without a binding. Fence bootstrap and capture for the entire logout; reject storage/OS cleanup failures instead of claiming success. A delayed A logout cannot touch B or a newer A session. A definitive 401/revocation stops capture but retains accepted evidence only for its original owner. Journal rows have seven-day expiry; raw upload copies, including acknowledged copies, and engine/account/segment context do not share that expiry. Login/upload do not purge them. Explicit logout removes these local stores; Delete recent evidence removes local journal/outbox/engine state, leaving account/segment context. Bounded expiry/deletion of those retained copies remains a separate privacy/storage follow-up.

Network failure, Keychain unavailability, suspension and same-owner refresh are not sign-out. Cold/headless capture hydrates the persisted owner before deciding there is no owner. Opt-out invalidates callbacks/registrations and retains a disabled context for accepted work; re-enable creates a fresh capture lifetime without resetting a valid same-owner/backend semantic cutover. Catalogue refresh never grants consent; tasks/starts/SQLite commits require the current scoped preference. Settings status must distinguish OS access, account consent and active monitors. Validate the real configure-then-refresh/opt-out race, no-binding logout, newer A reauthentication, delayed native/Expo callbacks, A→B→A and cold activation before hydration.

Persist an already authorised owner's off decision in the lifecycle lane even if logout/401 supersedes its capture work. A later authorised on decision in that lane wins. Failed persistence rejects the toggle and keeps capture disabled through bootstrap until explicit retry; do not claim off was saved. Once off is durable, local-step failure must still attempt monitoring teardown, and disabled/off callbacks or bootstrap reconcile it. OS failures remain reported/counted; neither a process kill nor failed OS call proves immediate monitoring removal. Fence the real bootstrap activation caller through final logout account-removal I/O, including legacy tokens, while allowing a genuine newer A or B session.

After a logout attempt definitively fails, release only its active request gate so fresh valid-session Dashboard/Settings reads work. Keep unresolved Location cleanup/admission fenced, including after legacy owner binding. Never revalidate a previously invalidated bootstrap when that transient gate releases.

The Location switch represents saved account consent. Adjacent status separately reports effective active/inactive capture or pending logout cleanup; iOS permission and saved true alone cannot establish working capture. Reuse the existing Settings action for explicit current-owner Retry capture when activation is inactive. Refresh effective diagnostics after activation failure, keep actual consent, and recheck generation/consent after OS awaits before returning success. Later off, logout, 401 or replacement lifetime wins over stale completion.

## Geofence Runtime Guardrails

- Keep the geofence task definition at module top level and keep `location` in the iOS background modes.
- Rehydrate saved-place monitoring after authenticated bootstrap, not only after visiting Settings or Places.
- Persist a fingerprint of the registered regions and skip unchanged `startGeofencingAsync` calls. iOS can report a region's initial state when monitoring starts, so unnecessary re-registration can look like a false enter.
- Register saved places in deterministic priority order and expose every place excluded by iOS's 20-region limit in Settings diagnostics.
- Pass the saved radius through to iOS after enforcing the product's 25-2000m bounds. Do not silently replace a user's radius with a different monitoring radius.
- Treat a recent accurate location fix as corroborating evidence, not a requirement. Reject an enter only when the fix is clearly outside the saved radius plus the conservative boundary buffer; keep exit evidence so missed transitions remain diagnosable.
- Persist privacy-safe transition evidence on device: place name, configured radius, distance/accuracy summary, outcome, and timestamp. Do not log raw coordinates or location payloads.

## Motion & Fitness State

Motion & Fitness (Core Motion) is offered in Settings > Places & Location under Location suggestions; onboarding will offer it later. Show iOS permission separately from Location consent: it is read only while Location suggestions are on, and capture needs both. States: not available (simulator, unsupported device), not requested (Allow Motion & Fitness, which shows the system prompt through a one-minute history query), allowed, off (Open iOS Settings), restricted (Open iOS Settings), and unknown. Re-read the status whenever the app returns to the foreground. Never show raw `CMAuthorizationStatus` values or native error codes. `NSMotionUsageDescription` is set in `app.json` and the checked-in `Info.plist` with Dayframe's own wording; real prompts and history need a physical iPhone.

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
