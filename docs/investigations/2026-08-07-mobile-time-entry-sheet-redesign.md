# Mobile time-entry sheet redesign

Date: 2026-08-07
Baseline commit: `5b93914f4c4e9001acf94b49823f913684abde8a` (`origin/main`)
Branch: `codex/mobile-sheet-redesign`
Status: draft PR open; implementation frozen and source validation passed; required Simulator keyboard acceptance remains failed

## Scope and governing contract

This investigation records the baseline, source map, motion ownership and validation contract for the mobile time-entry sheet redesign. The attached execution plan is authoritative where it conflicts with older repository notes.

The work is limited to the shared iOS time-entry editor and its caller/mutation support:

- running timer editing;
- completed-entry editing;
- Add past time;
- Review editing;
- genuine historical suggestion search and selection;
- direct sheet deletion followed by a five-second Undo window;
- presentation, keyboard, swipe, date-picker and interruption correctness.

No production configuration, deployment, database migration, provider-auth contract, merge or TestFlight action is in scope. One backwards-compatible event-ingest response refinement is part of the timer identity fix: an idempotent replay of a queued timer start now returns the canonical entry ID created by the original event. The mobile client needs that correlation to target a later update, Stop or Delete safely; no route, request schema, authentication or database contract is replaced.

## Baseline provenance

- `origin/main` was fetched and resolved to `5b93914f4c4e9001acf94b49823f913684abde8a`.
- No relevant open pull request was found before the branch was created.
- The focused worktree was created from that SHA and was tracked-clean before investigation.
- The feature tracker contains older commit-state language that does not match the fetched `origin/main`; this note uses the actual Git ref as the baseline.
- The supplied plan had no accompanying screenshots or recordings in its directory. Exact visual geometry therefore must be established from Simulator evidence, not reconstructed from an absent reference.

The untracked evidence root is:

```text
.codex-dayframe-qa/mobile-sheet-redesign/
  baseline/
  after/
  recordings/
  logs/
```

Generated evidence stays untracked and contains no credentials, account data, HealthKit payloads, precise location data or production screenshots.

## Read-only investigator report

The investigator changed no tracked files and reported a clean worktree at the baseline SHA.

### Caller and opening map

At the baseline commit there were four shared-editor call sites:

| Journey | Caller | Mode | Baseline opening contract |
| --- | --- | --- | --- |
| Blank Play / existing active timer | Dashboard | running | One boolean controls both journeys; no explicit opening reason or focus intent. |
| Completed entry | Dashboard Today and Calendar | entry | The selected completed entry becomes the edit target. |
| Add past time | Dashboard Today and Calendar | add | A local draft is created; Plus redirects to the running editor when a timer is active. |
| Review editing | Review screen | entry | Review-item drafts use a handover callback and request accessibility focus; review-needed completed entries use normal editing. |

Blank Play follows the existing canonical path:

```text
startTask
  -> startTaskWith
  -> synchronously publish one optimistic bare active entry
  -> enqueue persisted start or offline event fallback
  -> open the editor on the next frame
```

Existing-active entry points open the same boolean presentation directly. Entry Description and optimistic/persisted ID currently stand in for journey intent in parts of the sheet lifecycle; they are not a safe focus discriminator.

### Focus and presentation

- Native `Modal.onShow` currently triggers accessibility focus only. It does not call the Description `TextInput` instance's `focus()` method.
- `Modal.onShow` does not prove the custom sheet entrance has reached a focus-safe point.
- The swipe sheet currently has no presentation-complete callback.
- There is no monotonic presentation generation, so delayed callbacks cannot reject work from an older open/dismiss/reopen cycle.
- The parent can set the running editor invisible as soon as optimistic deletion or Stop clears the active entry. That can unmount the Modal before the swipe sheet completes its exit.

### Historical data and current Suggestions

- Bootstrap already provides up to 2,000 `historyEntries` across roughly 59 prior days.
- Dashboard already combines history, current/day/week entries and the active entry into a deduplicated peer-entry source.
- The sheet receives only the six pre-ranked bootstrap task suggestions, so it cannot perform arbitrary substring lookup across history.
- Shared aggregation already filters for completed, confirmed, non-placeholder, minimum-duration activity and retains Description, category, tags, recency, frequency and duration.
- The existing stable comparator stops at Description. Exact metadata ties can inherit input order.
- Mobile entry DTOs do not carry every server-side provenance flag. Mobile search will therefore consume the already-authorised history DTO conservatively and will not invent recommendations.
- Applying a running suggestion currently updates Description and category but omits tags in local state and the canonical optimistic/offline patch.

### Current layout and keyboard ownership

Historical Suggestions currently render before Description inside the form `ScrollView`. Their local animation drives opacity, translation and `maxHeight`, so opening or closing the panel participates in form layout, sheet measurement and cached closed-height behaviour.

The hashtag autocomplete is already an absolute Description-local overlay. The redesign must give an active hashtag query precedence over historical results without creating two interactive floating surfaces.

Current keyboard ownership is otherwise intentionally layered:

- the outer React Native Animated layer owns keyboard lift and keyboard-constrained sheet height;
- the inner Reanimated layer owns sheet entrance, swipe, settle, exit and backdrop;
- swipe start freezes keyboard motion and queues the latest frame;
- a cancelled swipe releases the latest queued keyboard frame once.

That boundary is retained. The redesign removes Suggestions from base-layout measurement rather than assigning another owner to sheet height.

### Current delete, refresh and identity behaviour

- Today history deletion already uses a tokenised five-second coordinator and direct optimistic removal.
- A rapid second history deletion commits the first before starting a new window, and stale Undo/timeout tokens are rejected.
- The existing timer starts the Undo interval immediately; it has no prepared state, activation-after-exit contract, `expiresAt`, injected clock or foreground expiry reconciliation.
- No tombstone set filters quiet bootstrap, timer-state or list reconciliation. A refresh can therefore reintroduce an entry while deletion is still undoable.
- Optimistic active timers use local IDs and later map to persisted IDs. Offline edits update the queued start; offline delete removes the queued event.
- Persisted-ID replacement updates active/current/day/week pools but not every historical pool.
- Live Activity follows optimistic `activeEntry`; restoring an active entry would cause the existing reconciler to restore the activity.
- Starting or switching to another timer during an undoable active deletion must first commit and invalidate that deletion so two active timers cannot be produced.

## Baseline Simulator attempt

Demonstrated local tooling:

| Item | Value |
| --- | --- |
| Xcode | 26.6 (`17F113`) |
| CocoaPods | 1.16.2 |
| iOS runtime | 26.5 (`23F77`) |
| Booted device | iPhone 17e |
| Device identifier | `8D9C36E2-D7BA-43EE-89B0-2BE56CBD7459` |

