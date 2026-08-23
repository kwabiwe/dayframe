# Mobile Global Connectivity Status

Date: 2026-08-21
Baseline: `origin/main` at `2b732d20b4aec50f113529adeffdcfc81b979bb4` (merged PR #183)
Implementation branch: `codex/pr184-global-connectivity-status`
Status: architectural repair, local automated gates and hosted checks complete; exact-SHA independent review and physical evidence pending

## Problem And Boundary

Physical iPhone 11 testing of reviewed PR head `25604e5001c2d5278a959e06994fe42263434280` showed that connectivity presentation and durable mobile truth had been coupled to one reconnect-pass verdict. Offline indication could lag, the duplicated banner covered sheet controls, pull-to-refresh could replace optimistic state with server truth, persisted Edit/Delete had no offline outbox, an offline Start could disappear or fail to reach the server, and stale presentation could remain after out-of-band convergence.

The repair keeps NetInfo as transport evidence and durable domain owners as authority. It adds no server endpoint, database/Supabase migration, environment variable, analytics payload, HealthKit algorithm or Location Intelligence algorithm. Connectivity never replaces a queue or disables an offline-capable action.

## State And Ownership

- `connectivityState.ts` remains the pure transport machine. Native offline confirms after 300 ms and native online after 400 ms. Initial online produces no reconnect epoch or presentation.
- Any current-generation HTTP response is strong online evidence. Intentional caller cancellation and stale-session rejection are neutral. A current-generation request deadline or repeated genuine transport failures within four seconds provide negative evidence; one isolated failure does not. Success and failure evidence from an older offline/reconnect request generation is ignored before it can clear or add failure history.
- `connectivityMonitor.ts` owns one reference-safe NetInfo listener, bounded reachability timeouts and timestamped development/staging diagnostics for raw native state, HTTP evidence, debounce lifecycle, committed state and reconnect epoch. Raw deduplication rejects unchanged native evidence even when it disagrees with an HTTP-forced committed state: repeated positive reachability cannot manufacture Offline → Online reconnect epochs, reset backoff or cause request storms. A real native transition follows the normal debounce and a current-generation HTTP response remains immediate positive evidence. Logs contain no token, activity text, category, location or request payload.
- `mobileAccount.ts` owns the active mobile user/workspace identity. The bearer and its server-verified user/workspace are persisted atomically in one SecureStore envelope; queue delivery requires that bound owner to match the active durable owner. A legacy unbound token can perform only the bootstrap that verifies and binds it, and cannot project cached account data or replay commands beforehand. General events, ID correlations, explicit Stops, time-entry commands, Review, Location and native hand-off counts are filtered before projection or delivery.
- `durableWorkMonitor.ts` subscribes to the active account plus all recovery-owned stores. Pending count includes general/native activity, explicit Stops, time-entry Edit/Delete, Review and Location/native-signal work. Retry wait remains pending; permanently rejected work leaves the global count and remains available to targeted diagnostics.
- `ConnectivityRecoveryOwner.tsx` is the one account/workspace retry owner. It wakes for new durable work, confirmed online, foreground and scheduled retry; a real reconnect or foreground transition runs the ordered pass even when pending count is zero, while ordinary epoch-zero initial-online startup remains quiet. It pauses delivery for native Offline, but HTTP-forced Offline retains the same bounded retry epoch so a restored backend can provide current positive evidence without a NetInfo-manufactured reconnect. It supersedes obsolete retry timers on genuine newer reconnect epochs, retries zero-count transport failures and shares every in-flight drain.
- `ConnectivityStatusProvider` is mounted once in `app/_layout.tsx`. It subscribes to connectivity and account-owned durable work, derives presentation, owns the approximately two-second settled expiry, and issues one VoiceOver announcement per distinct visible transition. `ConnectivityStatusIndicator` consumes that root state in a fixed 44-point slot immediately after the shared Dayframe wordmark on Today, Calendar, and Reports; inactive eager tab routes are hidden from accessibility. Settings, sheets, menus and pickers contain no duplicate.

## Presentation Contract

- Confirmed offline: neutral cloud-slash, persistent.
- Confirmed online with account-owned pending work: neutral circular sync arrows, persistent even during retry backoff or an out-of-band drain.
- Pending count changes from non-zero to zero while online: neutral cloud-check for approximately two seconds, then the slot becomes visually empty.
- Ordinary startup or settled online with no pending transition: the fixed slot remains visually empty, preserving header geometry.
- Permanent timer Stop or time-entry Edit/Delete rejection: persistent neutral cloud-X that opens Settings > Sync & diagnostics for owned plain-language Retry/Discard actions. Confirmed offline remains the one-slot visual priority; when permanent attention exists, its cloud-slash remains accessible as the same diagnostics action and identifies the attention in its label. The cloud-X returns after reconnect.

On the focused tab, the icon is one manually revisitable labelled accessibility element; cloud-X is a labelled button with a diagnostics hint, while native symbol children are excluded from duplicate traversal. The root provider calls `AccessibilityInfo.announceForAccessibility` once per distinct visible transition and resets identity after the slot becomes empty, so a later repeated Offline transition is announced. The 26-point glyphs use crisp SF Symbols, a lighter neutral (`borderStrong` in Light and `textSecondary` in Dark), and non-colour shapes that retain contrast in both themes. Their optical base is aligned with the Dayframe wordmark without moving the fixed 44-point slot. The system sync-arrows-over-cloud symbol rotates subtly during normal motion and remains static with Reduce Motion; state presence uses restrained opacity without moving layout. The next presentation is calculated without mutation during render, used immediately so sync arrows change in place to cloud-check, and committed afterward; a discarded render cannot consume the two-second state.

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
- Permanent validation/not-found rejection is classified separately and is not retried indefinitely or represented as generic connectivity failure. It stops affecting projection, a guarded bootstrap restores canonical server truth, and Settings > Sync & diagnostics exposes account-owned Retry/Discard actions. Malformed time-entry outbox bytes are retained in bounded local quarantine rather than silently treated as empty; recoverable owner fields scope diagnostics and clearing to that account, while irrecoverably ownerless corruption is labelled and cleared separately as device-wide. Quarantine content is never logged or projected.

## Reconnect Order And Retry

One pass checks active app, confirmed online state and account identity between steps:

1. deliver explicit Stops with canonical targets;
2. drain the account-owned native Shortcut hand-off and general `activity_events` queue;
3. deliver time-entry Edit/Delete commands after Start correlation is available;
4. deliver explicit Stops again after correlation;
5. drain Review mutations for the same account;
6. resume same-account Location native drain, processing, upload and replay; batch selection, request dispatch, replay and every response-side SQLite mutation pin the captured location owner and authenticated-session generation, so an A → B switch interrupts the stale pass without selecting or mutating B evidence;
7. fetch/cache one server bootstrap, project any work still durable, and publish it through the Dashboard's mutation-revision and pending-deletion guard. A Stop/Edit that overlaps the fetch queues a fresh projected load instead of accepting the recovered snapshot; a failed publication emits an explicit abandonment event so its captured guard is released.

Retryable transport/application failure schedules jittered exponential backoff without requiring another network toggle, including when a zero-pending reconnect/foreground pass fails in Location or bootstrap. Retry due requests a forced pass rather than pretending that durable work just arrived, so the attempt keeps increasing while the same work remains and resets only after work clears or a genuine reconnect/new-work epoch arrives. A successful forced pass with no remaining work clears any previously scheduled retry. A newer genuine reconnect epoch cancels the obsolete timer and runs promptly. Native Offline pauses timers and delivery; HTTP-forced Offline keeps bounded probes alive while suppressing unchanged positive NetInfo samples, and foreground requests one ordered probe for an authenticated account. A newly created command wakes the coordinator even at reconnect epoch zero. HealthKit is not imported merely because transport changes.

## Motion Contract

- Trigger: confirmed offline, live pending-count change, or permanent time-entry attention selects the one-slot icon; pending reaching zero starts the bounded cloud-check expiry.
- Single owner: the root provider owns state and announcements; the fixed header slot owns visual entrance/exit and never animates surrounding layout.
- Entrance/exit: state presence uses restrained opacity. Sync arrows rotate subtly in normal motion and remain static with Reduce Motion. State updates retain identical geometry.
- Interruption: cloud-slash immediately supersedes sync arrows/cloud-check/cloud-X; new work cancels the cloud-check; account replacement resets presentation; rapid render repeats do not duplicate VoiceOver announcements.
- Async rollback: retryable failure retains sync arrows because work remains; permanent timer Stop and time-entry Edit/Delete outcomes exit the pending count, restore server projection, and expose cloud-X plus their durable diagnostics. While offline, the same one-slot cloud-slash keeps visual connectivity priority but remains the diagnostics action and announces the attention. The existing Settings local-presence/layout primitive owns diagnostics-row entrance, Retry/Discard removal and surrounding reflow; Reduce Motion uses its restrained fallback and neither action moves focus programmatically.

## Dependency And Native Impact

- PR #184 already adds `@react-native-community/netinfo` `12.0.1`. This repair adds only the matching test-only `react-test-renderer` `19.2.3` development dependency for behavioural Retry/Discard coverage; it adds no runtime mobile or Pod dependency.
- Clean-checkout reproduction from the frozen base confirms the NetInfo package/pod entries. React Native 0.85's generated podspec JSON embeds the checkout-specific absolute Hermes CLI and local prebuilt-artifact paths, so clean installs at different paths produce different checksums for `hermes-engine`, `React-Core-prebuilt` and `ReactNativeDependencies` despite identical versions and artifacts. Those path-derived hashes are local noise rather than NetInfo transitive changes and are restored to the frozen-base values before commit; the accepted full-PR `Podfile.lock` delta is NetInfo-only.
- The native Shortcut catalog/event payload now includes non-secret user/workspace IDs so pending App Intent/Live Activity hand-off events are counted and drained only by their owner. Legacy unscoped events are quarantined rather than guessed into the current account.
- Pending native Location signals and scoped native Shortcut events contribute to the live durable-work count.
- Swift input changed, so a clean unsigned iOS Simulator build is required. No server, API, schema, hosted configuration or deployment change is required.

## Regression Focus

Highest-risk behavior remains timer Start/Stop correlation and exactly-once delivery, Live Activities, offline Review replay, Location Evidence cache/outbox, Location Intelligence, HealthKit isolation, account/session switching, native tabs, sheets/keyboard, swipe-back, accessibility and Wi-Fi/cellular handover. Pull-to-refresh and cold offline relaunch must preserve projected local truth.

The authoritative commands and physical matrix are in `.codex/reference/validation-matrix.md`. Unit and Simulator evidence cannot establish real radio timing, blackholed-network behavior, VoiceOver delivery or physical sheet/native-tab stacking.

## Validation Evidence

The evidence below was recorded for reviewed head `a093b99aa4628c648658e9469b11f71198dd67ef`. Update or replace it only with commands actually run for a later exact SHA; working-tree UI-adjustment checks are reported separately until committed.

| Check | Result |
| --- | --- |
| Focused account-ownership, reconnect, connectivity-evidence and outbox suites | PASS: 6 files / 140 tests |
| Complete mobile suite | PASS: 86 files / 844 tests |
| Mobile typecheck | PASS as part of the repository workspace typecheck |
| Repository lint/typecheck/test/build | PASS: lint (two pre-existing web-test warnings), all workspace typechecks, mobile 844/844, web 836/836 with one skipped, shared 156/156, and the production Next.js build |
| Review SQLite validator | PASS |
| Location V2 SQLite validator | PASS |
| Expo dependency check / CocoaPods | Baseline Expo patch drift remains: `npx expo install --check` recommends six SDK-compatible patch updates; clean-base `npm ci`, NetInfo install and two repeat `npx pod-install` runs PASS with 115 dependencies / 114 pods. NetInfo entries reproduce. Diffing generated podspec JSON proves the three React Native prebuilt checksum differences come only from checkout-specific absolute Hermes CLI and local artifact paths; those three hashes are restored to the frozen-base values so the committed full-PR lock delta is NetInfo-only |
| Documentation/brand/iOS-config/diff checks | PASS: 118 Markdown files, brand assets, iOS configuration and `git diff --check` |
| Clean unsigned iOS Simulator build | PASS: fresh Derived Data at `/tmp/dayframe-pr184-final-owner-ios.NHmCse`, Debug, iOS Simulator 26.5 `Dayframe Sheet QA SE`, `CODE_SIGNING_ALLOWED=NO`; dependency warnings only, no launch or install |
| Exact-SHA GitHub/Vercel Preview checks | PASS: documentation alignment, Vercel Preview and Preview comments on the pushed repair head; the final documentation-only evidence commit must repeat these checks |
| Signed staging build / physical iPhone matrix | NOT RUN; requires explicit next-stage approval after independent re-review |

The bounded blocker repair committed with this record adds no dependency, pod,
native source, server, schema or hosted change. Its local evidence is:

| Repair check | Result |
| --- | --- |
| Focused recovery/monitor/Stop projection, diagnostics, presentation and API suites | PASS: 8 files / 220 tests |
| Complete mobile suite | PASS: 86 files / 858 tests |
| Mobile and full workspace typecheck | PASS |
| Repository lint | PASS: documentation and iOS configuration checks plus web ESLint; two pre-existing web-test unused-parameter warnings, zero errors |
| Documentation, brand, Review SQLite, Location V2 SQLite and diff checks | PASS: 118 Markdown files, brand assets, Review SQLite, Location V2 SQLite and `git diff --check` |
| Staging promotion, device build/install and physical-iPhone matrix | NOT RUN; explicitly outside this bounded repair |

The follow-up blocker repair adds the test-only `react-test-renderer` development
dependency described above, but no runtime mobile, Pod, server, schema or hosted
change. Its local evidence is:

| Follow-up repair check | Result |
| --- | --- |
| Focused monitor/recovery/presentation/Settings diagnostics tests | PASS: 6 files / 64 tests, including repeated unchanged NetInfo evidence after HTTP-forced Offline, bounded backend recovery without a native toggle, native-negative pause, stale forced-retry cancellation, offline diagnostics access, combined attention copy, and behavioural Retry/Discard actions |
| Complete mobile suite | PASS: 88 files / 864 tests |
| Mobile and full workspace typecheck | PASS |
| Repository lint and production build | PASS: documentation and iOS configuration checks plus web ESLint (two pre-existing unused-parameter warnings, zero errors), and production Next.js build |
| SQLite validators and diff check | PASS: Review SQLite, Location V2 SQLite, and `git diff --check` |
| Full web test context | The category-picker DOM file passes alone and the full web suite passes serially. The default parallel web suite reproducibly has one unrelated `categoryPicker.dom.test.tsx` portal-timing failure; no web code changed in this repair. |
| Staging promotion, device build/install and physical-iPhone matrix | NOT RUN; explicitly outside this bounded repair |

## Known Limitations And Rollout

- NetInfo reports transport reachability, not Dayframe server health; an HTTP status proves a response path, not application success.
- iOS does not guarantee execution after force-quit. Durable work restores and retries when the app can run again.
- Exact offline latency, blackholed-connection deadlines, native sheet stacking and VoiceOver timing require the physical iPhone matrix.

PR #184 stays draft. The final pushed SHA requires independent diff review and green hosted checks before any staging promotion, signed build or further physical testing. Production and TestFlight remain untouched.

## Rollback

Revert the root presentation provider/header indicator and recovery owner, durable-work monitor, projection/time-entry outbox, HTTP evidence changes and scoped native hand-off fields together. Do not clear the general event queue, explicit Stop outbox, time-entry outbox, Review outbox/cache, Location journal/cache or native hand-off storage. No server or database rollback is required.
