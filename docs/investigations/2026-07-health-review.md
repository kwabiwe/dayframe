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
| #25 | Health reprocess batching | merged/deployed at `80e1bdb` | tests, TestFlight build 0.1.0 (2) |

## 2026-07-08 Follow-Up From TestFlight Build 0.1.0 (2)

Evidence:

- KB screenshots show production API `https://dayframe-web.vercel.app`.
- Vercel production deployment for `dayframe-web.vercel.app` is from `main` commit `80e1bdb`, created 2026-07-08 14:48 BST.
- Vercel logs around 16:35-16:40 BST show repeated `POST /api/review/reprocess-health` responses with status `207`.
- Review diagnostics on the phone show `remaining 1443`, `partial`, and repeated `Left in Review: sleep duration is outside the auto-log range.`
- Manual Review actions are reaching `200`, but the mobile list can still show a stale card long enough for a second tap to trigger the "already resolved" pop-up.
- Places screenshot shows place name `Kids' school` and default activity description `School run`, while an existing review card still displays `Kids' school` as the activity title.

Findings:

- Health reprocess was repeatedly selecting the same open rows that were already left in Review with a reason. Because those rows stay open by design, they could block later eligible walks and sleep groups from being reached in the mobile drain loop.
- Legacy sleep stage consolidation only saw the rows in the current small batch, so fragmented sleep could stay fragmented when a complete sleep group was not present in that batch.
- The Review screen removes rows only after a refresh, but `load()` can no-op while another refresh/reprocess is in flight. That makes already accepted/ignored items remain tappable in local state.
- Place visit review titles and Confirm descriptions came from the stored review item title. Existing rows created before or around a place default description edit did not pick up the latest default activity description.

Decision:

- Create `codex/fix-review-stale-and-health-drain`.
- Prioritize unprocessed/eligible Health rows and stop reporting `hasMore` once the remaining open rows already have visible "Left in Review" reasons.
- Load a wider set of legacy sleep rows for consolidation so sleep stages can become one Sleep entry.
- Treat already-resolved Review actions as idempotent success.
- Optimistically remove resolved review cards on mobile before the refresh completes.
- Use the current place default activity description for geofence Review display and Confirm description.

## Closure Criteria

This investigation can close when:

- One real high-confidence walk auto-confirms or has a visible correct reason for staying in Review.
- One real sleep session is represented as a single Sleep entry or has a visible correct reason for staying in Review.
- Manual Confirm and Dismiss succeed or return structured JSON errors.
- Production Vercel logs show no unstructured 500s for the tested path.
- Tests cover the confirmed root cause.
- The relevant reference docs have been updated with any newly learned guardrail.
