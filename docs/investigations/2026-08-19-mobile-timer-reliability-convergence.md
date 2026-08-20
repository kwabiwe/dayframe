# Mobile timer reliability and Live Activity convergence

Date: 2026-08-19  
Trello: [#147](https://trello.com/c/XBVc6pe6/147-mobile-timer-stop-hangs-during-background-event-sync), [#148](https://trello.com/c/UN0A4CbV/148-duplicate-optimistic-and-canonical-live-activities-on-iphone)
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

## Review hardening

The 20 August out-of-band PR review identified two additional Stop-outbox
failure modes. Delivery previously checked the account owner before awaiting the
SecureStore bearer, so a logout/login during that read could dispatch Account
A's Stop with Account B's token. Delivery now captures the session generation
before the read, revalidates the generation and token immediately before
`fetch`, and retains the Stop without dispatch when they changed. A malformed
JSON or non-array outbox container previously made every later Stop mutation
throw; serialized reads now normalize that unrecoverable container to an empty
durable array before accepting another Stop. No stored raw value is logged.

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
- **PASS:** review-hardening coverage proves a deferred Account A token read
  cannot dispatch after Account B replaces the session, and malformed/non-array
  outbox containers recover before the next durable Stop (97 assertions across
  the focused API, outbox, and secure-session files).
- **PASS:** full `npm run test` after review hardening (mobile 711, web 834,
  shared 156); the gated Postgres file remains skipped in the ordinary suite.
- **PASS:** the gated two-connection Postgres test ran separately against the
  documented local PostGIS service. An exact entry-scoped Stop completed and
  persisted once while another connection held the user's advisory lock.
- **PASS:** full lint, typecheck, production web build, documentation check (116
  Markdown files), brand-asset check, focused mobile/web typechecks, and
  `git diff --check`. Lint retained two pre-existing unused-parameter warnings in
  `event-service.test.ts` and returned success.
- **PASS:** clean unsigned arm64 iOS Simulator build from a fresh derived-data
  directory after successful CocoaPods/autolinking install. The generic
  dual-architecture build was narrowed after its duplicated x86_64 dependency
  compile; the recorded successful result is the host-architecture build.
- **NOT RUN:** staging schema/index verification, exact Preview promotion,
  signed EAS preview build, and the
  physical-iPhone Stop/force-quit/offline/contention and ActivityKit convergence
  matrix. Both paired iPhones were unavailable/offline on 20 August; only a
  paired iPad was reachable, which is not valid evidence for this iPhone-only
  feature. These checks remain required before merge; production and TestFlight
  evidence must not be inferred from this branch.

## Merge and release closure

- PR #182 merged to `main` as `8d88765d89f053d8a4b3af2dc57b4cc646136667` after the exact signed Staging head was installed and owner-tested on the attached iPhone 11.
- The gated two-connection local PostgreSQL advisory-lock contention test was rerun after merge with `DAYFRAME_RUN_DB_INTEGRATION=1` and passed.
- The exact merge was archived with the production API and released as internal TestFlight `0.1.0 (97)`, delivery/build ID `c849ea28-424d-4222-8b57-14bcf25c310a`. App Store Connect reports `VALID`, export compliance false, en-GB notes set, and `IN_BETA_TESTING` through `Internal Health Debug`; external testing remains disabled.
- Trello #147 and #148 return to Watch after release. Continued real-device offline, force-quit, locked/background, account-switch, and rapid-replacement observation remains appropriate; it is not evidence of a known open implementation blocker.