The first deployment-mode CocoaPods installation stopped before build because the checked-in lockfile contained stale podspec checksums for Expo Modules Core, Hermes, the React Core prebuilt artifact and React Native dependencies. A normal installation was then run intentionally from the npm-locked dependency graph. At this baseline-capture stage its only tracked result was the four expected checksum updates; no dependency version or build-setting changed. The later, deliberately scoped SDK 56 compatibility reconciliation is recorded separately below so this baseline fact is not confused with the branch's final dependency state.

The baseline then built successfully with:

```text
xcodebuild -workspace apps/mobile/ios/Dayframe.xcworkspace -scheme Dayframe -configuration Debug -destination 'platform=iOS Simulator,id=8D9C36E2-D7BA-43EE-89B0-2BE56CBD7459' -derivedDataPath /tmp/dayframe-mobile-sheet-baseline-derived CODE_SIGNING_ALLOWED=NO clean build
```

The prior installed app, whose source and session provenance were unknown, was removed. The successful baseline product was freshly installed and launched. Because the unsigned build cannot satisfy the Keychain entitlement required by SecureStore, the authenticated dashboard route stopped at the expected development error. This is an environment constraint, not an application result.

A development-only route therefore renders the real `ActiveTimerEditSheet` with deterministic, non-sensitive fixtures for the six presentation modes. It is excluded from production behavior and is the permitted fallback from the authoritative plan. Baseline screenshots and the source-attributed blank-Play entrance recording are stored under the ignored `.codex-dayframe-qa/mobile-sheet-redesign/baseline/` evidence directory. The recording is `iphone17e-blank-play-entrance.mp4` (iPhone 17e, iOS 26.5, 1170 x 2532, 18.545 seconds, 214 captured frames).

Observed baseline facts:

- Blank Play and an existing blank active timer both opened the same six-row in-flow Suggestions state. The opening journey is not represented in component state.
- Neither blank Play nor Review produced actual Description focus or a keyboard. The existing callback moved accessibility focus only.
- Six Suggestions occupied the form above Description and pushed the field and remaining controls below the initial viewport. A described active timer produced a materially shorter sheet, confirming that Suggestions participate in sheet/form geometry.
- Existing described, completed, Add and Review fixtures opened without historical results. The screenshots establish the pre-change visual and geometric comparison set; gesture, Undo and focus-sequence claims still require final instrumentation and recordings.

Two dedicated comparison devices were created on the same iOS 26.5 runtime for final validation: iPhone SE (3rd generation) `D2D581C4-2003-4888-AFAB-32528B372EAC` and iPhone 17 Pro Max `14065E33-D874-408F-A090-891F19450322`.

## Source-grounded hypotheses

These are hypotheses until the specified measurement proves or disproves them.

| Hypothesis | Falsification method |
| --- | --- |
| In-flow panel height causes form/sheet jumps. | Compare outer sheet and Description bounds before/after opening, query update and close. The redesigned result must remain within one point. |
| Reopening an existing blank timer shows Suggestions automatically. | Open a previously existing blank active timer without touching Description and observe panel visibility. |
| Blank-start autofocus fails because accessibility focus fires before custom presentation readiness. | Record input focus and keyboard-frame events from open request through sheet entrance. |
| Running Stop/Delete bypasses coordinated exit after optimistic active removal. | Record active-entry removal, parent visibility, dismiss start and exit completion order. |
| Quiet refresh resurrects a pending deletion. | Delete, apply an older bootstrap during the Undo window and inspect every entry pool. |
| Exact ranking ties depend on input order. | Reverse a fully tied fixture and compare stable keys. |
| Old completions can affect a rapid reopen. | Open, dismiss, reopen and deliver the old focus/keyboard/exit token. |
| Tagged selection loses tags. | Select a tagged row and inspect editor state, optimistic model, queued payload and persisted patch. |

## Resolved design choices

### Presentation intent

Every open receives a monotonic presentation ID plus an explicit reason:

- blank timer started;
- existing active timer;
- completed entry;
- Add past time;
- Review edit.

Only the explicit blank-start and existing Review contracts request initial Description focus. The entry ID and Description value never determine initial focus. Optimistic-to-persisted ID replacement and bootstrap refresh do not create a new presentation.

### Historical matching and metadata variants

Search uses genuine completed peer history, excludes the current entry ID, normalises case/trim/repeated whitespace and applies deterministic tiers:

1. exact normalised Description;
2. Description prefix;
3. word prefix;
4. substring;
5. existing contextual score;
6. use count;
7. recency;
8. total duration;
9. stable key.

For an empty query, the textual tiers are omitted. Identical Description/category/tag combinations aggregate. The same Description with different category or tag metadata remains a distinct selectable variant so selection never fabricates or discards historical metadata. Stable-key comparison is the final tie-breaker, independent of input order.

Selection is converted through one allowlist and may change only:

- Description;
- category ID;
- tag names.

Dates, times, running/stopped state, entry identity, place, source, confidence, review status and unrelated draft fields are unchanged.

### Overlay coordinate space

The floating historical panel is an absolutely positioned child of a positioned sheet-level overlay layer, not a child that contributes to the form `ScrollView` layout. Description and outer-sheet rectangles are generation-aware measurements in one coordinate space. Geometry is calculated by a pure helper and capped by sheet bounds, keyboard top, safe-area inset and row limit.

The base sheet measurement is cached without historical results and is invalidated only by an explicit presentation generation or legitimate window/safe-area/Dynamic Type change. Opening, updating and closing historical results cannot recapture it.

### Deletion lifecycle

One general coordinator owns both history and sheet deletion:

```text
capture exact entry and current snapshot
  -> create prepared operation and tombstone its identity
  -> optimistically remove it
  -> request the normal sheet exit when applicable
  -> activate visible Undo only after exit completion
  -> expire at activation time + 5,000 ms
  -> commit through persisted-ID/offline canonical mutation
```

Undo removes the tombstone and restores the captured entry into the current surrounding model at its snapshot-relative position without replacing newer surrounding rows. A second deletion commits the first. Stale token callbacks are inert. Foreground reconciliation expires overdue work. Persisted-ID reconciliation adds the canonical identity as a tombstone alias while retaining the captured restore identity.

An account boundary or provider unmount deliberately disposes in-memory prepared/active work without committing or restoring it. The server copy therefore remains recoverable and can reappear on a later bootstrap for the same workspace; this is an intentional data-conservative cancellation policy that prevents a deferred write from crossing accounts. Ordinary sheet teardown never calls `dispose`: its current visual-exit callback activates the accepted deletion and its full Undo window.

## Motion contract

