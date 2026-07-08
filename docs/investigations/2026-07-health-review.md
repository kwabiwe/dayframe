# 2026-07 Health Review Investigation

Status: active

## Current Symptoms

- High-confidence Apple Health walks remain in Review instead of auto-logging.
- Sleep appears broken into REM/Core/Deep fragments instead of one Sleep session.
- Earlier manual Confirm requests returned plain Vercel 500 responses.
- After follow-up fixes, KB still sees Health/Review issues on physical iPhone.

## Known Version State

- TestFlight app confirmed by KB: `0.1.0 (1)`.
- TestFlight build purpose: Health debug export and Health/Review validation.
- Production app: `https://dayframe-web.vercel.app`.
- PR #22 fixed manual Confirm structured errors and `review_status`.
- PR #23 fixed review lock contention, sleep stage consolidation repair logic, and added mobile Health debug export.

Before making any further fix, verify:

- PR #23 is merged into `main`.
- Vercel production is deployed from the merged commit.
- Supabase schema contains all Health/review columns used by deployed code.
- The physical iPhone app is using the expected production API base URL.

## Evidence Needed From Physical iPhone

- Screenshot of TestFlight Dayframe version/build.
- Screenshot of Review items showing one failed walk and one broken sleep example.
- Health debug export from `Settings -> Apple Health -> Export debug`.
- Review diagnostics after running Health reprocess.

Do not commit Health debug exports. Keep them local-only under `.codex-dayframe-qa/` or another ignored evidence folder.

## Hypotheses To Check

1. Production Vercel is not actually deployed from PR #23.
2. Supabase schema is missing a migration or column used by the deployed code.
3. Mobile Health debug/export build is installed, but normal import path uses stale anchors or preferences.
4. Walking is blocked by overlap or a stale open timer.
5. Sleep stages are imported as separate review items and not consolidated by the current repair path.
6. Review reprocess is still timing out, locking, or skipping rows in production.
7. Accepted/ignored review items are leaking back into visible Review.

## Root Cause Log

Add dated entries here as evidence is confirmed. Keep each entry short:

```text
YYYY-MM-DD HH:MM BST - Finding:
Evidence:
Decision:
```

## Fix Log

Track focused PRs only:

| PR | Scope | Status | Validation |
| --- | --- | --- | --- |
| #22 | Review Confirm/autolog structured errors | merged | tests and simulator |
| #23 | Review locks, sleep stage repair, Health debug export | merged/pending deploy verification | tests, TestFlight build 0.1.0 (1) |

## Closure Criteria

This investigation can close when:

- One real high-confidence walk auto-confirms or has a visible correct reason for staying in Review.
- One real sleep session is represented as a single Sleep entry or has a visible correct reason for staying in Review.
- Manual Confirm and Dismiss succeed or return structured JSON errors.
- Production Vercel logs show no unstructured 500s for the tested path.
- Tests cover the confirmed root cause.
- The relevant reference docs have been updated with any newly learned guardrail.
