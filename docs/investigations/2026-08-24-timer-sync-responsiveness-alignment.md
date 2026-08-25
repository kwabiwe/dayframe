# Timer Sync, Responsiveness, And Mobile Card Alignment

Date: 2026-08-24  
Status: implementation branch; merge, deployment, signed-build, and physical-device evidence pending

## Scope and frozen bases

This investigation records the coordinated Dayframe and Desk Cockpit change
defined by the owner-provided implementation contract. Dayframe was branched
from `origin/main` at `6fd55b83` (merged PR #184). Desk Cockpit was branched
from its `origin/main` at `6a8ab84`. The repositories require separate,
cross-linked draft PRs and must ship as one release unit.

The change is limited to:

- finite iOS execution for already-started durable timer mutations;
- authoritative timer responses that do not await APNs;
- safe latest-intent web timer sequencing;
- a low-cost three-second Desk timer fingerprint path while present;
- exact shared idle/running mobile timer-card geometry.

It does not replace durable queues, add a second timer store, change HealthKit
or Location Intelligence policy, add streaming infrastructure, deploy, release,
or upload a TestFlight build.

## Confirmed causes on the frozen bases

1. Mobile recovery requires `AppState.currentState === "active"` and has no
   UIKit finite background assertion. A durable mutation can therefore remain
   pending when React Native is suspended immediately after the user acts.
2. Online pending work always renders rotating arrows, including retry wait and
   dependency wait where no transmission is active.
3. timer/event routes await Live Activity enqueue and APNs drain after the
   authoritative database transaction. APNs has a longer timeout than several
   mobile mutation deadlines, so a client can time out after the timer commit.
4. the web timer gate includes full bootstrap reconciliation. Web Stop also
   PATCHes details and then stops the unscoped current timer; a concurrent Start
   can replace A with B between those calls and cause the old Stop to stop B.
5. Desk Cockpit reads a rich current-timer snapshot through a ten-second server
   cache on a fifteen-second present poll. Staggering explains roughly 25–30
   seconds of convergence. Its generic interval can overlap and ignores page
   visibility.
6. idle and running mobile cards use different horizontal/bottom padding and
   top-stacked action columns. Their controls are shifted horizontally and the
   plus/Quick Actions alignment is incidental rather than constrained.

## Implementation contract

### Finite iOS timer execution

One native process-wide UIKit background task is shared by opaque leases. A
lease begins only when durable Start/Switch, exact Stop, Edit, or Delete work is
about to transmit. Multiple concurrent drains may hold leases, but they do not
create multiple UIKit tasks.

Native code owns the `UIBackgroundTaskIdentifier`. Every valid identifier has
one idempotent end path. Expiration ends it immediately on the main actor, then
notifies JavaScript best-effort so current requests can cancel while their
durable records remain. Success, failure, explicit cancellation, expiry,
logout, account replacement, and owner teardown all release their leases.

An ordered recovery pass may finish its timer phases during brief backgrounding
while the assertion remains active. Review, Location Intelligence, and the
final bootstrap stay foreground-owned and resume through the existing root
coordinator. Background state never starts a new pass or spins waiting for
connectivity.

The timer phase recognizes every explicit timer event (`timer_start`,
`timer_stop`, `timer_switch`, `quick_action`, `nfc_action`, and
`shortcut_action`) and leaves Health and Location evidence in the subsequent
foreground phase. This can transmit a newer explicit action before older
general evidence, but `occurredAt` remains authoritative across delayed signal
sources: stale replacement windows fail closed instead of replacing the newer
explicit timer, and overlapping Health automation falls back to Review. The
older general record remains durable. Physical regression checks must confirm
that this priority does not duplicate, drop, or promote Health/Location work
and that stale automatic timer work cannot overwrite the latest explicit
intent.

This is best-effort completion, not a promise of network access or duration.
UIKit cannot execute cleanup after force-quit; the durable queue retries once
Dayframe launches again. This follows Apple guidance for short user-initiated
work already begun in the foreground:

- [Choosing Background Strategies for Your App](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app)
- [Extending Your App's Background Execution Time](https://developer.apple.com/documentation/uikit/extending-your-app-s-background-execution-time)
- [`beginBackgroundTask(withName:expirationHandler:)`](https://developer.apple.com/documentation/uikit/uiapplication/beginbackgroundtask(withname:expirationhandler:))
- [`endBackgroundTask(_:)`](https://developer.apple.com/documentation/uikit/uiapplication/endbackgroundtask(_:))

### Authoritative server and browser boundary

Timer/event API responses are determined only by session resolution,
validation, and the authoritative database mutation. Live Activity desired
state and APNs delivery run through Next.js `after()` and the existing durable,
revisioned outbox; failure is logged/retried and cannot rewrite an already
committed response. Authenticated bootstrap reconciliation and the protected
retry cron reconstruct current desired state before draining, so either a
failed `after()` registration or a failed enqueue is repaired without another
timer mutation.

The lightweight `/api/timer-state` fingerprint has no APNs work. It remains
compatible with web-cookie/mobile-bearer app sessions and accepts the separate
`x-dayframe-ingest-token` path only with `time:read`. High-frequency token use
does not write `integration_tokens.last_used_at` on every poll.

Start while another timer is running remains the existing atomic event-first
Switch under the workspace/user advisory lock. An unchanged web Stop is one
stable-idempotency exact-entry event. A dirty Stop first retains its detail
PATCH because that is the owner of unsaved category/place/description/tag/start
draft data, then sends the exact-entry Stop for A; the PATCH deliberately omits
`stoppedAt` so it cannot reopen a timer another client already closed.
If another client starts B between commits, stopping A is `superseded` and can
never stop B. Bootstrap/push reconciliation occurs after the mutation gate is
released. A latest-intent sequencer serializes/coalesces rapid actions and
generation guards prevent older refreshes from overwriting newer intent.

### Desk Cockpit dependency

Desk polls the lightweight fingerprint through a server-only, no-store proxy
approximately every three seconds only while room presence is true and the
document is visible. Polls are serial and generation-scoped. A changed
`activeEntryId`/`updatedAt` triggers one uncached rich snapshot; unchanged
fingerprints do not run the expensive metadata/today-total query. The full
snapshot must succeed before the applied fingerprint advances, so temporary
failure retries and retains the last valid timer.

The existing slow cached `/api/dayframe` summary remains unchanged. A late slow
summary may not replace a newer fast timer snapshot. WebSocket/SSE remains a
future option rather than part of this focused repair.

### Mobile timer-card geometry

Idle and running cards share a 136-point baseline height, 16-point horizontal
and 14-point vertical insets, 44-point action size, action-column width,
inter-column gap, and the description-to-label spacing contract. Their action
columns stretch to the 108-point content row and use top/bottom distribution:
Play/Stop share the same top centre and both plus controls share the same bottom
centre. The visible 32-point Quick Actions pill bodies use a 4-point gap below
the label and share their bottom edge with the plus control at card-relative
`y=122`, leaving 14 points below both. Six-point vertical hit expansion keeps
the pill target effectively 44 points without making an invisible touch row the
visual alignment edge. The scroller retains its trailing partial-pill affordance.

The existing one-point Play glyph optical correction stays inside the shared
44-point control. No button column is translated.

## Motion contract

- Trigger: optimistic idle/running timer changes and durable sync-state changes.
- Single owners: `DayframeDashboard` owns timer-card state; the root
  connectivity provider owns the fixed header status slot.
- Entrance/update/exit: card state changes use identical geometry with no new
  travel owner. Pending arrows are static, active transmission alone rotates,
  and successful live drain retains the existing brief cloud-check/opacity.
- Surrounding layout: shared card constraints prevent horizontal movement;
  the 44-point header slot remains reserved while visually empty.
- Interruption: newest timer intent wins. Native expiry, async response, and
  completion callbacks are token/generation scoped; stale owners no-op.
- Rollback: retryable/offline work remains projected and resumes later;
  permanent Stop/Edit/Delete diagnostics and canonical-truth restoration stay
  unchanged.
- Reduce Motion: arrows do not rotate, card state updates in place, and short
  opacity remains the only status transition. VoiceOver announces pending,
  transmitting, settled, offline, and attention states distinctly.

## Regression boundaries

The implementation must preserve:

- event-first Start/Switch/Stop and duplicate `clientEventId` convergence;
- exactly one running timer after concurrent or rapid actions;
- owner/workspace/session-generation isolation for every local queue;
- PR #184 ordered recovery, backoff, negative HTTP evidence, projection, Undo,
  and permanent-attention behavior;
- Review cache/outbox, Location Evidence cache, Location Intelligence journal,
  HealthKit import, Live Activity capability/revision safety, and export/delete;
- no sensitive Health/location payload logging or analytics;
- current sheets, navigation ownership, 44-point targets, VoiceOver, Dynamic
  Type, System/Light/Dark, safe-area, scroll, clipping, and Reduce Motion paths.

## Evidence required before merge

Repository validation follows `.codex/reference/validation-matrix.md`, including
the complete Dayframe lint/typecheck/test/build/docs gates, focused timer/API/
auth/Live Activity/mobile recovery/native tests, Pod install/autolink review,
and a clean unsigned iOS build. Desk must pass its focused server/polling tests,
complete suite, TypeScript build, Node syntax check, and production build.

Draft PR automated checks and UI comparison evidence must be reviewed before
either PR is made Ready. The selected Dayframe Preview must then be promoted to
stable staging and tested with a signed `preview` build on a physical iPhone;
Desk is tested only after its dependent Dayframe Preview is reachable. Neither
PR may merge until both physical matrices pass. Production and TestFlight are
post-merge work and are not authorized by this implementation.

## Pre-PR validation record

The implementation branch was validated once and then closed down for draft
review, without rerunning failures merely to obtain a clean result:

- final focused web coverage: 59 tests passed; web typecheck and targeted lint
  passed;
- final focused mobile coverage: 212 tests passed; the native lease core passed
  4 Swift tests; Expo autolinking and CocoaPods installation succeeded;
- `npm run lint` passed, including `npm run check:docs` over 119 Markdown files
  and the iOS configuration check; ESLint reported two existing unused-variable
  warnings in `event-service.test.ts` and no errors;
- `npm run typecheck`, the optimized web build, brand-asset check, Review SQLite
  validator, and Location V2 SQLite validator passed;
- the complete concurrent workspace test run did not pass: mobile finished
  907/909 tests and web finished 833/853 with one skip. Twenty failures were
  five-second timeouts under the resource-concurrent run; one later web DOM
  assertion ran after those timeout failures. Shared finished 156/156. The
  successful focused suites above exercise the changed timer, authentication,
  Live Activity, connectivity, outbox, lifecycle, and geometry boundaries;
- `npx expo install --check` reported the frozen branch's six Expo dependencies
  one patch behind the SDK 56 compatibility recommendations. Dependency
  upgrades are outside this focused change;
- a clean unsigned iPhone 11 Simulator build resolved and linked the new pod and
  progressed through React Native codegen without a Dayframe module compiler
  error, but was stopped before completion when the owner requested immediate
  PR wrap-up. It is recorded as incomplete, not passed;
- a disposable local Dayframe/Desk integration check observed coherent Stop and
  Start fingerprints plus rich snapshots after one scheduled 3.1-second Desk
  poll interval. The local Start mutation itself had one 12.0-second database
  transaction outlier; this was not rerun and must be checked on the exact
  staging Preview;
- UI screenshots, stable-staging checks, signed builds, and all physical-device
  checks are `NOT RUN` and remain explicit pre-merge work.

## 2026-08-25 timer-card correction evidence

The initial shared-card implementation aligned the 44-point Quick Actions
touch row rather than the visible 32-point pill body, and its geometry helper
modelled the Description surface as 44 points despite the inherited 48-point
minimum. The corrected baseline is 136 points: top controls remain at
`y=14...58`, visible pills move to `y=90...122`, and both Plus controls occupy
`y=78...122`, leaving 14 points below the visible bottom. Pills retain a
44-point effective target through six-point vertical hit expansion.

Focused mobile geometry/contract tests (13 tests), mobile TypeScript, the
documentation-alignment check, and `git diff --check` passed. Claude CLI using
Claude Sonnet 5 reviewed the correction and independently reproduced every
target coordinate with no actionable finding. A full Debug `iphoneos` build
then passed for the connected physical iPhone 11 (`iPhone12,1`, iOS 27.0),
signed with the Dayframe development team, and the resulting app was installed
on that device. This is build/install evidence only: the visual/device matrix,
runtime launch, stable staging, and owner acceptance remain pending.

## Unresolved decisions

None are required to implement this contract. A guaranteed completion model
that survives suspension or process termination would require a separately
approved native background `URLSession` design; the current finite assertion
plus durable retry intentionally does not claim that guarantee.