| Concern | Single owner |
| --- | --- |
| Modal mount/unmount | Parent presentation state; unmount only after current sheet exit completes |
| Backdrop opacity | Swipe sheet |
| Sheet entrance, drag, settle and exit translation | Swipe sheet |
| Keyboard offset and constrained height | Existing keyboard coordinator |
| Historical panel opacity/translation | Historical overlay |
| Historical panel height in form flow | No owner; it is out of flow |
| Date-picker presence | Date-picker state |
| Durable entry mutation | Existing Dashboard or Review mutation owner |
| Undo activation and expiry | General deletion coordinator |

Trigger and endpoints:

- Open starts at the caller's explicit presentation intent and ends when Modal, sheet and Description anchor readiness agree for the current token.
- Blank-start focus is requested once at that endpoint; dismissal cancels it.
- Suggestion entrance/updates/exits alter only local panel opacity/translation and result content.
- Swipe cancel returns the sheet to its presented endpoint and releases the latest queued keyboard frame once.
- Committed dismissal cannot be cancelled by a late keyboard or older presentation callback.
- Date-picker handover closes historical results and settles the keyboard before the picker becomes interactive.
- Save/Stop failure returns to the mounted editor with its draft; success uses the normal sheet exit.
- Delete uses the normal exit, then activates Undo.
- Reduce Motion reaches identical state endpoints with no travel animation; a restrained opacity transition is acceptable where the existing swipe owner provides it.

## Authoritative platform semantics checked

The inspected baseline stack was React Native 0.85.3, Expo 56.0.16, Reanimated 4.3.1 and React 19.2.3. The branch later reconciled Expo SDK 56 patch versions as described below; React Native, Reanimated and React did not change.

- Current React Native documentation defines `Modal.onShow` as notification that the native modal was shown; it does not represent completion of this app's custom inner-sheet animation.
- Current React Native Keyboard documentation supports iOS frame-change events, layout animation scheduling, metrics and programmatic dismissal. Interactive 16 ms frame events must not be re-timed into long animations.
- Current Reanimated documentation specifies cancellation and completion-callback semantics; completion from a cancelled timing/spring is not a valid current-operation success signal.
- Reanimated Reduce Motion semantics must preserve final values while removing travel.
- Apple Simulator supports deterministic screenshots and video through `simctl`; XCUIAutomation screenshots are available if a native UI test target is justified.

No installed-runtime contradiction was found. The repository's custom presentation layer requires the additional focus-ready handshake described above.

## Expo SDK 56 compatibility reconciliation

The authoritative plan contains two requirements that must be read together: do not broaden the work into an Expo/React Native/Reanimated upgrade, and require `npx expo install --check` to pass. The baseline manifest did not satisfy the latter. The check reported these seven direct dependencies below the versions expected by the installed Expo SDK 56 toolchain. The branch therefore ran Expo's own scoped `install --fix` reconciliation and accepted only its SDK-56-compatible patch lines.

| Direct dependency | Baseline manifest | Reconciled manifest/resolution |
| --- | --- | --- |
| `expo` | `~56.0.16` | `~56.0.19` |
| `expo-linking` | `~56.0.15` | `~56.0.16` |
| `expo-location` | `~56.0.21` | `~56.0.23` |
| `expo-modules-core` | `~56.0.21` | `~56.0.23` |
| `expo-router` | `~56.2.15` | `~56.2.18` |
| `expo-task-manager` | `~56.0.22` | `~56.0.25` |
| `react-native-screens` | `^4.25.2` | `~4.26.0`, resolved as 4.26.2 |

This is an Expo SDK 56 patch reconciliation, not an SDK-level upgrade. Expo remains on SDK 56; React Native remains 0.85.3; Reanimated remains 4.3.1; React remains 19.2.3. No application API, production configuration or deployment setting was changed for this reconciliation.

`apps/mobile/package.json` and the corresponding workspace portions of `package-lock.json` record the direct patch lines. Those JavaScript packages also supply the native podspecs, so the existing Pod lock could no longer truthfully remain pinned to the baseline Expo/RNScreens pod versions. Deployment mode cannot rewrite a lockfile. A targeted CocoaPods update for the corresponding Expo/RNScreens pods therefore regenerated `Podfile.lock` from the reconciled npm graph; a subsequent deployment-mode install confirmed the graph was locked consistently. No destructive prebuild was used. `Podfile.lock` changes are limited to:

- the corresponding Expo pods and Expo-internal transitives: EXConstants 56.0.23, Expo 56.0.19, ExpoAsset 56.0.22, ExpoFileSystem 56.0.9, ExpoLinking 56.0.16, ExpoLocation 56.0.23, ExpoModulesCore/Worklets/WorkletsAdapter 56.0.23, ExpoRouter 56.2.18, ExpoSymbols 56.0.7, ExpoTaskManager/ExpoUI 56.0.25;
- RNScreens and RNScreens/common 4.26.2;
- workspace-resolution paths for Expo Router's nested Expo Symbols and Expo UI packages;
- regenerated podspec checksums for those pods plus Hermes, React Core prebuilt and React Native dependencies whose declared runtime versions did not change;
- unchanged CocoaPods generator version 1.16.2.

**Confirmed by command output (development-time dependency check):** the post-fix Expo compatibility check and deployment-mode CocoaPods install succeeded. These setup results do not replace the required final, post-integration rerun recorded as pending in the final validation ledger.

## Implemented architecture and current source evidence

This section describes the integrated source at the time of this note. A final source freeze, test rerun and Simulator evidence are still required before any pass claim.

### Genuine historical search and allowlisted selection

- `buildHistoricalEntrySuggestions` searches the full peer-history input rather than the six-item bootstrap suggestion cap. It normalises text, supports exact/prefix/word-prefix/substring tiers, excludes the current entry, aggregates exact metadata duplicates, retains materially different category/tag variants and ends on a stable presentation key.
- `historicalSuggestionPatch` exposes only Description, category ID and tag names. Running selection uses the existing optimistic/offline-compatible mutation owner; completed, Add and Review modes retain their own local/save semantics.
- Invalid dates fall back to a history-derived deterministic context instead of the wall clock. Blank, placeholder, unresolved automation and unconfirmed automatic history remain ineligible; explicitly confirmed non-Health history remains eligible.
- **Demonstrated by unit test (final suite):** `packages/shared/src/historicalSuggestions.test.ts` covers empty and `bau` queries beyond the former six-row cap, case/whitespace normalisation, tier ordering, shuffle stability, metadata variants, current-entry exclusion, eligibility, invalid dates, zero/one/default limits and patch allowlisting.

### Generation-scoped sheet, focus and dismissal

