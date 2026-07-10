# Health Review Pipeline

Use this when working on Apple Health import, Review, auto-log, Confirm, Dismiss, Calendar visibility, or Health diagnostics.

## Product Rule

Dayframe remains:

```text
task description/title
optional category
timer start/stop
review/edit later
```

HealthKit is an input signal, not a separate user-facing product model. Sleep stages and workout samples should become understandable Dayframe activities.

## End-To-End Flow

1. iPhone reads HealthKit samples in `apps/mobile/src/lib/health.ts`.
2. Mobile transforms samples into Dayframe activity event payloads.
3. Mobile submits events through the API client in `apps/mobile/src/lib/api.ts`.
4. Web API accepts events and stores `activity_events`.
5. Event processing in `apps/web/src/lib/event-service.ts` creates entries or `review_items`.
6. Review queries in `apps/web/src/lib/queries.ts` return open review items only.
7. Mobile Review screen in `apps/mobile/app/review.tsx` shows open items and calls Confirm/Dismiss endpoints.
8. Reprocess endpoint `apps/web/src/app/api/review/reprocess-health/route.ts` retries Health review decisions after preferences or code changes.

Do not patch one step without checking the adjacent step on either side.

Automatic Health sync needs both JS wiring and native launch wiring: after Health permission is granted, Dayframe should configure/enable background delivery for sleep and workouts, subscribe to observer changes while JS is running, and keep `BackgroundDeliveryManager.shared.setupBackgroundObservers()` in AppDelegate so cold-launch delivery works.

## Health Debug Export

TestFlight build `0.1.0 (1)` added a bounded Health debug export in Settings.

Expected path:

```text
Settings -> Apple Health -> Export debug
```

The export should include:

- API base URL
- Health import preferences
- stored anchor presence/counts
- recent sleep category samples
- grouped sleep sessions
- recent workouts
- generated Dayframe event payloads
- sample counts and compact summaries

The export must not advance HealthKit anchors and must not include route/location coordinates.

## Auto-Log Rules

Auto-log should be conservative and explainable.

Walking:

- Enabled by default.
- High-confidence walks at or above the configured threshold should auto-confirm.
- Current intended walking threshold is 5 minutes.

Sleep:

- Enabled by default.
- Plausible sleep should become a single Sleep entry/session, not REM/Core/Deep fragments.
- Confirmed sleep should use a user-facing `Sleep` category, creating it when needed. Workouts can keep using the broader `Health` category unless a user changes defaults later.
- Implausible, too short, too long, overlapping, or malformed sleep should stay in Review with a reason.

Strength training, swimming, and unknown/other workouts should remain review-first unless a product decision changes that.

## Manual Review Rules

Manual Confirm is a user decision. It should be more permissive than auto-log and must not silently fail.

Expected Confirm behaviour:

- create or reuse a completed time entry
- mark review item accepted
- mark linked activity event confirmed where appropriate
- remove item from visible Review
- return structured JSON on expected errors

Expected Dismiss behaviour:

- mark review item ignored
- remove item from visible Review
- create no time entry
- return structured JSON on expected errors

Review display guardrail:

- A review item without a valid start and end time is incomplete evidence, not a running timer. Do not render it with a duration that grows to "now", do not let it mark every later report window as active, and do not build an editable draft until both times are valid.

## Required Reason Codes

Health items left in Review should have a compact reason whenever possible:

- `below_threshold`
- `preference_disabled`
- `invalid_time_window`
- `missing_end_time`
- `overlap`
- `stale_open_timer`
- `duplicate_event`
- `locked_or_busy`
- `database_constraint`
- `unsupported_workout_type`
- `implausible_sleep`

If a reason is not visible in UI, it should at least be present in diagnostics or logs.

## Known Failure Modes To Check

- TestFlight build points at the wrong API base.
- Vercel production is not deployed from the expected commit.
- Supabase schema is missing columns used by the deployed code.
- Review reprocess and manual Confirm contend on the same review rows.
- Health sample preferences are off or defaults are not applied.
- A stale open `time_entries` row with `stopped_at is null` overlaps everything.
- Sleep stages are imported independently and never consolidated.
- Already-created Sleep/Health entries can cover sibling Health review rows; those covered rows should be accepted, not left open as overlaps.
- High-confidence walks stay open because overlap detection is correct but invisible.
- Accepted/ignored review items leak back into Review due to query or mobile filtering.
- Reprocess keeps reselecting the same open-but-explained Review items and never reaches later eligible Health rows.
- Incomplete old Health review items show misleading multi-day durations because the mobile UI treats missing stop times as "now".
- Large historical Health backlogs should not be drained entirely from the mobile Review screen. Use bounded batches for interactive reprocess, and use a reviewed server/database cleanup for old rows that can be proven ignored or already covered.

## Minimal Investigation Checklist

For one failed walk and one broken sleep session, collect:

- TestFlight version/build and API base URL.
- Health debug export.
- Review card screenshot.
- Vercel logs for related `/api/events`, `/api/review`, and `/api/review/reprocess-health` requests.
- Database rows for linked `activity_events`, `review_items`, and `time_entries`.
- Import preferences for walking and sleep.
- Any open timer with `stopped_at is null`.
