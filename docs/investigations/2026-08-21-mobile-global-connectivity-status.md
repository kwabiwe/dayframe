# Mobile Global Connectivity Status

Date: 2026-08-21
Baseline: `origin/main` at `2b732d20b4aec50f113529adeffdcfc81b979bb4` (merged PR #183)
Implementation branch: `codex/pr184-global-connectivity-status`
Status: architectural repair implemented locally; final automated gates, exact-SHA independent review and physical evidence pending

## Problem And Boundary

Physical iPhone 11 testing of reviewed PR head `25604e5001c2d5278a959e06994fe42263434280` showed that connectivity presentation and durable mobile truth had been coupled to one reconnect-pass verdict. Offline indication could lag, the duplicated banner covered sheet controls, pull-to-refresh could replace optimistic state with server truth, persisted Edit/Delete had no offline outbox, an offline Start could disappear or fail to reach the server, and stale presentation could remain after out-of-band convergence.

The repair keeps NetInfo as transport evidence and durable domain owners as authority. It adds no server endpoint, database/Supabase migration, environment variable, analytics payload, HealthKit algorithm or Location Intelligence algorithm. Connectivity never replaces a queue or disables an offline-capable action.

## State And Ownership

- `connectivityState.ts` remains the pure transport machine. Native offline confirms after 300 ms and native online after 400 ms. Initial online produces no reconnect epoch or presentation.
- Any current HTTP response is strong online evidence. Intentional caller cancellation and stale-session rejection are neutral. A request deadline or repeated genuine transport failures within four seconds provide negative evidence; one isolated failure does not.
- `connectivityMonitor.ts` owns one reference-safe NetInfo listener, bounded reachability timeouts and timestamped development/staging diagnostics for raw native state, HTTP evidence, debounce lifecycle, committed state and reconnect epoch. Logs contain no token, activity text, category, location or request payload.
- `mobileAccount.ts` owns the active mobile user/workspace identity. General events, ID correlations, explicit Stops, time-entry commands, Review, Location and native hand-off counts are filtered before projection or delivery.
- `durableWorkMonitor.ts` subscribes to the active account plus all recovery-owned stores. Pending count includes general/native activity, explicit Stops, time-entry Edit/Delete, Review and Location/native-signal work. Retry wait remains pending; permanently rejected work leaves the global count and remains available to targeted diagnostics.
- `ConnectivityRecoveryOwner.tsx` is the one account/workspace retry owner. It wakes for new durable work, confirmed online, foreground and scheduled retry; pauses offline; supersedes obsolete retry timers on newer reconnect epochs; and shares every in-flight drain.
- `ConnectivityStatusOverlay` is mounted once in `app/_layout.tsx`, after the main stack in visual order. Its 32-point fully rounded pill uses 16-point gutters and `top = safeArea.top + 4`, reserves no layout, accepts no touches and is absent from all screens, sheets, menus and pickers. Native sheets cover it.

## Presentation Contract

- Confirmed offline: amber `Offline`, persistent.
- Confirmed online with account-owned pending work: `Syncing…`, persistent even during retry backoff or an out-of-band drain.
- Pending count changes from non-zero to zero while online: green `Online` for approximately two seconds, then hidden.
- Ordinary startup or settled online with no pending transition: hidden.
- Permanent rejection: no generic permanent connectivity message; use the owning queue's targeted diagnostics/action path.

The visual pill is hidden from accessibility traversal. Its root owner calls `AccessibilityInfo.announceForAccessibility` once per distinct visible transition and resets identity after the pill hides, so a later repeated Offline transition is announced. Large Dynamic Type stays one line within fixed geometry. Reduce Motion uses short opacity-only presence; normal motion fades and travels a short distance from/to the top.

## Durable Local Projection

`projectDurableLocalWork(serverBootstrap, durableCommands, correlations)` is the only Dashboard merge rule. It orders and layers:

1. queued offline timer Starts;
2. dependent or persisted time-entry Edits;
3. explicit pending Stops;
4. dependent or persisted Deletes;
5. local optimistic-ID to canonical server-ID correlations.

A server bootstrap cannot erase unresolved local work. A correlation replaces, rather than duplicates, the optimistic Start. A wholly offline Start → Edit → Stop projects as one completed entry with final values. Held Delete commands project immediately during Undo. Normal bootstrap, reconnect bootstrap, pull-to-refresh and cold cached restoration all use the same function.

The Dashboard cache stores the last successful server snapshot. Offline truth is reconstructed by composing current commands over that snapshot after relaunch, avoiding competing mutable cache representations.

## Offline Edit/Delete And Timer Start

- Timer Start is written to the account-owned general event queue before optimistic presentation, online or offline. `/api/events` uses the stable local ID as `clientEventId`; a successful response records the canonical timer ID before queue removal.
- Existing-entry and optimistic-Start Edit commands are durable before projection and sheet dismissal. Direct delivery has an eight-second deadline; retryable timeout/transport/5xx preserves the command and projection.
- Delete is durable before optimistic removal. Its command carries a short delivery hold for the existing five-second Undo lifecycle. Undo removes the durable command; expiry/commit releases it. Force-quit during the window retains the user's deletion and later delivery.
- Explicit Stop remains a separate persist-before-dismiss outbox. All callers use the same account-keyed in-flight drain. Ready Stops run before activity, then dependent Stops run again after Start correlation.
- Permanent validation/rejection is classified separately and is not retried indefinitely or represented as generic connectivity failure.

## Reconnect Order And Retry

One pass checks active app, confirmed online state and account identity between steps:

1. deliver explicit Stops with canonical targets;
2. drain the account-owned native Shortcut hand-off and general `activity_events` queue;
3. deliver time-entry Edit/Delete commands after Start correlation is available;
4. deliver explicit Stops again after correlation;
5. drain Review mutations for the same account;
6. resume same-account Location native drain, processing, upload and replay;
7. fetch/cache one server bootstrap, project any work still durable, and publish it to the Dashboard.

Retryable transport/application failure schedules jittered exponential backoff without requiring another network toggle. A newer reconnect epoch cancels the obsolete timer and runs promptly. Confirmed offline pauses timers and delivery; foreground refreshes native/durable counts. A newly created command wakes the coordinator even at reconnect epoch zero. HealthKit is not imported merely because transport changes.

## Motion Contract

- Trigger: confirmed offline or a live pending-count change selects the pill state; pending reaching zero starts the bounded Online expiry.
- Single owner: the root overlay owns entrance/exit; it never animates surrounding layout.
- Entrance/exit: normal motion uses short top fade/travel; Reduce Motion uses restrained opacity only. State updates retain identical geometry.
- Interruption: Offline immediately supersedes Syncing/Online; new work cancels the Online notice; account replacement resets presentation; rapid render repeats do not duplicate VoiceOver announcements.
- Async rollback: retryable failure retains Syncing because work remains; permanent outcomes leave the global pill and remain with their durable owner.

## Dependency And Native Impact

- PR #184 already adds `@react-native-community/netinfo` `12.0.1`; no further package or Pod dependency is added by this repair.
- The native Shortcut catalog/event payload now includes non-secret user/workspace IDs so pending App Intent/Live Activity hand-off events are counted and drained only by their owner. Legacy unscoped events are quarantined rather than guessed into the current account.
- Pending native Location signals and scoped native Shortcut events contribute to the live durable-work count.
- Swift input changed, so a clean unsigned iOS Simulator build is required. No server, API, schema, hosted configuration or deployment change is required.

## Regression Focus

Highest-risk behavior remains timer Start/Stop correlation and exactly-once delivery, Live Activities, offline Review replay, Location Evidence cache/outbox, Location Intelligence, HealthKit isolation, account/session switching, native tabs, sheets/keyboard, swipe-back, accessibility and Wi-Fi/cellular handover. Pull-to-refresh and cold offline relaunch must preserve projected local truth.

The authoritative commands and physical matrix are in `.codex/reference/validation-matrix.md`. Unit and Simulator evidence cannot establish real radio timing, blackholed-network behavior, VoiceOver delivery or physical sheet/native-tab stacking.

## Validation Evidence

Update this table only with commands actually run for the final exact SHA.

| Check | Result |
| --- | --- |
| Focused connectivity, projection, retry, outbox and timer recovery suites | PASS: 13 files / 250 tests |
| Complete mobile suite | PASS: 84 files / 812 tests |
| Mobile typecheck | PASS as part of the repository workspace typecheck |
| Repository lint/typecheck/test/build | PASS: lint (two pre-existing web-test warnings), all workspace typechecks, mobile 812/812, web 836/836 with one skipped, shared 156/156, and the production Next.js build |
| Review SQLite validator | PASS |
| Location V2 SQLite validator | PASS |
| Expo dependency check / CocoaPods | Baseline Expo patch drift remains: `npx expo install --check` recommends six SDK-compatible patch updates; `npx pod-install` PASS with 115 dependencies / 114 pods and NetInfo linked; no lockfile or Xcode-project churn |
| Documentation/brand/iOS-config/diff checks | PASS: 118 Markdown files, brand assets, iOS configuration and `git diff --check` |
| Clean unsigned iOS Simulator build | PASS: fresh Derived Data, Debug, iOS 26.5 `Dayframe Sheet QA SE`, `CODE_SIGNING_ALLOWED=NO`; dependency warnings only, no launch or install |
| Exact-SHA GitHub/Vercel Preview checks | NOT RUN until pushed |
| Signed staging build / physical iPhone matrix | NOT RUN; requires explicit next-stage approval after independent re-review |

## Known Limitations And Rollout

- NetInfo reports transport reachability, not Dayframe server health; an HTTP status proves a response path, not application success.
- iOS does not guarantee execution after force-quit. Durable work restores and retries when the app can run again.
- Exact offline latency, blackholed-connection deadlines, native sheet stacking and VoiceOver timing require the physical iPhone matrix.

PR #184 stays draft. The final pushed SHA requires independent diff review and green hosted checks before any staging promotion, signed build or further physical testing. Production and TestFlight remain untouched.

## Rollback

Revert the root overlay/recovery owner, durable-work monitor, projection/time-entry outbox, HTTP evidence changes and scoped native hand-off fields together. Do not clear the general event queue, explicit Stop outbox, time-entry outbox, Review outbox/cache, Location journal/cache or native hand-off storage. No server or database rollback is required.