- Each caller creates a monotonic presentation object with an explicit blank-start, existing-active, completed, Add or Review reason. Blank start and Review can request real Description focus; entry contents and optimistic/persisted IDs do not infer focus.
- `timeEntrySheetPresentation` models Modal, custom-sheet, input/anchor, native-focus ownership reset, focus confirmation, keyboard, Suggestions, swipe, date-picker, mutation, app-state and Reduce Motion transitions. Delayed events carry the presentation ID; older generations are ignored.
- Initial focus is eligible only after the matching Modal is shown, the custom sheet reports presented, the input and anchor are ready, and native focus ownership has reset. One named, cancellable `requestAnimationFrame` then calls the real input's `focus()` method; the blank-start caret is explicitly placed at zero. A background interruption releases an unconfirmed command so that the same presentation can retry after foregrounding, while a confirmed focus is not replayed.
- `SwipeDismissSheet` reports presentation, gesture start/cancel, dismissal start and exit completion with the captured presentation ID. Modal ownership remains with the caller until the matching exit callback. Cumulative start/cancel counts and their last presentation IDs make a missing, duplicate or cross-generation gesture callback observable in the native harness.
- The sheet exposes a generation-scoped caller dismissal request so a caller-side rollback can use the same coordinated exit path; a stale or repeated request is ignored.
- **Demonstrated by unit test (final suite):** `apps/mobile/src/lib/timeEntrySheetPresentation.test.ts` and the swipe/source contract tests cover readiness in reordered event sequences, one real focus command, background recovery, stale callbacks, rapid reopen, swipe interruption, interactive-keyboard state ordering, date-picker handover, caller dismissal and equivalent Reduce Motion endpoints.

### Sheet-local floating geometry and accessibility

- Historical results render in `HistoricalSuggestionsOverlay` as a sheet-level absolute surface, outside the form `ScrollView` flow. The Description anchor is resolved in the same sheet-local coordinate space using the live scroll offset.
- Base geometry is presentation-scoped and is invalidated only for an explicit presentation, window, safe-area or Dynamic Type change. Result count is not a geometry input. The live sheet rectangle, not the immutable cached base rectangle, constrains the overlay, and a zero-height keyboard-constrained result is treated as non-renderable rather than hiding accessible form controls behind an absent surface.
- Geometry measurement, scroll-to-end work and keyboard-height animation completions carry presentation-plus-sequence tokens. A newer frame, swipe, background transition or rapid reopen invalidates the older token. Swipe cancellation starts a fresh keyboard-height generation toward the latest authoritative inset, which prevents an interrupted animation from leaving the sheet in a permanent “animating” state.
- The overlay measures its current header and content generation while invisible, then exposes only the bounded resolved height. Query/content-key changes retain an already-visible surface until the new bounded measurement is ready; they do not produce a full-height first paint or a zero-opacity/zero-height gap. A component-lifetime continuity guard counts any same-presentation visibility drop, including a same-content geometry drop during keyboard movement.
- While renderable results obscure lower form controls, only that subtree is hidden from accessibility; Description, the result list and the committed swipe handle remain reachable. Selection announces the applied Description/category/tags, and a failed running mutation announces rollback without a false success announcement.
- **Demonstrated by unit test (final suite):** `apps/mobile/src/lib/timeEntrySheetGeometry.test.ts`, `apps/mobile/src/lib/historicalSuggestionsOverlayContinuity.test.ts`, `apps/mobile/src/lib/historicalSuggestionsAccessibility.test.ts` and sheet contract tests protect local geometry, frame/keyboard tokens, base-height invariance, first-paint/update continuity, zero-height accessibility and semantic announcements.

### Serialized queue ownership and durable timer identity

- Every offline-queue read/modify/write helper and queue sync now enters one module-level serial mutation tail. A sync cannot write an old snapshot over a concurrently accepted Stop, update or deletion, and later items retain their original order when an earlier item cannot sync.
- Timer-entry correlations use a separate serial storage tail. A successful queued timer-start replay writes the local-to-canonical mapping before removing the local event. If the server sees the same client event again, it resolves the entry created from the original activity event and returns that canonical ID, so idempotency does not discard identity.
- Dashboard queue sync also enters the same timer-persistence serial chain as start, suggestion, Save, Stop and deletion work. `resolveTimerEntryIdAfterQueueBarrier` waits behind any in-flight queue sync, then reads correlation storage under its own lock. All Dashboard sync entry points apply returned aliases before bootstrap/timer collision classification.
- If polling or bootstrap sees a canonical active ID while its corresponding optimistic start is still starting or syncing, collision handling is deferred rather than committing the pending deletion. When correlation settles, the canonical alias joins the tombstone set before the deferred external-active decision. A genuinely different active timer still commits the older active deletion deterministically.
- **Demonstrated by unit test (final suite):** `apps/mobile/src/lib/api.test.ts` covers durable correlation before queue removal, rejection of a “successful” start response without correlation, external-sync alias hydration before collision, and an in-flight sync preserving a newly queued Stop. `apps/mobile/src/lib/timerPresentation.test.ts`, `apps/mobile/src/lib/historyDeletion.test.ts` and Dashboard contract tests cover deferred collision, canonical refresh hiding, alias retention and one serial persistence owner.

### Persisted mutation outcomes and isolated rollback

- Suggestion apply and running/completed Save keep their optimistic, spinner-free UI, but their action result is not reported successful until the existing API mutation or the ordered queued-start update is durably accepted. A failed running suggestion therefore keeps the current presentation mounted, restores the exact touched fields and announces rollback instead of success.
- Stop remains locally immediate while an unresolved start is in its starting/syncing phase, as required by the optimistic product contract. Its persistence work is still ordered behind that start. Once the start has settled, Stop waits for API success or a durable offline Stop event before reporting success. A missing queued dependency is an error, not a fabricated success.
- Delete prepares and visually exits immediately, but does not claim durable completion at tap time. Expiry resolves canonical identity after the queue barrier and either deletes that persisted entry or proves that the matching queued start was removed. A permanent start rejection invalidates its dependent prepared/active deletion so expiry cannot target an entry that never existed.
- Rollback is field- and identity-scoped. A failed patch restores only keys present in that patch and removes only newly introduced, now-unused tag catalogue rows; unrelated newer or reused tags survive. If Stop of timer O fails after a newer timer N owns the active slot, O closes exactly at `N.startedAt` rather than replacing N. `createSupersededStopRollbackTracker` retains O's exact pre-Stop snapshot only while N is unresolved: canonical correlation discards it, while rejection of N consumes it to restore O active with `stoppedAt = null`. A rejected optimistic start otherwise removes only that start and restores the previous active entry only when no newer owner exists. A failed deletion merges the exact captured rows back into current arrays at snapshot-relative positions without replacing newer surrounding data. Per-entry mutation versions reject an older failure after a newer mutation has taken ownership.
- A permanent start rejection after presentation requests the matching generation's normal coordinated exit and applies rollback only from that exit completion; a rejection for an older generation cannot dismiss a reopened editor. Dependent work checks the start reconciler before performing API/queue writes, so a rejected start cannot leak a later update or Stop.
- **Demonstrated by unit test (final suite):** `apps/mobile/src/lib/timerPresentation.test.ts` covers persisted-start/dependent-PATCH rejection, durable Stop fallback, completed Save rejection, missing queued dependencies, rejected-start invalidation, generation-scoped exit, field-isolated patch/tag rollback, successful-N and rejected-N Stop races, newer-timer safety and exact deletion restoration. The native failure-flow harness contains completed Save, running suggestion and running Stop rejection paths, but the final native journey run did not reach them because the initial blank-keyboard checkpoint failed.

