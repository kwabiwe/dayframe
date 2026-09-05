# Mobile sync recovery implementation

This is implementation evidence, not closure of the September 4 incident. Server prerequisite: draft PR #188. Earlier CLI Previews were blocked by commit-author permission. A subsequent GitHub-created server Preview is Ready; the checked mobile GitHub Preview was cancelled. Stable alias promotion and physical-device validation remain outstanding. Production remains unchanged.

## Settings motion contract

Trigger: deliberate Sync now or Reconcile now. Settings owns status text; the existing Reanimated local presence/layout helpers own saved-issue entrance, update, removal and surrounding reflow. The native stack alone owns navigation. Keep existing Midnight Core surfaces and pill actions, stable issue keys and 44-point targets. No new spinner or header state accompanies ordinary background work.

Repeated Sync taps retain exactly one device-wide follow-up per owner/session generation; repeated Review requests coalesce one owner-bound follow-up. Navigation does not delete durable intent. Completion or the 45-second deadline replaces the status with per-lane outcomes; failed or unknown delivery keeps the original intent and optimistic hiding. There is no optimistic destructive removal and no Undo. A verified acknowledgement removes its issue through the same local exit/reflow owner. Reconcile does not expose destructive discard for an unknown outcome.

Reduce Motion removes travel through the shared helpers while preserving all outcomes and actions. Use visible text and accessibility labels; do not move focus as background rows change. Dynamic Type uses wrapping text and existing Settings scrolling. Normal/Reduce Motion recordings, rapid-repeat navigation, VoiceOver and physical-iPhone checks remain required and unperformed.

## Scope and remaining dependencies

The mobile recovery branch adds complete JSON request deadlines, validated acknowledgements, bounded Review escalation, independent due times, truthful Location upload/replay outcomes and presentation-cache consumer ownership. Manual sync explicitly covers enabled Health capture, events, processing, Review, Location and projected canonical refresh.

Health's durable sample journal, episode reconstruction/deletions/repair scan and environment migration are separate required work. Current owner checks alone do not make the legacy Health anchor and AsyncStorage handoff atomic. Do not claim that boundary repaired until the journal implementation and interruption tests are complete.

## Reproduction and validation evidence

| Defect | Baseline evidence | Corrected coverage |
| --- | --- | --- |
| F03/F04 | A 21-attempt intent did not reconcile; manual force during an active pass was dropped | Real SQLite age/contention escalation, immutable receipt reconciliation, restart recovery and one forced follow-up |
| F05 | Review retryable failure stopped Location/bootstrap | Typed lane outcomes and later-lane execution; genuine transport failure still stops network recovery |
| F06 | Executing the original Settings closure recorded only events, Review and refresh | Coordinator tests prove independent captures, explicit Location, bounded unfinished results and a dirty refresh follow-up |
| F09 | Stored upload backoff survived manual replay; replay success masked pending evidence | Real SQLite override/backoff, per-evidence acknowledgement and one attempt per forced-pass remainder |
| F10 | Stopping idle prefetch incremented cancellation | Idle-stop diagnostics plus visible-consumer ownership and cancelled late-write tests |
| F11 | A resolved fetch with a stalled JSON body remained pending beyond the deadline | Full JSON parsing/validation deadlines and late-owner/caller-abort tests |
| F12 | Arbitrary successful responses removed durable generic/Review intent | Shared operation-specific acknowledgement validation and canonical event ID requirement |

Full repository tests passed: mobile 100 files / 955 tests; web 125 files passed plus one skipped / 862 tests passed plus one skipped; shared 14 files / 230 tests. Two subsequently added diagnostics regressions passed in a focused 26-test run. All-workspace typecheck, web build, lint, documentation alignment and both SQLite validation scripts passed. Lint retains two existing unused-variable warnings in the web event-service tests.

CocoaPods installation passed, changing only the three path-dependent prebuilt checksums. The initial two-architecture unsigned Release Simulator build failed with libtool `write64 errno=28` (disk full), not a reported source error. Its task-owned temporary output was removed while preserving logs. A fresh arm64-only unsigned Release Simulator build passed against iOS Simulator SDK 26.5 with `EXPO_PUBLIC_DAYFRAME_API_BASE=https://dayframe-staging.vercel.app` and release channel `preview`. The app archive is retained only in private ignored QA storage. This was a build, not an installed/interactive phone result. No phone app, queue or source checkpoint was changed.

The build exposes missing source/runtime/update attestations as null instead of inventing identities. Routine support output allowlists queued identifiers/state, omits raw payloads, and samples current native/Location/Review diagnostics at export time. New owner-bound Location diagnostic results do not adopt old unscoped replay errors. Review's latest error is selected by timestamp, never by maximum text value.

Documentation impact: runtime/storage/API and visible Settings behaviour; architecture, tracker, validation matrix, regression checklist and this motion/evidence note updated. PRD/brand identity unchanged. Main's older tracker called already-merged #186/#187 work implementation-pending; this branch carries the same evidence-based Watch correction as server PR #188.

## Scope freeze and final recovery check (September 5)

No further Location redesign, repair UI, diagnostics expansion or wider environment migration is included. The final manual-runtime regression reproduced a later Health capture joining a previously selected forced delivery pass (two drains instead of the required three). Each completed capture now requests a new owner-serialized queue pass. The coordinator also delivers saved pages after partial capture while retaining the partial outcome. Full mobile validation passes 961 tests, including actual SQLite immutable Review reconciliation, lost force, independent siblings, busy Review with Location/refresh continuation and the manual runtime regression.

Independent review #189: the device-wide active-promise shortcut dropped a second Sync now request. The existing coalescer now owns that boundary as well as Review: the first repeated press requests one follow-up, further presses join it, and the captured session guards every operation. The new runtime regression failed before the change and verifies exactly two Review/Location/Health passes after repeated presses, including a press during the follow-up. No UI or timer ordering change.
