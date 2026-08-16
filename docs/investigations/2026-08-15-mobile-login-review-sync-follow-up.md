# Mobile Login, Review Sync, And Location Review Follow-up

Date: 2026-08-15

Branch baseline: `origin/main` at `f98e134f3c50f5cc529ca1f661defb5e91a69b38`

## Reported Behaviour

- Mobile login took close to one minute on two attempts.
- The password disappeared shortly before the Login surface disappeared.
- A locally saved Review decision showed `Retry now` while it was still taking roughly 20 seconds to finish syncing.
- Automatic commute Review cards and the Location Evidence correction editor showed dates even though the detected day is not user-owned. The editor date labels were truncated on the attached iPhone screenshot.
- After signing out and back in, only 12 August location suggestions appeared. Older missing commutes did not return.

## Version And Runtime Boundary

The repository-recorded TestFlight build is `0.1.0 (93)` from `783da15`. Current `origin/main` contains later mobile session and location recovery fixes through `f98e134`, so repository state alone does not prove those fixes are present on the reporting iPhone. A new internal build and physical-iPhone check are required before this follow-up can be called released.

## Evidence And Competing Hypotheses

### Login

1. The authentication endpoint itself may be slow or stalled.
2. Authentication may succeed promptly while the dashboard blocks the Login surface on bootstrap, native shortcut draining, and queued timer reconciliation.

Both remain possible without request timing from the affected build. The visible password disappearance is deterministic in the source: `submitAuth()` clears the password before awaiting `load()`, and `load()` does not publish `authenticated` until bootstrap and shortcut reconciliation finish. Neither auth nor bootstrap currently has a request deadline.

### Review sync

1. A server request may be slow or stalled.
2. The app may be in its intended retry backoff after a retryable response.

The screenshot labelled `Saving to Dayframe…` is compatible with `pending` or `in_flight`, while the top-level component renders `Retry now` for every `waitingCount`, including those normal states. Review POSTs have no request deadline even though the existing outbox contract classifies timeout as retryable. The first retry delay is jittered around 30 seconds, which can also resemble an unexplained wait.

### Missing days

1. Durable evidence may still be queued but only partly drained by the bounded five-batch foreground pass.
2. Older evidence may have been removed by the explicit logout/account privacy reset or by the seven-day local evidence retention window.
3. A newly acknowledged location semantic-mode cutover may intentionally exclude earlier evidence from semantic replay.

The server Review query has no 12-August-only filter. The local location pipeline does have seven-day retention, bounded upload passes, explicit logout clearing, and a semantic cutover. Data already removed by those rules cannot be reconstructed from application code. This follow-up must not weaken account isolation, logout clearing, retention, or replay duplicate protection.

## Root Causes Addressed Here

- Login has no bounded network deadline and clears sensitive form state before the authenticated dashboard is ready.
- Review mutation transport has no bounded deadline despite the documented timeout/retry contract.
- Review status conflates pending/in-flight work with retryable failure by showing `Retry now` for aggregate waiting work.
- The automatic Location Evidence correction editor exposes date controls that are not needed for this generated suggestion flow and truncate at phone widths.

The earlier mobile bearer/cookie split that prevented location evidence upload is already fixed on current `origin/main`. This follow-up does not replace or relax that fix.

## Implementation Contract

- Auth, bootstrap, and Review mutation requests use the shared cookie-free mobile boundary and abort after 15 seconds with a safe, actionable timeout message.
- After credentials are accepted, React Native remains the single presentation owner and replaces the Login form with a static branded `Opening Dayframe…` state while bootstrap completes. The password is cleared only after the authenticated dashboard is ready; a failed opening returns to Login with the entered password retained for correction/retry.
- The handoff introduces no new spatial animation. The existing dashboard entrance remains the sole animation owner. Reduce Motion therefore needs no additional branch.
- Review cards remain visible and disabled until server acknowledgement. Pending/in-flight work shows saving copy without a retry action. `Retry now` appears only for `retry_wait`; authentication and permanent-attention states keep their dedicated actions/copy.
- The Location Evidence editor keeps the detected start/end dates internally, exposes only editable start/end times, and shows the live duration. Cross-midnight dates remain attached to their original endpoint. Review list cards retain their date context because they combine suggestions from multiple days and do not expose date editing.
- Location privacy retention, explicit logout clearing, semantic cutover, event-first processing, and server idempotency remain unchanged. No claim is made that already-cleared historical evidence can be recovered.

## Validation Plan

- Unit-test successful, aborted, and timed-out shared mobile requests, including caller cancellation.
- Contract-test the post-auth opening handoff, password retention on failure, and password clearing after successful dashboard load.
- Test Review retry action visibility separately for pending/in-flight and retry-wait diagnostics.
- Test the time-only Location Evidence editor contract, including its live duration, preserved baseline dates, and cross-midnight ranges.
- Run the mobile test suite and typecheck, Review SQLite validator, repository lint/typecheck/test/build/docs checks, and `git diff --check`.
- On a physical iPhone, verify login under normal and throttled networking, a deliberately stalled Review mutation through timeout/retry/reconnect, phone-width and large-Dynamic-Type Location Evidence layout, cross-midnight suggestions, background/foreground, force-quit/reopen, VoiceOver, Reduce Motion, and the expected production/staging API lane.

## Validation Evidence

Completed on the implementation branch against the baseline above:

- Focused mobile coverage: 25 tests across the shared request deadline, auth handoff, Review status/transport, and Location Evidence editor contracts. The auth handoff regression also covers a bearer rejection publishing the global signed-out transition during post-login bootstrap: the stale session is invalidated while the entered password remains available on the returned Login form.
- Full repository tests: 1,677 tests passed (mobile 696, web 825, shared 156).
- `npm run lint`, `npm run typecheck`, `npm run build`, `npm run check:docs`, `npm run check:brand-assets`, `npm run validate:review-sync-sqlite`, and `git diff --check` passed. Lint retained two pre-existing unused-parameter warnings in `apps/web/src/lib/event-service.test.ts`.
- A full unsigned Debug iOS Simulator build passed for the `Dayframe` workspace and scheme. The first attempt exposed stale local `node_modules` and a CocoaPods sandbox/lock mismatch; `npm install` and `npx pod-install` synchronized the installed graph to the checked-in npm/Pod locks before the successful build. Three generated CocoaPods checksum-only changes were excluded from the implementation diff.
- The database-backed Review validator was not run because `DATABASE_URL` is not configured in this workspace; its safety guard also requires a disposable database ending in `_test`.

A new internal build and the physical-iPhone matrix above remain release evidence, not repository-level validation.