### One deletion/Undo lifecycle and timer identity boundary

- The general deletion coordinator owns a prepared phase and an active phase. Sheet deletion tombstones and optimistically removes the captured entry before exit; the matching exit completion activates `expiresAt = activatedAt + 5,000 ms` and exposes the shared Undo.
- Tokens reject stale activation, Undo and timeout callbacks. A second non-overlapping deletion commits the first; foreground reconciliation uses the absolute expiry; restoration merges the exact captured entry into the current model rather than replacing the surrounding model with an old snapshot.
- Tombstone aliases cover optimistic-to-canonical ID replacement. Bootstrap, cached restore, Shortcut drain and timer-state reconciliation filter pending IDs; a canonical copy remains hidden before and after alias discovery. A genuinely different active timer commits a pending active deletion before accepting the external active state.
- A synchronous blank-start gate prevents two same-turn Play actions from producing duplicate optimistic timers. A permanent start rejection invalidates deletion state associated with the rejected optimistic identity before rolling that identity out of the visible model.
- The blank-start claim remains held until the matching sheet reports presented, so two Play callbacks separated by request-animation frames still cannot start a second timer. Starting or switching to a genuinely different timer commits an undoable active deletion first.
- **Demonstrated by unit test (final suite):** `apps/mobile/src/lib/historyDeletion.test.ts`, `apps/mobile/src/lib/timerPresentation.test.ts` and Dashboard contract tests cover prepared-versus-active timing, Undo at 4,999 ms and expiry at 5,000 ms, replacement, foreground, identity aliases, refresh filtering, external-active collisions, deletion failure, exact restoration and same-turn/frame-separated Play gating.

### Direct deletion and obsolete confirmation eradication

- Running and completed editors now expose one direct Delete action. It delegates to the Dashboard coordinator, requests the ordinary swipe-sheet exit, and leaves the editor snapshot and Modal mounted until the matching presentation reports exit completion.
- The former entry-deletion prompt component is physically deleted. Its imports, state, render branches, disabling conditions, theme styles and current-facing acceptance language have been removed. No second modal, contained prompt or hidden bypass remains.
- A structural contract test reconstructs the obsolete file/name/style/copy probes from fragments so that the guard itself does not reintroduce a forbidden repository literal. It requires the old file to be absent and fails if an obsolete reference reappears.
- **Confirmed by source inspection:** direct Delete and the shared post-exit Undo are the only current entry-sheet path. **Demonstrated by unit test (final suite):** structural eradication and deletion coordinator contracts cover the source boundary. The three authoritative repository-wide scans were empty in the final validation pass.

### Executable Simulator evidence path

- A development-only route supplies deterministic, non-sensitive fixtures to the real production sheet, reducer, geometry, overlay and deletion coordinator. It does not call production APIs and is not a substitute component.
- The checked-in XCUITest target drives smoke, journey, failure, gesture, stress and deletion flows. Each invocation has a run ID; each open and finished exit carries a presentation ID. The harness exposes cumulative focus, swipe, stale-callback, overlay-drop and production mutation-lifecycle counters instead of fixture constants.
- The runner fingerprints the HEAD revision plus tracked binary diff and every untracked path/content. A fresh build writes that fingerprint, revision, workspace, scheme, test bundle and app path into a DerivedData manifest; `--no-build` reuse is refused unless every field matches. It also refuses a port already serving Metro, starts its own Metro process from this worktree, passes that port explicitly to React Native, and records the owned PID/project root. `noBuild`, `noMetro`, source dirtiness, revision and fingerprint remain visible in the top-level run record.
- Final admissible evidence must therefore use a clean committed revision, a newly created build manifest and an owned Metro process. The bypass flags are useful diagnostics only and cannot close the final evidence gate. Adversarial tests reject an already-running fake Metro sentinel and a stale build fingerprint.
- The recording analyzer extracts every decoded source frame with its original variable-frame-rate timestamp. It scopes intervals by run ID plus presentation ID, begins them at the explicit open-start marker and ends them only at the matching finished-exit marker. The first stable native sheet/Description calibration backfills entrance tracking; exit-start switches to moving paired-landmark tracking through finished exit. Expected keyboard/layout transitions terminate only their declared comparison window and require a new stable calibration.
- Stable and transitional analysis uses telemetry-calibrated native sheet, Description and overlay boundaries that a populated dashboard underlay cannot satisfy. Adjacent decoded frames—not merely sparse telemetry snapshots—are compared for sheet-top, Description and overlay-anchor jumps, with explicit keyboard/layout exclusions. Missing entrance/exit sheet frames, a missing calibrated sheet over populated content, a zero-opacity update gap, reused presentation IDs across runs, absent guardrail counters or an unevaluated optional threshold fail or remain incomplete under `--require-complete`.
- **Confirmed by source inspection:** the QA route, native UI-test target, provenance runner and multi-run calibrated analyzer are present. **Demonstrated by unit test (final suite):** the provenance and analyzer suites include false-positive and false-negative adversarial fixtures for all boundaries above. **Simulator acceptance is unresolved:** the post-freeze native runner failed the initial blank-keyboard checkpoint twice, so no final recording, matrix, stress or frame-analysis result is claimed.

### XCUITest interactive-keyboard limitation

Development diagnostics on the iOS 26.5 Simulator tried real XCUITest coordinate drags starting on the Description-owned `ScrollView` strip while `keyboardDismissMode="interactive"` was active. Those drags emitted no descending intermediate keyboard-frame notifications: the harness's cumulative interactive-frame count stayed unchanged. XCUITest also provides no supported way to hold that UIScrollView drag partway while a second independent finger begins the sheet-handle gesture.

The executable fallback therefore performs the closest honest native sequence on the same presentation: a real slow ScrollView swipe dismisses the keyboard completely while the sheet remains mounted, Description is deliberately refocused, the real keyboard and historical overlay reopen, the handle swipe cancels, a later handle swipe commits, and the sheet rapidly reopens with a higher presentation ID. Telemetry records which fallback mode ran plus the before/after interactive-frame counts.

The exact state ordering that Simulator automation could not create—commit sheet dismissal while an interactive keyboard dismissal is still in flight—is **demonstrated by deterministic reducer test** in `timeEntrySheetPresentation.test.ts`, including stale keyboard completion rejection. It is **not demonstrated as native gesture overlap**. Final stress evidence may claim the real dismissal/refocus/cancel/commit/reopen sequence and the reducer proof separately; it must not relabel them as a native simultaneous interaction. The actual overlapping two-gesture feel remains **still required before merge on a physical iPhone**.

