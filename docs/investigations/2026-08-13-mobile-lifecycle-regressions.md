# Mobile lifecycle regression bundle

Date: 2026-08-13

## Planned reports and scope

The Dayframe Trello Planned list contained three mobile reports:

- [Live Activity Stop is unreliable](https://trello.com/c/HrIGchbf/134-stopping-a-timer-using-live-activity-has-become-very-unreliable-again): a first timer can lack a Live Activity, Stop may not reach another client promptly, and an already-open mobile editor can continue showing the stopped timer.
- [Minor Calendar adjustment](https://trello.com/c/HUI3Qc6u/140-minor-calendar-adjustment): centre the empty-state copy between the `02:00` and `03:00` grid lines and return a stale Calendar selection to today after the app has been away for a while.
- [Recent commutes and visits last appeared on 5 August](https://trello.com/c/NC04zO57/141-why-are-my-recent-commutes-and-visits-being-logged-last-was-5-aug): determine whether capture, local processing, upload, or server replay stopped.

They share one foreground/background reconciliation boundary and require no schema, API, rollout-policy, permission, or automatic-logging threshold change, so they are safe to deliver in one mobile-only PR with independent executable coverage.

## Evidence and root causes

### Location capture versus upload

The connected iPhone 11 was still running the direct PR #174 Staging build. Its 5 August commute and 26 July unknown visit are the deliberately seeded Staging fixtures, so those records are not evidence of a production capture regression.

Read-only diagnostics from the production TestFlight phone showed a separate real defect:

- Location V2 remained enabled and native capture/local engine processing continued through 13 August.
- The native signal queue had drained, but the authenticated upload timestamp stopped on 6 August.
- The active account had 1,086 pending local evidence rows and a due outbox batch.
- The last recorded upload error was iOS Keychain interaction being unavailable during a background transition.

The location store requested SecureStore for every upload attempt. A background TaskManager callback could encounter the locked Keychain, while `configureLocationIntelligence` launched its sync without awaiting it. This made a failed background attempt easy to lose and forced the later foreground reconciliation through the same fragile read even though bootstrap had already read a valid session. The foreground replay added by `254fc60` did not cache that successful foreground credential and therefore did not close the older scheduling gap completely.

The repair keeps a successfully read token in process memory until explicit session replacement/logout, orders and generation-checks session reads so stale Keychain work cannot restore a prior account, and treats temporary Keychain unavailability as a retryable location-sync result. Bootstrap starts outbox reconciliation after local account binding without holding geofence refresh behind the network, while evidence-upload and replay requests have a 15-second deadline so one stalled request cannot permanently block later synchronisation. Exact evidence remains in the protected journal; no coordinate or account identifier is logged or committed.

### Live Activity and retained editor

The JS Live Activity owner remembered only its last requested entry key. When Stop ran in the App Intent extension while React Native was suspended, ActivityKit ended the native activity but the JS key remained unchanged. On foreground, the same canonical active-entry key caused an early return instead of checking whether a native activity still existed. That stale-key guard originated in `2814a81`; PR #160 (`5b93914`) added the extension/direct-delivery path that can legitimately change ActivityKit state outside the JS process.

The retained active-editor behavior was separate. The shared sheet redesign in `1768806` intentionally retained the last active entry while the sheet completed its exit, but no canonical-refresh path requested that coordinated exit when another client or the Live Activity stopped the timer. The parent therefore kept passing the retained entry to a still-visible sheet.

The repair exposes a read-only native `hasActiveActivity` bridge. A same-key reconciliation now recreates a missing activity or removes an unexpected idle activity. Canonical external Stop requests the existing sheet-owned coordinated dismissal; local optimistic Stop remains owned by its existing mutation/dismissal path. The web client still observes timer changes on its bounded polling cadence, so this PR does not claim instant cross-device repaint.

### Calendar state and geometry

Native tabs eagerly retain `DayframeDashboardProvider`, whose selected day was initialized only once. No AppState transition returned a deliberately old selection to today. The repair preserves a selection across short interruptions, resets it after 15 minutes, and always resets across a calendar-day rollover.

The native Calendar empty-state Y position was a hard-coded `160` points and its X position ignored the timeline's trailing inset. The repair moves the geometry into tested Swift math: the copy is centred in the actual timeline lane and its baseline centre is exactly `2.5 * hourHeight`, midway between the `02:00` and `03:00` grid lines at every supported zoom.

## Motion contract

- Trigger: canonical foreground refresh discovers that the timer shown in the editor has stopped elsewhere; or a stale Calendar selection is resumed after the lifecycle threshold.
- Owner: the existing `ActiveTimerEditSheet` coordinated exit remains the only timer-sheet animation owner. The native Calendar remains the only owner of timeline geometry; the existing selected-day transition owns the date change.
- Entrance/update/exit: no new entrance is added. External Stop sends the existing presentation-scoped dismiss request, then the parent clears retained data only after the sheet's completion callback. Calendar date reset uses the existing directional day transition; empty-state placement is a static geometry correction.
- Surrounding layout: the existing active-timer expansion/layout timing remains authoritative. No spinner, extra feedback row, or competing layout animation is added.
- Interruption: local timer mutations suppress external-dismiss inference. Presentation IDs reject stale completion callbacks. Short app interruptions preserve the selected Calendar day; a later foreground event supersedes the recorded background timestamp.
- Async outcome: location upload and timer reconciliation remain silent and retryable. A failed external refresh leaves the current surface unchanged; a successful canonical Stop exits normally.
- Accessibility: Reduce Motion continues through the existing sheet and native Calendar owners. The state change is not motion-only; the stopped timer disappears canonically. VoiceOver labels, Dynamic Type, and Reduce Transparency are unchanged.

## Validation evidence

Completed during implementation:

- full mobile Vitest suite: 67 files and 659 tests passed (including the 114 focused regression tests);
- native Calendar Swift package: 44 XCTest cases passed;
- mobile TypeScript typecheck passed with the locked mobile TypeScript toolchain;
- documentation alignment and iOS configuration checks passed;
- unsigned arm64 iOS Simulator workspace build passed, including the new Swift/Objective-C Live Activity bridge;
- read-only physical-device diagnostics distinguished Staging fixtures from the production local-upload backlog.

Still required before merge/release:

- physical-iPhone foreground recovery of an existing location backlog, Live Activity Stop/recreation, external sheet dismissal, short/long Calendar resume, Reduce Motion, and Dynamic Type checks.

No production sync was triggered and no device data was mutated during diagnosis.
