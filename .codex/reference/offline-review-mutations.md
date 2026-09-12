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

## SQLite v6 recovery metadata

The additive v5→v6 migration records contention count, reconciliation attempts/time, resolution status, and the validated acknowledgement without changing original UUIDs, request hashes/payloads, creation order, or source anchors. An `in_flight` row found on open becomes pending with `delivery_interrupted`; it is not treated as either failed or applied.

Before retrying an interrupted, old, repeatedly contended, or explicit-attention mutation, mobile calls the authenticated read-only `/api/review/mutations/reconcile` proof route. Only an exact envelope-matching receipt/effect result may acknowledge the saved intent. An open result permits the same original request to retry; missing, conflicting, malformed, or still-unknown proof remains actionable without inventing success. `resolution_unknown` offers reconciliation and cannot be discarded as a known permanent failure.

## SQLite v7 presentation evidence

V7 extends this same owner with additive, account/backend-bound Review
presentation contexts and terminal-source evidence. The context stores only
strictly whitelisted display/count/lineage data from the bounded
`/api/review/presentation` read; it is not a new queue, canonical entry store,
or substitute for the Location Evidence cache. Scope includes the exact mode,
zone/range or lookup IDs and backend identity. Older contexts and ordinary
bootstrap arrays are partial open-source evidence: absence never prunes a
saved action, acknowledgement, effect, or map evidence.

An acknowledged envelope may retire only in one SQLite transaction after valid
receipt identity, explicit terminal evidence for every affected source, and
current canonical proof for every returned entry ID (materialised in the
existing Dashboard cache or explicitly `missing`). A receipt is not a
canonical interval. Until that handover completes, a Today row can say saved
locally and leave pending accounting, but it must not fabricate or double-count
logged time. Context pruning/byte budgets may remove disposable display data
only; they never delete unresolved envelopes/effects or change the independent
Location Evidence TTL/LRU policy.

An equivalent generic accept/confirm may have no entry ID in its valid receipt.
Its foreground presentation reader must first look up every affected source as
one bounded action, then follow only an explicit accepted source-to-entry link
from that scoped canonical response in a second bounded entry lookup. It must
not infer an entry from time, title, category, position, or a missing bootstrap
row. Keep all structural sources together; a merge/split receipt with a known
no-entry outcome does not justify inventing one, while any returned entry still
needs current Dashboard-cache or explicit-`missing` proof before retirement.

## Synchronisation and rollback

- Keep one serial mutation queue, one drain promise and the existing root reconnect coordinator. Review stays foreground-only and never acquires the finite timer background assertion.
- Recover stale `in_flight` as interrupted on database open; preserve created order and bounded retry/backoff. Stop after network/408/429/5xx/lock contention; proven permanent errors become `needs_attention` and allow later work.
- Revalidate account and authenticated session generation/token before dispatch. Session expiry preserves intent for the same account; logout/replacement clears only its account-owned state after the existing warning.
- Acknowledgement retains all hidden effects until a later canonical bootstrap proves every source is no longer open.
- Permanent conflicts restore only source IDs individually proven open by scoped canonical server statuses. Unknown, accepted, ignored or missing sources stay hidden; restoration uses surviving anchors. A legacy `canonicalStatus=open` proves only the primary source.
- Discard removes an unproven hidden source's stale cache snapshot before deleting its effect, so it cannot resurrect a resolved card. Later canonical refresh may reintroduce an actually open item.

## Server and privacy

Receipt lookup, exact Review/event/segment locks, every place/feedback/entry/tag/child/supersession side effect and the receipt share one Postgres transaction. Receipt identity includes account, UUID, primary Review ID, action and full canonical request hash. Same-ID replay returns the stored result, including child/merged/entry IDs, before reapplying anything. Different-ID equivalence is accepted only when all requested effects can be proved; complex ambiguous outcomes return conflict. Structural mutations share the Location replay owner lock. Preserve nonblocking contention and 8-second statement/1.5-second lock deadlines. Conflict status is read after rollback under a bounded, scoped read.

Store only required private intent and presentation. Save-place requests necessarily retain selected name, coordinates, radius and edits; record-POI-once retains only the trimmed name and edits. No raw Apple response, HealthKit payload, bearer token or upload journal copy belongs in this outbox. Location Evidence DTO coordinates have their separate bounded cache owner. Diagnostics expose action/state/count/timing only, never request JSON, names, descriptions or coordinates.

## Required evidence

Run shared/web/mobile suites, both Review validators and both Location validators, full lint/typecheck/test/build/docs/brand/diff gates and a clean native build. The Review SQLite validator executes real store transactions, v4→v5→v6 migration, two-source rollback/restore/acknowledgement, interrupted-delivery reconciliation, and account tests. Complete the physical staging matrix in `docs/dayframe-regression-checklist.md`; unit/Simulator results do not establish iPhone force-quit, background, network or navigation behaviour.