## Independent review ledger

The independent reviewer did not author the reviewed areas. The statuses below separate source/test closure from the final affected-command and Simulator reruns.

| Finding | Resolution | Evidence and current status |
| --- | --- | --- |
| Duplicate-mutation evidence was a fixture constant rather than production measurement. | Added component-lifetime mutation attempt/start/reject/finish telemetry; the UI test asserts zero duplicate and rejected-completion counts and counter invariants. | **Confirmed by source inspection** and **Demonstrated by unit test**; XCUITest stress evidence **NOT RUN**. |
| Bootstrap/timer refresh could treat pending deletion state inconsistently. | Centralised pending-ID filtering and external-active collision reconciliation across bootstrap, cache, Shortcut and timer polling paths. Canonical aliases are hydrated after the queue barrier before collision classification. | **Confirmed by source inspection** and **Demonstrated by unit test**; refresh/Undo Simulator run **NOT RUN**. |
| A Settings/direct queue sync could race Dashboard deletion and lose canonical identity or overwrite a newer queued event. | Serialized every queue mutation/sync, persisted local-to-canonical correlation before removal, routed Dashboard sync through its timer-persistence chain, and added a post-sync correlation barrier. Duplicate event replay now returns the original canonical entry ID. | **Confirmed by source inspection** and **Demonstrated by mobile/web unit test**; final mobile and web suites **PASS**. |
| An unresolved optimistic start followed by suggestion, Save, Stop or Delete could report false persistence or target the wrong identity. | Ordered dependent work after start/correlation, required an existing queued start for local update/removal, required durable Stop fallback, and invalidated dependent deletion/work when the start is permanently rejected. | **Demonstrated by unit test**; native failure/deletion flow **NOT RUN** past the failed initial checkpoint. |
| A dependent API rejection after the start persisted could leave the sheet's optimistic fields diverged. | Running suggestion and Save now await their persisted/queued outcome and drive a generation-scoped field rollback on failure; Stop awaits durable acceptance after start settlement. | **Demonstrated by unit test**; clean-revision XCUITest failure path **NOT RUN**. |
| Whole-snapshot rollback could erase a newer timer, row or tag. | Rollbacks now restore only touched fields/identities, preserve newer surrounding rows and unrelated/reused tags, close a failed older Stop at a newer timer's exact start, and retain the old active snapshot only until that newer start correlates or rejects. | **Demonstrated by unit test**; final full mobile suite **PASS**. |
| A permanent start rejection could unmount a visible sheet or dismiss a newer presentation. | Added a presentation-scoped exit coordinator; a matching visible rejection completes the normal sheet/backdrop exit before rollback, while pre-open and stale-generation rejections cannot affect a newer sheet. | **Demonstrated by unit test**; rejected-start Simulator path **NOT RUN**. |
| Lower form controls could remain in VoiceOver order underneath the floating result surface, including when the computed surface had zero height. | Hide only the obscured subtree and only while the overlay is renderable; retain Description, results and sheet-dismiss affordance accessibility. | **Confirmed by source inspection** and **Demonstrated by unit test**; VoiceOver/large-text Simulator check **NOT RUN**. |
| Two blank Play actions in one React batch or across separate animation frames could start two optimistic timers. | Added a synchronous generation-aware blank-start claim/bind/release gate and hold it until the matching sheet reports presented. | **Demonstrated by unit test**; rapid-Play native integration **NOT RUN**. |
| A focus command consumed while backgrounded, or an old frame after rapid reopen, could focus the wrong sheet or never retry. | Split consumed from confirmed focus, reset native ownership per presentation, tokenized/cancelled the focus frame, and restore eligibility after foreground only when confirmation never arrived. | **Demonstrated by unit test**; background/foreground XCUITest path **NOT RUN**. |
| Keyboard-height and scroll-frame completions could survive a swipe/reopen and leave stale geometry. | Added presentation-plus-sequence completion tokens, consolidated cancellable scroll work, invalidated tokens on swipe/background/reopen and restarted one authoritative height owner after swipe cancel. Cumulative swipe counters expose missing or cross-generation callbacks. | **Demonstrated by unit test**; keyboard/swipe stress evidence **NOT RUN**. |
| The floating surface could expose maximum first-paint height or disappear during a same-presentation query/geometry update. | Gate paint, pointer events and accessibility on current content measurement; retain an already-visible surface through updates; count any content or same-content geometry visibility drop cumulatively. | **Confirmed by source inspection** and **Demonstrated by unit test**; cold-open/query-update recording **NOT RUN**. |
| Suggestion selection had no explicit VoiceOver success/rollback announcement. | Added semantic success copy after local/durable acceptance and distinct rollback copy after failure; no success is emitted for a failed running mutation. | **Demonstrated by unit test**; VoiceOver observation **NOT RUN**. |
| QA evidence could use another worktree's Metro bundle or a stale native product. | Require an unused owned Metro port, explicit React Native bundle port, source fingerprint, and exact build manifest match; record all bypass/provenance fields. | **Demonstrated by adversarial unit test**; the failed runner diagnostics were intentionally non-qualifying and no clean-revision runner pass exists. |
| Sparse or single-run recording analysis could miss entrance, exit, one-frame jumps or a populated-underlay false positive. | Scope intervals by run/presentation, calibrate stable and moving sheet/Description boundaries from open-start through finished exit, evaluate adjacent decoded VFR frames, and require complete guardrail/calibration evidence. | **Demonstrated by adversarial unit test**; normal/Reduce Motion reports **NOT RUN**. |
| SDK-patch lock scope was undocumented and could be mistaken for an unrelated framework upgrade. | Added the baseline/final dependency and Pod scope above. | **Confirmed by source inspection**; Expo compatibility, full source validation and clean native build **PASS**; layout/motion Simulator matrix **NOT RUN**. |

The interactive-keyboard overlap issue is not closed by XCUITest: its limitation and the paired native fallback/reducer proof are recorded above. Independent source/test review closed the frozen lifecycle and analyzer assignments with no remaining finding in the authorised scope. A final review of a passing frozen-revision evidence pack was **NOT RUN** because that evidence pack could not be produced after the blank-keyboard failure and the coordinator was instructed to stop further repair/retry cycles.

## Documentation conflicts

At baseline, current-facing references still described Suggestions above Description, Suggestions collapsing/reflowing when Description gained focus, and a contained destructive prompt in the editor. Those contracts are explicitly superseded by this redesign. This branch updates the regression checklist, validation matrix and feature tracker to the floating-history/direct-Delete contract and labels the older motion note as historical rather than silently applying both contracts.

