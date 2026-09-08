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

Current implementation contract:

- Foreground sync, HealthKit observer callbacks, and AppDelegate background-delivery setup cover sleep/workout changes; real-device background delivery remains under Watch.
- Apple Health settings own sleep/workout category and description defaults, and both new imports and Review reprocess apply them.
- Sleep routes to a user-facing `Sleep` category by default; workouts remain under `Health` unless the user changes the mapping.
- Grouped Sleep imports reconcile same-source revisions into one logical untouched Health-derived entry. Historical duplicate rows still require row-level production evidence before any merge/delete cleanup.

## Health Debug Export

Dayframe includes a bounded Health debug export in Settings for evidence-led investigation of Health sync, backlog, and mapping behavior.

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
- `medium_high`/`high` walks at or above the configured threshold should auto-confirm, including during overlapping tracked time.
- Current intended walking threshold is 5 minutes.

Sleep:

- Enabled by default.
- Plausible sleep should become a single Sleep entry/session, not REM/Core/Deep fragments.
- Group sleep samples independently per normalized Health source. Samples whose waking gap is at most 90 minutes belong to one session; a gap greater than 90 minutes preserves split sleep.
- A grouped Health sleep import is the same logical session as one existing untouched Health-derived Sleep entry only when the provider/source identity matches and at least 80% of the shorter time window overlaps. The 80% rule is deliberately stricter than the one-minute UI/report overlap rule: contained or extended Health revisions reconcile, while partial collisions remain ambiguous.
- Reconciliation updates the existing entry in place to the union of the valid windows. It must preserve the entry id, category, description, tags, place, original event provenance, and all other user metadata. Repeated and out-of-order imports must neither shrink the most complete window nor create another entry.
- Never reconcile into manual entries. Eligible Sleep may coexist with manual time without changing it. Explicitly edited imported Sleep, different-source/weak logical collisions, and multiple matching historical Sleep entries remain Review-first. Acquire the per-user lock before session lookup and creation/update.
- Confirmed sleep should use a user-facing `Sleep` category, creating it when needed. Workouts can keep using the broader `Health` category unless a user changes defaults later.
- User mapping defaults can override category and description for supported sleep/workout imports and for Health Review reprocess.
- Implausible, too short, too long, malformed or unsafe logical-session Sleep collisions stay in Review. Ordinary activity overlap is not a blocker.

Strength training, swimming and other/unknown remain disabled by default. An explicitly enabled supported type, including swimming, may auto-log with a complete valid window, normal confidence and existing duration thresholds. Disabled preferences retain their existing ignore/review behaviour.

## Manual Review Rules

Manual Confirm is a user decision. It should be more permissive than auto-log and must not silently fail.

Ordinary overlap must block neither eligible automatic Health logging nor the user's explicit Confirm or Edit-and-confirm. The confirmed activity
counts in full towards Total logged while concurrent clock time counts once
towards Time covered. Health sample/event idempotency remains independent from
logical sleep-session reconciliation.

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
- `unsafe_sleep_session`
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
- A presentation timeout, focus-generation change, or still-running server reprocess must never leave Health Review controls disabled. Manual durable actions remain available and retry safely if the server row is briefly locked.
- Health sample preferences are off or defaults are not applied.
- A stale open timer must not block eligible Health or be changed by Health import.
- Sleep stages are imported independently and never consolidated.
- Same-source untouched Sleep coverage can accept sibling legacy stages. An unrelated workout occupying the same window is not proof of duplicate sample identity.
- Eligible `medium_high`/`high` workouts must not stay open solely because other time is logged.
- Health mapping defaults are absent, stale, or not applied consistently between new imports and reprocess.
- Duplicate or overlapping Sleep entries may come from HealthKit revisions, legacy rows, or old Review confirmations. Verify source identity, event provenance, `user_edited_at`, and all matching rows before cleanup; multiple matches must remain ambiguous.
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

## Recovery and provenance guardrails

Interactive reprocess has a six-second request budget, at most 25 candidate IDs, a returned cursor, and one transaction per complete bounded logical unit. Pass the cursor to reach later candidates; an end-of-scan result is distinct from an empty Review inbox. Never split a legacy Sleep group merely to meet the page limit. Category maintenance runs in a separate bounded transaction. Counters describe committed effects, and unavailable remaining counts stay unknown.

New logical Sleep resolutions record `activity_events.resolved_time_entry_id` while preserving the existing entry and user metadata. Apply the additive resolution-link migration before the new server; do not infer or backfill historical provenance. SQL cancellation is not evidence of a Review-row lock, and an empty later lock snapshot cannot identify a historical blocker. Code tests, queue counts and hidden cards do not close a reported missing-record incident; trace exact source/event/receipt/entry identities through server and mobile visibility.

### Bounded source ingestion

Health ingestion uses the narrow sync transaction policy from the initial receipt read and normalisation context through owner lock, event, Review/entry and source-row persistence. It shares one finite operation budget and checked-out client; SQL or request cancellation rolls back the complete event-first unit. Same-ID duplicate recovery after a competing transaction uses a fresh bounded receipt read. Validate with `DATABASE_URL` pointing to a disposable local `*_test` database and `npx tsx scripts/validate-health-ingest-bounds.ts`; staging smoke testing remains a separate release gate.
