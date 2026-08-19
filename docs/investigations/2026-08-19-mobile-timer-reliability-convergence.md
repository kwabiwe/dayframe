# Mobile timer reliability and Live Activity convergence

Date: 2026-08-19  
Trello: #147, #148  
Status: Implementation complete; staging and physical-device validation pending

## Scope

This investigation covers two related convergence failures:

- an explicit mobile Stop can remain in flight behind background event/database
  work before the user's intent becomes durable; and
- optimistic and canonical Live Activities can coexist because JavaScript treats
  scheduled cleanup as completed without proving the final ActivityKit state.

The shared invariant is that server timer state, React state, durable mobile
state, and ActivityKit converge on exactly one authoritative timer state. New
mobile Stop delivery remains event-first and entry-scoped. Swift remains a
projection boundary and does not acquire API or timer ownership.

## Confirmed causes

- Entry-scoped Stop currently shares a coarse per-user advisory transaction lock
  with background event processing.
- Direct mobile Stop has no bounded client deadline and becomes durable only
  after a recognised transport failure.
- The general event queue can delay a persist-first Stop behind network drain
  work, and a delayed unscoped Stop is unsafe after timer replacement.
- Native Live Activity cleanup resolves its bridge promise before exact
  ActivityKit dismissal completes.
- JavaScript has fire-and-forget cleanup paths and can cache reconciliation as
  successful after `start()` without rereading native state.
- A native snapshot that contains any canonical match does not currently reject
  optimistic or duplicate-canonical siblings.

## Motion contract

- **Trigger:** the user taps Stop from the running editor or Today, or foreground
  recovery discovers a durable pending Stop for the timer returned by bootstrap.
- **Owner:** `ActiveTimerEditSheet` remains the only sheet entrance/exit owner.
  React timer presentation owns the static pending-sync state. ActivityKit owns
  its system presentation; JavaScript serially requests exact-ID native changes
  but adds no competing visual animation.
- **Entrance/update/exit:** a locally persisted Stop immediately projects the
  timer as stopped and uses the existing coordinated sheet exit. A compact
  `Stop pending sync` secondary label may be present while the durable intent is
  unresolved; it does not introduce a spinner, progress bar, modal, or new sheet
  transition. Native optimistic-to-canonical promotion may briefly contain two
  activities, then exact stale siblings are dismissed before convergence is
  recorded.
- **Surrounding layout:** existing timer/list layout and sheet geometry remain
  authoritative. Pending status occupies a stable secondary status location and
  must not create a layout-moving loading row.
- **Interruption:** repeated Stop reuses the same logical intent. Generation and
  immutable timer/activity identities prevent stale delivery, cleanup,
  registration, or sheet callbacks from stopping/dismissing a newer timer.
- **Async outcome:** local outbox failure is the only Stop failure that may roll
  back the optimistic presentation. HTTP timeout, `timer_busy`, offline, and
  retryable server failure keep the timer locally stopped/pending. Success,
  duplicate, and `superseded` clear pending state silently. Exhausted ActivityKit
  cleanup retries remain unsynced and retry on a later lifecycle reconciliation.
- **Accessibility:** Reduce Motion uses the existing sheet fallback and does not
  suppress the state change or pending copy. VoiceOver receives state text rather
  than progress-only feedback. Dynamic Type must not clip the pending label;
  Reduce Transparency does not change ownership or semantics.

Nearest existing patterns: the presentation-scoped running-sheet exit documented
in `2026-08-13-mobile-lifecycle-regressions.md`, and the durable, non-blocking
Review outbox state. This change reuses the former's motion owner while keeping
timer Stop persistence in its own dedicated outbox.

## Documentation impact

- Product behavior: clarify durable, entry-scoped mobile Stop and final native
  Live Activity convergence in the PRD/regression contract.
- Runtime ownership and storage: add the dedicated timer Stop outbox and verified
  ActivityKit projection boundary to architecture/API/database references.
- Delivery state: update the feature tracker without claiming staging,
  physical-device, production, or TestFlight evidence that was not run.
- Release/testing: add focused executable guardrails and use the Timer and Sync,
  Interaction Motion, Auth/Deployment, and Release sections of the validation
  matrix.

No new schema is planned. Before hosted testing, staging must be checked for the
existing unique `activity_events.client_event_id` index. No unresolved product
decision has been identified; timeout values are bounded operational constants
to tune from staging evidence, not a change to product scope.

## Validation results

- **PASS:** focused mobile outbox, API, timer-presentation, dashboard contract,
  Live Activity, and native source-contract tests (178 assertions across six
  files after the final registration-generation race fix).
- **PASS:** focused web event-service, events route, time-entries route, and Live
  Activity registration tests (127 assertions across four files).
- **PASS:** full `npm run test` (mobile 707, web 834, shared 156); the gated real
  Postgres contention file was skipped because no disposable database was
  configured.
- **PASS:** full lint, typecheck, production web build, documentation check (116
  Markdown files), brand-asset check, focused mobile/web typechecks, and
  `git diff --check`. Lint retained two pre-existing unused-parameter warnings in
  `event-service.test.ts` and returned success.
- **PASS:** clean unsigned arm64 iOS Simulator build from a fresh derived-data
  directory after successful CocoaPods/autolinking install. The generic
  dual-architecture build was narrowed after its duplicated x86_64 dependency
  compile; the recorded successful result is the host-architecture build.
- **NOT RUN:** the gated two-connection Postgres test, staging schema/index
  verification, exact Preview promotion, signed EAS preview build, and the
  physical-iPhone Stop/force-quit/offline/contention and ActivityKit convergence
  matrix. These remain required before merge; production and TestFlight evidence
  must not be inferred from this branch.