Historical investigations remain useful evidence of prior behaviour, but they do not override this note or the attached plan.

## Validation and evidence plan

Automated layers:

- pure state/reducer event sequences with stale presentation and operation tokens;
- fake-clock deletion activation, expiry, foreground, replacement and Undo;
- historical matching/ranking/dedupe/patch tests;
- pure overlay geometry, continuity, accessibility and keyboard/frame generation tests;
- serial queue/correlation, durable mutation acceptance and isolated rollback race tests;
- provenance and adversarial multi-run recording-analyzer tests;
- component/source structural ownership checks;
- mobile/shared focused tests, then the complete repository validation commands.

Final command validation on 2026-08-08 passed the complete workspace source suite: shared 9 files / 150 tests, mobile 58 files / 566 tests, and web 101 files / 704 tests, with lint, all typechecks, web production build, brand assets, Expo dependency compatibility and diff checks green. The clean native app target also built, installed and launched. These passes do not override the separate failed Simulator journey gate below.

Simulator layers:

- a clean install and launch from the final native build;
- blank Play, existing described/blank timer, completed, Add and Review modes;
- one, six and long result sets, including `bau` substring selection;
- real keyboard dismissal/refocus, swipe cancel/commit, date-picker handover and rapid reopen; the unavailable interactive-overlap automation is reported separately and paired with reducer proof, never claimed as native overlap;
- delete-to-exit-to-Undo and expiry;
- small and standard/large iPhone sizes;
- Light/Dark, default/large Dynamic Type, normal/Reduce Motion;
- normal and Reduce Motion recordings with frame analysis;
- 30 normal + 30 reduced repetitions of the highest-risk presentation/keyboard/swipe path and 10 deletion repetitions.

The final evidence index will separate demonstrated facts, blocked checks and remaining physical-device-only inference. A physical-iPhone pass remains a pre-merge owner check; it is not substituted for the required Simulator proof.

## Final validation ledger

The coordinator must replace every placeholder below with the exact terminal result after the implementation and review fixes are frozen. Development-time passes are intentionally not promoted into final acceptance results.

| Required command or gate | Final status | Exact result/evidence |
| --- | --- | --- |
| `npm run typecheck -w @dayframe/shared` | **PASS** | Exit 0, 2026-08-08 09:07 BST. |
| `npm run test -w @dayframe/shared` | **PASS** | 9 files / 150 tests, exit 0, 2026-08-08 09:07 BST. |
| `npm run typecheck -w @dayframe/mobile` | **PASS** | Exit 0, 2026-08-08 09:07 BST. |
| `npm run test -w @dayframe/mobile` | **PASS** | 58 files / 566 tests, exit 0, 2026-08-08 09:07 BST. |
| `npm run lint` | **PASS** | iOS config check and web ESLint passed, exit 0, 2026-08-08 09:08 BST. |
| `npm run typecheck` | **PASS** | Mobile, web and shared workspace typechecks passed, exit 0, 2026-08-08 09:08 BST. |
| `npm run test` | **PASS** | Mobile 58/566, web 101/704, shared 9/150, exit 0, 2026-08-08 09:08 BST. |
| `npm run build` | **PASS** | Next.js 16.2.9 production build passed, exit 0, 2026-08-08 09:08 BST. |
| `npm run check:brand-assets` | **PASS** | Brand asset contract OK, exit 0, 2026-08-08 09:08 BST. |
| `npm run typecheck -w @dayframe/web` | **PASS** | Executed by the root workspace typecheck, exit 0. |
| `npm run test -w @dayframe/web` | **PASS** | Executed by the root workspace test: 101 files / 704 tests, exit 0. |
| `npm run build -w @dayframe/web` | **PASS** | Executed by the root build, exit 0. |
| `cd apps/mobile && npx expo install --check` | **PASS** | `Dependencies are up to date`, exit 0, 2026-08-08 09:09 BST. |
| `cd apps/mobile/ios && pod install --deployment` | **NOT RUN** | Not repeated in the accelerated final pass; the reconciled Pods/lock state was exercised by the successful clean native build. |
| Runner-provenance and recording-analyzer adversarial tests | **PASS** | 48/48 dedicated tests at freeze; included in the final 58-file / 566-test mobile suite. |
| `git diff --check` | **PASS** | Empty output, exit 0, 2026-08-08 09:08 BST. |
| Three repository-wide obsolete-confirmation scans from the authoritative plan | **PASS** | All produced no matches; `git grep` exit 1 is the expected empty result, 2026-08-08 09:13 BST. |
| Clean iOS Simulator `xcodebuild` with signing disabled | **PASS** | iPhone 17e `8D9C36E2-D7BA-43EE-89B0-2BE56CBD7459`, iOS 26.5; `clean build` reported `CLEAN SUCCEEDED` and `BUILD SUCCEEDED`, exit 0, 2026-08-08 09:12 BST. Source content was frozen but uncommitted, so this is not represented as clean-revision runner provenance. |
| Fresh install and launch of that native product | **PASS** | `/tmp/dayframe-mobile-sheet-redesign-derived/.../Dayframe.app` installed; `com.layereight.dayframe` launched as PID 4665 on the iPhone 17e Simulator. |
| XCUITest journeys and interruption flows, normal and Reduce Motion | **FAIL** | The normal-motion keyboard flow failed twice at its initial blank checkpoint. Focus and Suggestions succeeded, but no keyboard frame arrived: `focusCommandCount=1`, `inputFocusCount=1`, `keyboardInset=0`, `keyboardPhase=focus_requested`, `interactiveKeyboardFrameCount=0`, `ready=false`. Logs: `/tmp/dayframe-sheet-qa-keyboard-frozen-diagnostic.ndjson` and `/tmp/dayframe-sheet-qa-keyboard-frozen-rerun.ndjson`. No further retry or repair cycle was permitted. |
| Normal/Reduce Motion recordings analyzed with `--require-complete` | **NOT RUN** | Gated by the failed initial native journey; no passing exact-source recording is claimed. |
| 30 normal + 30 Reduce Motion stress iterations | **NOT RUN** | Gated by the failed initial native journey; no stress pass is claimed. |
| 10 deletion/Undo Simulator iterations | **NOT RUN** | Gated by the failed initial native journey; deterministic fake-clock/race tests passed, but no end-to-end Simulator pass is claimed. |
| Final independent-review rerun | **PARTIAL** | Independent source/test review closed the frozen lifecycle and analyzer scope and reran 4 focused sheet files / 81 tests plus mobile typecheck and 48 analyzer/provenance tests. A passing frozen-revision evidence-pack review was not run. |

## Evidence index

### Baseline evidence already captured

