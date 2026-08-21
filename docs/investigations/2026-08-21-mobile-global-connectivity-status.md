# Mobile Global Connectivity Status

Date: 2026-08-21
Baseline: `origin/main` at `2b732d20b4aec50f113529adeffdcfc81b979bb4` (merged PR #183)
Implementation branch: `codex/pr184-global-connectivity-status`
Status: physical-iPhone follow-up corrections implemented and locally verified; exact-SHA re-review, hosted checks, and fresh physical evidence pending

## Problem And Boundary

Dayframe's durable general-event, explicit Stop, Review, Location Evidence, Location Intelligence and native hand-off owners already preserve work through transport loss, but iOS had no single user-facing connectivity truth or dependency-ordered reconnect prompt. Individual failure copy could explain stale Review data, while users had no persistent cross-route indication that the phone was offline. Lifecycle owners could also resume independently after foregrounding without one reconnect epoch expressing the timer-start/Stop correlation order.

This change adds informational transport state and reconnect orchestration only. It does not add a server health monitor, ping endpoint, repeating poll, queue/storage redesign, background task, analytics event, HealthKit algorithm change, Location Intelligence algorithm change, timer/Live Activity redesign, or offline support for complex Location Evidence actions.

## State And Ownership

- `connectivityState.ts` is a pure transport/recovery presentation machine with 300 ms offline confirmation, 400 ms native-online confirmation, a two-second successful-recovery notice and a 500 ms transport-refresh cooldown.
- Offline requires explicit native evidence. Ambiguous native state preserves the last confirmed state. Initial unknown-to-online creates neither a status strip nor a reconnect epoch.
- Only confirmed offline-to-online increments the monotonic epoch. Reachability alone leaves recovery presentation idle; the authenticated recovery coordinator must explicitly report start and final outcome. Current Dayframe HTTP responses confirm transport immediately, while a request generation captured before newer confirmed offline evidence cannot reverse that state.
- Caller cancellation, `AbortError`, request deadline, stale-session rejection, HTTP status and application error do not set offline. A genuine fetch/native transport rejection requests a coalesced NetInfo refresh; native truth decides the result.
- `connectivityMonitor.ts` owns one reference-safe native listener and no account data. The root provider refreshes it on foreground without blocking the first render. A platform-neutral evidence bridge keeps the normal API/test boundary from importing the native module.
- `ConnectivityStatusStrip` is a passive, icon-free, one-line, 36-point in-flow component. Each active screen and native React `Modal` host places it below its own header so navigation/sheet actions, content, keyboard, native tabs and the home indicator remain unobscured. Visual hosts are hidden from accessibility; one nonvisual root owner makes the transition announcement.
- Connectivity is memory-only. No SSID, BSSID, IP, carrier, cell generation, account identifier, token, activity text, category, location, route point or request body is collected or logged.

Durable stores remain authoritative. The strip never clears pending work and `isOffline` is not used to disable Start, Stop, Review terminal actions, cached evidence navigation or another offline-capable action. Known offline is used only to avoid a doomed immediate timer request or redundant cached-dashboard refresh before writing/retaining the same durable work.

## Motion Contract

- Trigger: confirmed offline inserts the persistent strip; recovery-owner start changes it to syncing; final complete/incomplete outcome changes it in place to success/failure; only matched success expiry removes it.
- Single owner: `ConnectivityStatusStrip` owns its Reanimated presence and local layout transition. The process monitor owns status identity and success expiry; screens, lists, sheets, keyboard and native tabs do not add competing animations.
- Entrance/update/exit: presence is a short opacity transition; wording updates in the existing fixed geometry; insertion/removal uses the established local layout transition with no spring, bounce or scale.
- Layout: every visual host is in normal flow below its active header, with 36-point normal geometry and `pointerEvents="none"`; surrounding content yields that space instead of being covered. The same dimensions apply to offline, syncing, success and failure.
- Interruption: confirmed offline immediately supersedes recovery and invalidates matched success expiry. Background interruption retains the epoch for one ordered foreground resume; sign-out/account replacement invalidates the old owner and clears its status. A newer epoch or late durable-work revision prevents stale completion from dismissing/replacing newer state. Rapid native candidates retain the existing bounded confirmation.
- Async outcome: `Back online, syncing…` exists only while a pass runs. `All changes synced` requires the last serialized pass to return `completed` after all applicable owners plus a throwing final bootstrap; typed failures or remaining durable work produce persistent `Some changes haven’t synced`.
- Reduce Motion: the existing Dayframe helper removes layout travel and uses immediate/opacity-only presence. Status, two-second success duration and the one root VoiceOver announcement remain unchanged.

## Reconnect Order

One active authenticated coordinator handles each newer epoch serially and retains only the latest epoch received during an in-flight pass. A durable timer Start that arrives after an epoch passed the activity queue may request one additional same-epoch serialized pass; duplicate requests still share the active promise and no passes run in parallel:

1. deliver explicit timer Stops that already have canonical targets;
2. drain native Shortcut and general `activity_events`, preserving optimistic timer-start correlation;
3. deliver explicit Stops again after correlation;
4. drain the Review mutation outbox with its existing shared promise and receipt IDs;
5. resume Location Intelligence native drain, processing, upload and replay through its existing coalescing/account guards;
6. request one silent bootstrap to reconcile timer, Review/category/cache and Live Activity presentation.

The pass rechecks authentication, active app state and confirmed online state between steps. Authentication preserves the existing signed-out transition. A background interruption retains the epoch and resumes the complete order once foreground execution is available; sign-out invalidates that account-owned continuation. Transport loss waits for a newer confirmed reconnect. An independent application/permanent error is recorded, later owners may continue where safe, and the final pass result remains failed so success cannot appear. Reconnect itself does not import HealthKit; already queued Health events remain part of the general queue.

### PR review correction

Review of `fa4a7091be68f4253139d3678624244aa152731b` found two recovery-boundary defects; no approval or physical-test gate carries forward from that SHA.

- The general activity queue now retains one shared in-flight promise. A reconnect that overlaps a foreground/background drain awaits the existing result and its optimistic-start canonical-ID correlation before running the second explicit Stop pass.
- Review `retryable_failure` and Location `request_failed` / `replay_failed` results are converted into typed reconnect `transport_failure` outcomes. Later owners and bootstrap do not run after those returned failures; each durable owner retains its queued work for a later transport epoch.
- Behavioural coverage holds an existing queue drain open while reconnect begins, proves the queued start is correlated before exactly one Stop delivery, and proves returned Review and Location failures stop the pass without relying on thrown exceptions.

These corrections change no dependency, native binary input, API/database contract, queue format, status presentation, motion contract or reconnect ordering.

### Physical iPhone follow-up correction

Physical iPhone 11 testing of `35b45be1bcef8428579791fdd6d3ba593b111f33` found two separate blockers; no earlier approval or device result carries forward.

- The absolute two-line banner covered the running-entry sheet's Done action and consumed about twice the requested height. Root/modal overlay ownership is replaced by the shared in-flow strip described above, including date-picker/menu/modal hosts and a single nonvisual VoiceOver announcer.
- An offline timer Start could remain local after reconnect. A same-account cached Dashboard was usable while dashboard auth stayed `checking`; the reconnect effect treated that transient state like sign-out and marked the epoch ignored. Separately, a request begun around the network transition could finish timing out and enqueue its optimistic Start after the first recovery pass had already read an empty activity queue. The correction promotes cached operation to authenticated only after a current SecureStore session snapshot, reserves `ignore` for real signed-out/account transitions, queues a Start immediately when offline is already confirmed, and requests a coalesced same-epoch rerun when fallback becomes durable after reconnect began.
- Behavioural coverage follows `offline -> optimistic Start -> reconnect -> initially empty drain -> late durable enqueue -> same-epoch drain -> /api/events canonical ID -> final bootstrap convergence`. It also retains shared-drain Start/Stop ordering, duplicate-epoch coalescing, background interruption/foreground resume and account-owner invalidation.
- General queue, post-correlation Stop, Review and Location results now surface remaining/application work as an incomplete recovery. A final bootstrap must actually finish or throw; it cannot be treated as complete while another refresh/mutation owns it.

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
| Focused connectivity/state/recovery/presentation contracts | PASS: 4 files / 52 tests on the physical-follow-up implementation; the new late-queued Start test failed against `35b45be1bcef8428579791fdd6d3ba593b111f33` before the fix |
| Mobile typecheck | PASS: `npm run typecheck --workspace @dayframe/mobile` |
| Complete mobile suite | PASS: 81 files / 791 tests on the physical-follow-up implementation |
| `npx expo install --check` | EXPECTED FAIL: the unchanged repository baseline is one Expo patch behind the current recommendation for `expo`, `expo-linking`, `expo-location`, `expo-modules-core`, `expo-router` and `expo-task-manager`. This drift predates the follow-up and was not expanded into PR #184; no dependency manifest changed and NetInfo remains linked. |
| CocoaPods sync and lockfile review | PASS: `npx pod-install`; 115 dependencies / 114 installed pods. NetInfo 12.0.1 was autolinked and the physical-follow-up pass produced no lockfile or native-project change. |
| Review SQLite validator | PASS: `npm run validate:review-sync-sqlite` |
| Location V2 SQLite validator | PASS: `npm run validate:location-v2-sqlite` |
| Full repository lint/typecheck/test | PASS on the physical-follow-up implementation: lint has two pre-existing web-test warnings and no errors; mobile 81 files / 791 tests; web 122 passed and 1 skipped file, 836 passed and 1 skipped test; shared 12 files / 156 tests |
| Full repository production build | PASS on the physical-follow-up implementation: `npm run build` |
| Documentation, brand and whitespace checks | PASS locally before commit: `npm run check:docs` (118 Markdown files), `npm run check:brand-assets`, and `git diff --check`; exact-SHA hosted documentation/diff checks remain pending until push |
| Clean unsigned iOS Simulator build with fresh Derived Data | PASS: `xcodebuild` Debug `clean build` against the installed iOS 26.5 `Dayframe Sheet QA SE` Simulator with `ONLY_ACTIVE_ARCH=YES` and `CODE_SIGNING_ALLOWED=NO`; the app, Live Activity extension, HealthKit, Location modules and linked NetInfo compiled. Only existing dependency/compiler/script warnings were emitted. |
| Corrected-SHA GitHub and Vercel Preview checks | NOT RUN until the commit is pushed; stable staging promotion is intentionally out of scope |
| Signed EAS `preview` build | NOT RUN |
| Physical-iPhone matrix and measured timings | NOT RUN |

Update this table only with commands actually run. Hosted, signed and device evidence remains `NOT RUN` until the exact final commit is exercised in that lane.

## Documentation Impact

This is product behaviour, runtime ownership, mobile-native dependency, visible UI/motion and regression policy. The PR therefore updates the PRD, architecture, delivery tracker, regression checklist, validation matrix, stable agent guardrail and the stale offline Review reference. Hosting/auth topology and API/database contracts are unchanged; the existing staging and release runbooks remain authoritative without edits.

## Known Limitations And Rollout

- NetInfo reports transport reachability, not Dayframe server health; an HTTP response of any status proves transport but not successful application work.
- iOS does not guarantee background execution after explicit force-quit. Durable owners retry when the app can run again.
- Native React `Modal` surfaces require their own in-flow visual host because the root accessibility announcer is nonvisual and below their native layer.
- Exact notice timing and flapping quality require a physical iPhone and real Wi-Fi/cellular transitions.

Rollout requires a Ready PR Preview backed by staging Supabase, manual promotion to `dayframe-staging.vercel.app`, a signed EAS `preview` build, and the complete physical matrix before merge. Production and TestFlight remain untouched during PR validation.

## Rollback

Revert the root provider/announcer, in-flow strip hosts, reconnect effects/coordinator, HTTP evidence integration, NetInfo dependency and Pod changes. No user-data migration or cleanup is required. Do not clear the general event queue, timer Stop outbox, Review outbox/cache, Location Evidence journal/cache or native hand-off storage. After rollback, PR #183's Review-specific stale messages and existing lifecycle retry triggers remain the safe fallback.
