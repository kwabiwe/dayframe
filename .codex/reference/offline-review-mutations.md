# Offline Review Mutation Guardrail

Use this for mobile Review resolving and structural actions. Signal capture stays event-first; Review does not replace the timer queues or Location journal.

## Ownership and local acknowledgement

`reviewSyncStore.ts` exclusively owns downloaded Review presentation, durable intent, retry state and account lifecycle. React projects that owner; Postgres owns canonical Review, entries, places and corrections.

All resolving/structural Location actions use the strict shared envelope: `confirm`, `ignore_once_location`, complete `edit_and_confirm`, `change_place_and_confirm`, `record_once`, `record_poi_once`, `save_place_and_confirm`, `split`, `split_and_confirm`, `merge`, `merge_and_confirm`. Generic accept/ignore remain supported. Pure `change_place` remains a direct compatibility action, not the normal confirmation flow.

Generate one UUID and validate the full canonical request. In one exclusive SQLite transaction, verify the active account, every affected source's open cached state and complete time window, absence of conflicting outbox ownership, and then write one request plus all source effects. Merge reserves two distinct source IDs with independent snapshots, positions and preceding/following anchors. Missing adjacent data fails visibly; never hide only the current source.

Only successful local commit permits card removal or native detail dismissal. Duplicate taps are gated during commit. Do not await HTTP or show normal mutation spinners. SQLite failure preserves every source and the exact draft. Split/merge children come from canonical refresh, not fabricated optimistic entries. Save-place catalogue refresh uses the existing coordinator/final bootstrap.

## SQLite v5

The additive v4→v5 transaction creates `review_mutation_effects`, keyed by mutation/source ID and unique by account/source ID. A composite foreign key ties each effect to its mutation's account; deletion cascades. Every existing outbox row backfills one effect with its snapshot, anchors and hidden/restored state. Compatibility columns remain, no pending row is evicted, and `user_version` advances only after commit. Malformed cached presentation fails safely; pending requests are never silently dropped. Evidence retains its independent seven-day/25-item/5-MiB cache policy.

Same UUID, primary source and canonical payload is idempotent; any changed request or a second owner of either merge source fails without a partial write. Do not downgrade a binary while complex work is pending: an older binary does not understand two-source effects. Drain or explicitly resolve pending work with a compatible build first.

## Synchronisation and rollback

- Keep one serial mutation queue, one drain promise and the existing root reconnect coordinator. Review stays foreground-only and never acquires the finite timer background assertion.
- Recover stale `in_flight` on database open; preserve created order and bounded retry/backoff. Stop after network/408/429/5xx/lock contention; permanent errors become `needs_attention` and allow later work.
- Revalidate account and authenticated session generation/token before dispatch. Session expiry preserves intent for the same account; logout/replacement clears only its account-owned state after the existing warning.
- Acknowledgement retains all hidden effects until a later canonical bootstrap proves every source is no longer open.
- Permanent conflicts restore only source IDs individually proven open by scoped canonical server statuses. Unknown, accepted, ignored or missing sources stay hidden; restoration uses surviving anchors. A legacy `canonicalStatus=open` proves only the primary source.
- Discard removes an unproven hidden source's stale cache snapshot before deleting its effect, so it cannot resurrect a resolved card. Later canonical refresh may reintroduce an actually open item.

## Server and privacy

Receipt lookup, exact Review/event/segment locks, every place/feedback/entry/tag/child/supersession side effect and the receipt share one Postgres transaction. Receipt identity includes account, UUID, primary Review ID, action and full canonical request hash. Same-ID replay returns the stored result, including child/merged/entry IDs, before reapplying anything. Different-ID equivalence is accepted only when all requested effects can be proved; complex ambiguous outcomes return conflict. Structural mutations share the Location replay owner lock. Preserve nonblocking contention and 8-second statement/1.5-second lock deadlines. Conflict status is read after rollback under a bounded, scoped read.

Store only required private intent and presentation. Save-place requests necessarily retain selected name, coordinates, radius and edits; record-POI-once retains only the trimmed name and edits. No raw Apple response, HealthKit payload, bearer token or upload journal copy belongs in this outbox. Location Evidence DTO coordinates have their separate bounded cache owner. Diagnostics expose action/state/count/timing only, never request JSON, names, descriptions or coordinates.

## Required evidence

Run shared/web/mobile suites, both Review validators and both Location validators, full lint/typecheck/test/build/docs/brand/diff gates and a clean native build. The Review SQLite validator executes real store transactions, v4 backfill, two-source rollback/restore/acknowledgement and account tests. Complete the physical staging matrix in `docs/dayframe-regression-checklist.md`; unit/Simulator results do not establish iPhone force-quit, background, network or navigation behaviour.