- **Demonstrated in Simulator recording:** `.codex-dayframe-qa/mobile-sheet-redesign/baseline/iphone17e-blank-play-entrance.mp4`, sourced from baseline commit `5b93914f4c4e9001acf94b49823f913684abde8a` on iPhone 17e / iOS 26.5.
- **Demonstrated in Simulator screenshots:** the six baseline fixture images under `.codex-dayframe-qa/mobile-sheet-redesign/baseline/` cover blank start, existing blank/described timer, completed, Add and Review modes.
- **Confirmed by source inspection:** baseline caller, focus, layout, keyboard and deletion ownership are recorded in the investigator sections above.

### Final evidence status

- Frozen implementation revision: **`1768806bf35d42ae0fd3742b4079a1013fb43197`**
- Runner provenance: **NOT QUALIFYING AS FINAL EVIDENCE** — the diagnostic used `--allow-dirty`, and the single permitted rerun reused its build with `--no-build`; both correctly remain diagnostic-only.
- Available devices/runtime: small `D2D581C4-2003-4888-AFAB-32528B372EAC`, large `14065E33-D874-408F-A090-891F19450322`, iPhone 17e `8D9C36E2-D7BA-43EE-89B0-2BE56CBD7459`, iOS 26.5.
- Final after-screenshots: **NOT RUN** after the native gate failed.
- Normal-motion recording and analyzer report: **NOT RUN** after the native gate failed.
- Reduce Motion recording and analyzer report: **NOT RUN** after the native gate failed.
- Journey XCUITest diagnostics: `/tmp/dayframe-sheet-qa-keyboard-frozen-diagnostic.ndjson` and `/tmp/dayframe-sheet-qa-keyboard-frozen-rerun.ndjson`; both **FAIL** at blank keyboard readiness.
- Stress summary: **NOT RUN** (30 normal / 30 reduced / 10 deletion all unexecuted).
- Diagnostic geometry at failure: live/base sheet 358×487 pt; Description y=130.333 pt, h=48 pt; overlay y=184.333 pt, max h=294.667 pt; keyboard inset remained 0, so no keyboard-settled geometry table is claimed.
- Appearance/accessibility matrix: **NOT RUN** after the native gate failed.
- Reviewer closure: source/test lifecycle and analyzer scope closed; final passing-evidence review **NOT RUN**.
- Draft PR: frozen implementation revision **`1768806bf35d42ae0fd3742b4079a1013fb43197`**, [#161](https://github.com/kwabiwe/dayframe/pull/161). The PR remains draft and explicitly not merge-ready.
- Final working-tree state: **clean after the documentation-only handoff commit is pushed**.

Exploratory `current-*.png` files and pre-freeze QA logs in the ignored evidence directory are diagnostic artifacts, not final proof. Only evidence whose recorded revision matches the final committed source may close the Simulator goals.

## Evidence language and remaining device-only checks

- **Demonstrated by unit test:** a development-time claim must be labelled as such and must retain the final-rerun caveat; use it for final acceptance only after the exact focused/full command, counts and revision are entered in the ledger.
- **Demonstrated in Simulator recording:** use only for states visible in the indexed final recording and supported by its telemetry/analyzer result.
- **Confirmed by source inspection:** proves ownership or absence in source, not runtime continuity.
- **Inferred but not directly automated:** record the specific limitation and the closest deterministic proof; do not convert it to PASS.
- **Still required before merge on a physical iPhone:** real touch/keyboard feel and frame pacing; the simultaneous in-flight keyboard-dismissal/sheet-handle gesture that XCUITest could not create; VoiceOver focus order and success/rollback announcements; accessibility-large Dynamic Type; Reduce Motion and Reduce Transparency; and background/foreground behavior during focus, dismissal and the Undo interval.

## Post-freeze regression-audit repair (2026-08-08)

An independent regression audit (4 bounded reviewers covering UI/motion, timer/data-integrity, QA-harness/evidence, and regression/scope/accessibility) ran against the frozen revision above. Two confirmed findings were repaired with unit-test coverage; mobile (576), web (704) and shared (150) test suites and all three workspace typechecks pass on the repaired tree.

- **Stale Review edit-presentation callback:** `finishEditHandover`/`cancelEdit` in `apps/mobile/app/review.tsx` compared only the presentation ID, so a delayed callback from an already-superseded presentation (rapid cancel-then-reopen) could still apply. Added `isCurrentReviewEditPresentation` in `apps/mobile/src/lib/review.ts` as the single comparison point, with a regression test for the exact race.
- **Keyboard-confirmation retry session-token race:** while root-causing the blank-keyboard failure below, a bounded blur/refocus retry watchdog was added (`shouldRetryKeyboardConfirmation` in `apps/mobile/src/lib/timeEntrySheetPresentation.ts`) to recover from iOS silently dropping the keyboard-frame notification after accepting first responder. Verification found the retry's own synthetic `blur()` call produced a genuine native `keyboardWillHide` notification that wasn't suppressed the same way the `onBlur` prop dispatch was; a late-arriving instance could be misattributed to the fresh session the refocus had just started and tear it down. Fixed in `apps/mobile/src/components/ActiveTimerEditSheet.tsx` by routing the native listener through the same suppression flag, held for a 300ms settle window instead of one animation frame. Retries now complete without corrupting session state.

### Blank-keyboard root cause: still open, not resolved by retry

With the retry mechanism now behaving correctly, the underlying blank-keyboard failure persists. Native XCUITest evidence across three post-fix runs: after the retry budget is exhausted (3/3 retries, all sessions clean), the keyboard never reaches `visible`. The decisive signal is `keyboardWillChangeFrame`'s reported `endCoordinates.screenY`, which equals the simulator's exact screen height (844pt on iPhone 17e) — i.e. UIKit itself is reporting a zero-height keyboard frame, not something the JS bridge is misreading. This points away from "one-off first-responder race, recoverable by retrying" and toward something more structural: either native window/key-window state during this specific presentation path, or an artifact of how `xcodebuild test` drives the Simulator. Neither was root-caused further; a targeted native (Swift) or outside-XCUITest investigation is required next and is intentionally out of scope for this pass.

The keyboard-confirmation retry watchdog is retained as a real (if incomplete) improvement — it correctly recovers from the narrower class of first-responder races it targets and no longer corrupts state when it can't — but it does not by itself close the acceptance gate below. This PR remains draft/not-merge-ready for that reason.

## Draft PR and safety handoff

- Frozen implementation commit: **`1768806bf35d42ae0fd3742b4079a1013fb43197`**
- Draft PR into `main`: **[#161](https://github.com/kwabiwe/dayframe/pull/161)**
- Draft state confirmed: **YES — GitHub reports the PR as draft.**
- Branch pushed and clean: **YES — `codex/mobile-sheet-redesign` is pushed; clean status verified after the final documentation push.**
- No merge, staging-alias promotion, deployment, production configuration change, production migration or TestFlight upload: **CONFIRMED — none performed.**
