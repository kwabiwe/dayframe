# Location finalisation without a later sample

Date: 2026-08-11

## Report and root cause

Dayframe stopped surfacing some otherwise supported commutes after the final location sample. The shared engine intentionally waits ten minutes before finalising a closed segment, but canonical server replay ran only inside `POST /api/location/evidence`. If no later evidence batch arrived after that lag, server processing time never advanced and the segment could remain closed without producing its event-first Review result.

Two hypotheses were checked before implementation:

1. commute qualification rejected the journey; deterministic fixtures and retained segment state would show a stable rejected/low-confidence result;
2. the journey qualified but the server never replayed after the finalisation lag; a later replay using the same retained evidence and a newer processing time would finalise it.

The second path is present in the runtime: mobile returned successfully when no upload batch existed, and the server had no authenticated replay command independent of ingest. This PR fixes that scheduling gap without changing commute thresholds, rollout policy, or automatic-write eligibility.

## Implementation contract

- `POST /api/location/replay` accepts only device/version/rollout acknowledgement metadata and uses server time.
- Ingest and explicit replay share the same owner advisory lock, deterministic replay, semantic cutover, emitter, transaction, and idempotency path.
- Responses and logs contain high-level counts only; no coordinates, routes, place addresses, or evidence payloads are returned or logged.
- Mobile reprocesses the complete local journal with current time even when no native signal was drained.
- One pass drains at most five native chunks of 100 signals and uploads at most five batches. Permanent invalid batches do not block later evidence; resize/retry/auth failures stop the pass.
- Foreground requests force one coalesced server replay. Ordinary bootstrap-driven replay is bounded to once every five minutes unless evidence was uploaded.
- Separate Settings diagnostics record last replay time/status/version and finalised/semantic counts.

No database migration, product-policy change, new permission, rollout-mode change, or production-data cleanup is included.

## Motion contract

- Trigger: opening the existing Location Privacy & troubleshooting disclosure or refreshing its diagnostics.
- Owner: the existing Settings disclosure Reanimated presence/layout owner.
- Entrance/update/exit: this PR adds one static diagnostic line inside the existing disclosure; it does not add another transition or change surrounding card geometry.
- Interruption and async outcome: replay runs without a loading row or spinner. Existing status refresh replaces text after completion; failure remains in exported diagnostics and does not move the screen.
- Accessibility: the diagnostic is normal readable text. Existing Reduce Motion, Dynamic Type, and VoiceOver behavior remains authoritative.

## Validation evidence

Completed during implementation:

- shared replay-schema tests: 2 passed;
- web replay-route tests: 4 passed;
- mobile runtime/upload/source-contract tests: 12 passed;
- shared, web, and mobile focused typechecks passed after locked dependency installation;
- Location V2 SQLite validator passed;
- disposable PostGIS validator passed, including no-new-evidence finalisation and repeated-replay idempotency;
- repository lint (including documentation and iOS configuration), all workspace typechecks, 1,536 tests, production web build, brand-asset contract, and diff checks passed.

Still required for staging validation:

- Ready Vercel Preview against staging and stable-alias promotion;
- EAS preview installation on the selected iPhone 11, staging badge/API verification, and one bounded zero-upload foreground replay smoke test.

Production rollout mode, TestFlight, real-journey completion, battery measurement, and broad lifecycle matrices are outside this PR and must be recorded as `NOT RUN` unless explicitly performed.
