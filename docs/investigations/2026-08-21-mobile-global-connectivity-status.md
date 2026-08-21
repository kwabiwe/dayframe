# Mobile Global Connectivity Status

Date: 2026-08-21
Baseline: `origin/main` at `2b732d20b4aec50f113529adeffdcfc81b979bb4` (merged PR #183)
Implementation branch: `codex/pr184-global-connectivity-status`
Status: implementation and repository validation complete; no hosted, signed-build, or physical-iPhone evidence yet

## Problem And Boundary

Dayframe's durable general-event, explicit Stop, Review, Location Evidence, Location Intelligence and native hand-off owners already preserve work through transport loss, but iOS had no single user-facing connectivity truth or dependency-ordered reconnect prompt. Individual failure copy could explain stale Review data, while users had no persistent cross-route indication that the phone was offline. Lifecycle owners could also resume independently after foregrounding without one reconnect epoch expressing the timer-start/Stop correlation order.

This change adds informational transport state and reconnect orchestration only. It does not add a server health monitor, ping endpoint, repeating poll, queue/storage redesign, background task, analytics event, HealthKit algorithm change, Location Intelligence algorithm change, timer/Live Activity redesign, or offline support for complex Location Evidence actions.

## State And Ownership

- `connectivityState.ts` is a pure `unknown | online | offline` machine with 300 ms offline confirmation, 600 ms native-online confirmation, a 2.5-second reconnect notice and a 500 ms transport-refresh cooldown.
- Offline requires explicit native evidence. Ambiguous native state preserves the last confirmed state. Initial unknown-to-online creates neither a green notice nor a reconnect epoch.
- Only confirmed offline-to-online increments the monotonic epoch and notice ID. Current Dayframe HTTP responses confirm transport immediately; a request generation captured before newer confirmed offline evidence cannot reverse that state.
- Caller cancellation, `AbortError`, request deadline, stale-session rejection, HTTP status and application error do not set offline. A genuine fetch/native transport rejection requests a coalesced NetInfo refresh; native truth decides the result.
- `connectivityMonitor.ts` owns one reference-safe native listener and no account data. The root provider refreshes it on foreground without blocking the first render. A platform-neutral evidence bridge keeps the normal API/test boundary from importing the native module.
- The banner is a passive absolute overlay. Root navigation owns the only accessibility announcement; the four existing React Native Modal hosts mirror the same state/notice ID with announcements suppressed because native modals occupy a separate presentation layer.
- Connectivity is memory-only. No SSID, BSSID, IP, carrier, cell generation, account identifier, token, activity text, category, location, route point or request body is collected or logged.

Durable stores remain authoritative. The banner never clears pending work and `isOffline` is not used to disable Start, Stop, Review terminal actions, cached evidence navigation or another offline-capable action.

## Motion Contract

- Trigger: a committed offline state inserts the persistent notice; a committed offline-to-online transition replaces it with the temporary restored notice; matched notice expiry removes only that restored notice.
- Single owner: `ConnectivityBanner` owns its Reanimated presence. Navigation, native tabs, screens, lists, sheets and keyboard do not animate or re-layout for this state.
- Entrance/update/exit: opacity plus the existing small `rise` translation; no spring, bounce, scale or surrounding layout animation. The monotonic view-model key distinguishes transitions.
- Layout: the host is absolute below the safe-area inset with 12-point gutters, bounded width and `pointerEvents="none"`; content and native tab geometry do not move.
- Interruption: confirmed offline immediately supersedes a green notice and invalidates its matched dismissal timer. Rapid candidates are debounced by the state owner; stale candidate, request and notice identities cannot commit.
- Async rollback/failure: there is no optimistic visual claim to roll back. The green copy says only `Checking saved changes`; a recovery failure cannot falsely claim successful sync and existing feature diagnostics remain authoritative.
- Reduce Motion: the existing Dayframe helper makes presence immediate or opacity-only. Status, duration and the one root VoiceOver announcement remain unchanged.

## Reconnect Order

One active authenticated coordinator handles each newer epoch at most once and retains only the latest epoch received during an in-flight pass:

1. deliver explicit timer Stops that already have canonical targets;
2. drain native Shortcut and general `activity_events`, preserving optimistic timer-start correlation;
3. deliver explicit Stops again after correlation;
4. drain the Review mutation outbox with its existing shared promise and receipt IDs;
5. resume Location Intelligence native drain, processing, upload and replay through its existing coalescing/account guards;
6. request one silent bootstrap to reconcile timer, Review/category/cache and Live Activity presentation.

The pass rechecks authentication, active app state and confirmed online state between steps. Authentication preserves the existing signed-out transition. Transport interruption stops quietly; an independent application/permanent error is safely classified and later owners may continue. Reconnect itself does not import HealthKit; already queued Health events remain part of the general queue.

## Dependency And Native Impact

- Added `@react-native-community/netinfo` `12.0.1` through Expo's installer.
- CocoaPods must be synchronised and `Podfile.lock` reviewed.
- A new native iOS binary is required.
- No server code, API route, database migration, Supabase migration or environment variable is added.
- The repository's existing Expo/React Native/TypeScript versions remain unchanged.

## Regression Focus

Focused coverage protects transition identity, native-listener lifetime, refresh coalescing, HTTP evidence/session semantics, reconnect serialization/order, root/modal presentation ownership, Review cache copy, and Location Evidence warm revalidation. The complete mobile and repository suites plus the Review/Location SQLite validators and clean native build remain the repository gate.

Physical staging must explicitly re-check timer Stop durability, Live Activities, Review cache/outbox, Location Evidence cache/cancellation, HealthKit, Location Intelligence, account/session switching, native tabs, sheets/keyboard, stack navigation/swipe-back, Dynamic Type, VoiceOver, Reduce Motion and Reduce Transparency. The authoritative 50-item `PASS | FAIL | NOT RUN` matrix is in `.codex/reference/validation-matrix.md`; Simulator evidence cannot replace it.

## Validation Evidence

| Check | Result |
| --- | --- |
| Focused connectivity/transport/recovery/Review contracts | PASS: 6 files / 52 tests on the final implementation |
| Mobile typecheck | PASS: `npm run typecheck --workspace @dayframe/mobile` |
| Complete mobile suite | PASS: 81 files / 777 tests |
| `npx expo install --check` | EXPECTED FAIL: the baseline pins `expo` 56.0.19, `expo-linking` 56.0.16, `expo-location` 56.0.23, `expo-modules-core` 56.0.23, `expo-router` 56.2.18 and `expo-task-manager` 56.0.25 one patch below Expo's current recommendations. These pre-existing mismatches were recorded and not changed. NetInfo itself is compatible. |
| CocoaPods sync and lockfile review | PASS: `npx pod-install`; 115 dependencies / 114 installed pods. NetInfo 12.0.1 was autolinked. CocoaPods regenerated three unchanged-version React Native binary checksums in addition to adding NetInfo. |
| Review SQLite validator | PASS: `npm run validate:review-sync-sqlite` |
| Location V2 SQLite validator | PASS: `npm run validate:location-v2-sqlite` |
| Full repository lint/typecheck/test | PASS: mobile 81 files / 777 tests; web 122 passed and 1 skipped file, 836 passed and 1 skipped test; shared 12 files / 156 tests |
| Full repository production build | PASS: `npm run build` |
| Documentation, brand and whitespace checks | PASS: `npm run check:docs` (118 Markdown files), `npm run check:brand-assets`, and `git diff --check` |
| Clean unsigned iOS Simulator build with fresh Derived Data | PASS: `xcodebuild` Debug against the installed `Dayframe Sheet QA SE` Simulator with `ONLY_ACTIVE_ARCH=YES` and `CODE_SIGNING_ALLOWED=NO`; both clean and build succeeded. Only dependency/compiler warnings were emitted. A preceding generic dual-architecture run exhausted the host's disk while producing pod archives; its temporary Derived Data and the earlier successful build's temporary Derived Data were removed, 13 GiB was recovered, and the single installed-Simulator rerun completed from a fresh directory. |
| Exact Vercel Preview and stable staging alias | NOT RUN |
| Signed EAS `preview` build | NOT RUN |
| Physical-iPhone matrix and measured timings | NOT RUN |

Update this table only with commands actually run. Hosted, signed and device evidence remains `NOT RUN` until the exact final commit is exercised in that lane.

## Documentation Impact

This is product behaviour, runtime ownership, mobile-native dependency, visible UI/motion and regression policy. The PR therefore updates the PRD, architecture, delivery tracker, regression checklist, validation matrix, stable agent guardrail and the stale offline Review reference. Hosting/auth topology and API/database contracts are unchanged; the existing staging and release runbooks remain authoritative without edits.

## Known Limitations And Rollout

- NetInfo reports transport reachability, not Dayframe server health; an HTTP response of any status proves transport but not successful application work.
- iOS does not guarantee background execution after explicit force-quit. Durable owners retry when the app can run again.
- Native React `Modal` surfaces require silent presentation mirrors because the root overlay is below their native layer.
- Exact notice timing and flapping quality require a physical iPhone and real Wi-Fi/cellular transitions.

Rollout requires a Ready PR Preview backed by staging Supabase, manual promotion to `dayframe-staging.vercel.app`, a signed EAS `preview` build, and the complete physical matrix before merge. Production and TestFlight remain untouched during PR validation.

## Rollback

Revert the root provider/banner and modal mirrors, reconnect effects/coordinator, HTTP evidence integration, NetInfo dependency and Pod changes. No user-data migration or cleanup is required. Do not clear the general event queue, timer Stop outbox, Review outbox/cache, Location Evidence journal/cache or native hand-off storage. After rollback, PR #183's Review-specific stale messages and existing lifecycle retry triggers remain the safe fallback.
