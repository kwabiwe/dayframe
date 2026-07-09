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
| #26 | Review stale list, Health drain, geofence description | merged/deployed | tests, TestFlight build 0.1.0 (3) |
| #27 | Health review backlog drain | merged/deployed | targeted tests, TestFlight build 0.1.0 (4) |
| #28 | Mobile API fallback startup crash | merged/deployed | targeted tests, TestFlight build 0.1.0 (5) |
| #29 | Health reprocess timeout and legacy sleep backlog | merged/deployed | production DB cleanup, tests, TestFlight build 0.1.0 (6) |

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

## 2026-07-08 Follow-Up From Debug Export 0002

Evidence:

- KB screenshots show Review diagnostics on production API `https://dayframe-web.vercel.app` with `remaining 1309`, `batch 12`, repeated `Left in Review: overlaps existing timer "Sleep".`, and intermittent `timed_out`.
- Vercel production logs for the active deployment show repeated `POST /api/review/reprocess-health` responses with status `207`, manual Review actions mostly `200`, and a `409` Review action while reprocess was running.
- Health debug export `0002` shows preferences enabled for Sleep and Walking, generated sleep sessions, and 12 walking workouts that meet the 5-minute high-confidence auto-confirm criteria.

Findings:

- The production issue is not caused by disabled Health preferences or missing eligible HealthKit data.
- The forced reprocess ordering made rows with existing `Left in Review` notes sort to the front, so a forced drain could revisit the same Sleep-overlap rows repeatedly and starve later eligible walks/sleep rows.
- Existing confirmed Sleep/Health time entries were treated as overlap blockers for sibling review rows instead of proof that those review rows were already covered and should be accepted.
- Mobile Review focus/Confirm reloads could start another reprocess while a user action was in progress, matching the production `409` lock responses and stale list/popup behaviour.

Decision:

- Create `codex/fix-health-review-backlog-drain`.
- Keep unexplained Health review rows first even during forced reprocess.
- Treat open Health review rows covered by an existing confirmed Health/Sleep entry as accepted instead of left in Review as overlaps.
- Increase mobile Health reprocess batch size from 12 to 25.
- Skip background reprocess on normal Review focus/Confirm/Edit reloads; keep forced reprocess for initial load and pull-to-refresh.

## 2026-07-08 Follow-Up From Debug Export 0003 And Build 0.1.0 (5)

Evidence:

- KB screenshots from build `0.1.0 (5)` show production API `https://dayframe-web.vercel.app`, Review count `100`, `partial` reprocess with `confirmed 18`, `ignored 11`, `remaining 1120`, `batch 25`, and later `timed_out`.
- Vercel production logs around 21:01-21:11 BST show four `POST /api/review/reprocess-health` requests returning `207`; no `500` or `504` was observed for the same window.
- Debug export `0003` shows Sleep and Walking preferences enabled, stable grouped sleep session events, 6 generated sleep sessions, and 13 generated walking workout events. Most generated walks have `autoConfirm: true`.
- The same export shows 100 recent sleep samples grouped into sessions, including `awake` samples that should not become user-facing Sleep entries.

Findings:

- The timeout is likely mobile/client-side while draining partial 207 batches, not a Vercel hard timeout. The Review screen had a 15s wrapper timeout while `health.ts` can legitimately run multiple production API batches.
- Current mobile export groups sleep sessions correctly, so visible `Sleep asleep core` / `Sleep awake` cards are likely old per-stage database review rows rather than newly generated grouped sleep events.
- Legacy sleep consolidation fetched up to 300 extra rows per API call and did not retire `awake` / `in_bed` rows unless those rows also happened to be in the main reprocess batch.
- Covered legacy sleep fragments can still be reported as overlapping an existing `Sleep` timer when the existing entry is a Health-category Sleep entry but not sourced as `health_sleep`, because the covered-entry lookup used the fragment title such as `Sleep asleep core`.

Decision:

- Create `codex/fix-health-reprocess-timeout-and-legacy-sleep`.
- Retire legacy `awake` / `in_bed` sleep stage review rows as ignored during consolidation.
- Normalize sleep-fragment coverage checks to title `Sleep` so covered legacy fragments are accepted instead of left as overlap.
- Reduce the legacy consolidation fetch size and extend mobile reprocess timeout bounds so Review does not false-timeout while bounded work is still progressing.
- Add a Supabase migration with reprocess lookup indexes and a safe one-time cleanup for historical sleep-stage rows already covered by confirmed Sleep entries.

## Closure Criteria

This investigation can close when:

- One real high-confidence walk auto-confirms or has a visible correct reason for staying in Review.
- One real sleep session is represented as a single Sleep entry or has a visible correct reason for staying in Review.
- Manual Confirm and Dismiss succeed or return structured JSON errors.
- Production Vercel logs show no unstructured 500s for the tested path.
- Tests cover the confirmed root cause.
- The relevant reference docs have been updated with any newly learned guardrail.

## 2026-07-09 Build 6 Follow-Up

Evidence:

- KB reported Dayframe is working better and the queued Review items cleared after using build `0.1.0 (6)`.
- Production database check after the screenshots showed `0` open `review_items`; historical Health review rows were accepted or ignored.
- Screenshots still showed stale legacy Sleep stage cards such as `Sleep asleep rem` with a `775h` duration and `Left in Review: sleep duration is outside the auto-log range.`

Findings:

- The remaining visible problem was not a current production backlog. It was a mobile presentation issue for incomplete suggestions: if a review item lacked `suggestedStoppedAt`, mobile calculated duration from `suggestedStartedAt` to `now`, making old malformed sleep fragments look like enormous activities.
- Incomplete review suggestions could also mark later report windows as needing review because they were treated like running entries.

Decision:

- Patch mobile review helpers so review-item duration requires a valid start and stop, and incomplete suggestions only count inside the day they start.
- Add a rule-draft assistant as the first AI/rules feature slice: natural-language rule requests become structured evidence checks and simulation checks before any auto-write path exists.
