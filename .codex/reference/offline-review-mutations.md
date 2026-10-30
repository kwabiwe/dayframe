# Offline Review Mutation Guardrail

Use this for mobile Review resolving and structural actions. Signal capture stays event-first; Review does not replace the timer queues or Location journal.

## Ownership and local acknowledgement

`reviewSyncStore.ts` exclusively owns downloaded Review presentation, durable intent, retry state and account lifecycle. React projects that owner; Postgres owns canonical Review, entries, places and corrections.

All resolving/structural Location actions use the strict shared envelope: `confirm`, `ignore_once_location`, complete `edit_and_confirm`, `change_place_and_confirm`, `record_once`, `record_poi_once`, `save_place_and_confirm`, `split`, `split_and_confirm`, `merge`, `merge_and_confirm`, and for one card per outing `confirm_outing` and `ignore_outing`. `confirm_outing` takes an optional `venue` (`{ name, applePlaceId }`, "Visited {name}?" on an outing's unknown Stay): sent on the Stay's card, it records the Stay exactly as `record_poi_once` does (a one-time name and the Apple Place ID, never a saved place or a rule; with an activity, only the time the person's own blocks leave free, so its acknowledgement carries each Move's block and any number of the Stay's), the Moves log after it as they always did, a retry with the same venue is the same answer, and another venue, or none, is a conflict. The iPhone's handover of an equivalent venue outing waits for each Move's block but not the Stay's, which may rightly have none. Generic accept/ignore remain supported. Pure `change_place` remains a direct compatibility action, not the normal confirmation flow. `save_place` ("Save this place", PRD D19, design §7) is in the shared envelope but leaves its card open: it is acknowledged by `status: "open"` with a `placeId` (`validReviewAcknowledgement`), and reconciliation reports a conflict once its card was decided. On iPhone (location v3 PR 9b) a `save_place` row owns no source effect, so its card stays shown, titled by the place being saved in Calendar › List and on Today (`pendingSavedPlaceNames` over the bootstrap projections and `readReviewPresentationSnapshot`; any state but needs_attention), and its own later decision can follow: SQLite v9 makes the one-row-per-card index partial (every action but `save_place`) and keeps one `save_place` per card in a second partial index. A confirmation saved behind a save still going through is stored as the explicit `edit_and_confirm` of what the person saw (the card's times and the activity the save gives it) instead of its proposal hash, which the save is about to change; behind a rejected save it stays as it was. A decision is never sent while an earlier save of any of its cards is unresolved (pending, backing off or needing attention), whatever a pass selected, so a parked save holds its card's decision until it is retried or discarded. An acknowledged save keeps its row, and with it the card's saved name and place id, until server Review data (bootstrap or presentation) shows that card with a place or decided; handover lookups and materialisation ignore save rows. Places and geofences refresh with every bootstrap that lands (`refreshLocationServices`). A rejected save shows in Sync help and its Discard removes only the row, never the card. One card per outing (PRD D19) adds `confirm_outing` and `ignore_outing` (sent on the unknown Stay's card with `memberReviewItemIds`, the Move cards folded into it; `edit` applies to the Stay only): the server locks every member in id order and decides all of them in one transaction, or none (`resolution_conflict`) when a member changed outing or was decided on its own; the receipt is the Stay card's, and `affectedReviewIds` covers every member for recovery and reconciliation. On iPhone (PR 12b; since location v4 step 15 Calendar › List's answers, `useCalendarCheckAnswers.ts`) an outing is saved as one outbox row on the Stay's card whose effects hide every member (`affectedItems`, like a merge); its acknowledgement needs every member (`reviewItemIds`, and an `entryIds` block each unless already resolved equivalently, which, like an equivalent confirm, hands over only once the server links each accepted member to its block). A refused outing saved nothing, so it settles whatever its Stay's status once the server reports every member's status (`reviewResolvedElsewhere` with `outing`): decided members leave, open ones come back as cards of their own, and nothing waits for Retry or Discard; a re-check that finds a member missing or decided differently re-sends the original, whose answer settles it. Backlog presentation records carry `outing` (key and role) only for clients sending the `outing` feature; the cache keeps `outingKey` and `outingRole` (opaque ids), and a presentation listing a card in no outing clears an outing an earlier read cached.

Generate one UUID and validate the full canonical request. In one exclusive SQLite transaction, verify the active account, every affected source's open cached state and complete time window, absence of conflicting outbox ownership, and then write one request plus all source effects. Merge reserves two distinct source IDs with independent snapshots, positions and preceding/following anchors. Missing adjacent data fails visibly; never hide only the current source.

Only successful local commit permits card removal or native detail dismissal. Duplicate taps are gated during commit. Do not await HTTP or show normal mutation spinners. SQLite failure preserves every source and the exact draft. Split/merge children come from canonical refresh, not fabricated optimistic entries. Save-place catalogue refresh uses the existing coordinator/final bootstrap.

## SQLite v5

The additive v4→v5 transaction creates `review_mutation_effects`, keyed by mutation/source ID and unique by account/source ID. A composite foreign key ties each effect to its mutation's account; deletion cascades. Every existing outbox row backfills one effect with its snapshot, anchors and hidden/restored state. Compatibility columns remain, no pending row is evicted, and `user_version` advances only after commit. Malformed cached presentation fails safely; pending requests are never silently dropped. Evidence retains its independent seven-day/25-item/5-MiB cache policy.

Same UUID, primary source and canonical payload is idempotent; any changed request or a second owner of either merge source fails without a partial write. Do not downgrade a binary while complex work is pending: an older binary does not understand two-source effects. Nor while a `save_place` is pending or acknowledged: an older binary cannot open the v9 database's partial indexes as it expects, treats a row without effects as never handed over, would send a card's decision before its save, and does not accept the save's open acknowledgement. Drain or explicitly resolve pending work with a compatible build first.

## SQLite v6 recovery metadata

The additive v5→v6 migration records contention count, reconciliation attempts/time, resolution status, and the validated acknowledgement without changing original UUIDs, request hashes/payloads, creation order, or source anchors. An `in_flight` row found on open becomes pending with `delivery_interrupted`; it is not treated as either failed or applied.

Before retrying an interrupted, old, repeatedly contended, or explicit-attention mutation, mobile calls the authenticated read-only `/api/review/mutations/reconcile` proof route. Only an exact envelope-matching receipt/effect result may acknowledge the saved intent. An open result permits the same original request to retry. A `missing` result, or a `conflict` with reason `different_final_decision`, means the moment was decided elsewhere (another device, or location replay superseding it): the intent settles quietly (below). A `mutation_id_conflict`, malformed or still-unknown proof remains actionable without inventing success. `resolution_unknown` offers reconciliation and cannot be discarded as a known permanent failure.

## SQLite v7 presentation evidence

V7 extends this same owner with additive, account/backend-bound Review
presentation contexts and terminal-source evidence. The context stores only
strictly whitelisted display/count/lineage data from the bounded
`/api/review/presentation` read; it is not a new queue, canonical entry store,
or substitute for the Location Evidence cache. Scope includes the exact mode,
zone/range or lookup IDs and backend identity. Older contexts and ordinary
bootstrap arrays are partial open-source evidence: absence never prunes a
saved action, acknowledgement, effect, or map evidence.

Terminal-source evidence is read only when both account and backend identity
match. `missing_review` is a typed lookup result, not a Review-record status;
it may record terminal `missing` evidence. Only an explicit same-backend
`open` Review record with a strictly later server `capturedAt` may clear that
suppression. A delayed or equal-age response must not resurrect a terminal
source.

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
- A moment decided elsewhere is not a rejection (12 Oct 2026 investigation; web already drops these quietly). It settles only when the server proves the primary source accepted, ignored or missing and reports every source's status: a 409 `resolution_conflict`, a 404 `review_item_not_found` (its `canonicalReviewStatuses` first; without them only a single-source 404 proves the primary missing), or a single-source reconcile `missing` / `conflict` with reason `different_final_decision`. Settling deletes the outbox row and its effects in one transaction; each source proven accepted, ignored or missing leaves the cache and gets terminal evidence at the server's time (a reconcile `checkedAt`, or the response `Date` rounded up to the end of its second), unless a cached read captured later still lists it open, which wins. The settle is counted (`settledElsewhereCount`) and never listed in Sync help. Sources reported open are not retired, so only those cards return. SQLite v8 records each source's latest open observation (the server `capturedAt` of any same-backend presentation read listing it open, `review_source_open_observation`); terminal evidence is in force only while no strictly newer open observation exists, so arrival order, delayed lookups and context pruning cannot hide a reopened source or show a decided one. Terminal evidence only moves forward in time; Today's cached snapshot drops sources with in-force terminal evidence at or after its capture (`withNewerTerminalEvidence`) and restored cards whose source is closed. An open or unreported primary (`proposal_changed`, an existing entry that differs) remains a real rejection with its saved action, as does a two-source reconcile proof, a validation rejection or a `mutation_id_conflict`. Rows an older build parked as `resolution_conflict`/`canonical_missing` are re-checked once each.
- Every presentation read carries the complete open set (`outstanding.openReviewItemIds`, with `completeness.outstandingCounts`) from a snapshot taken after the request arrived. `cacheReviewPresentation` evicts cached items written before the request (client clock, recorded by the presentation client) that the set no longer lists, and gives them, and any restored rejection card it no longer lists, terminal evidence at the read's `capturedAt`. Like all terminal evidence it is in force only until a strictly newer same-backend read lists the source open, so a delayed older open response or an older cached Today snapshot cannot bring the card back, while replay reopening it does. Hidden local decisions and items cached after the request started are untouched. Without this, superseded items stayed open on iPhone forever (investigation 2026-10-12).
- The iPhone Review screen and its card deck are gone (location v4 step 15, #615); every "?" is answered inline in Calendar › List through this same outbox. The List, the Calendar badge and Today's chip take the bootstrap's open items and, once that list is at its cap, Today's cached scoped presentation window (`readReviewPresentationSnapshot`), less the sources this phone decided (`readSuppressedReviewItemIds`), re-read on every store change (`subscribeReviewSync`). A presentation write keeps the reason fields an earlier bootstrap cached for the same proposal.
- Discard removes an unproven hidden source's stale cache snapshot before deleting its effect, so it cannot resurrect a resolved card. Later canonical refresh may reintroduce an actually open item.

## Server and privacy

Receipt lookup, exact Review/event/segment locks, every place/feedback/entry/tag/child/supersession side effect and the receipt share one Postgres transaction. Receipt identity includes account, UUID, primary Review ID, action and full canonical request hash. Same-ID replay returns the stored result, including child/merged/entry IDs, before reapplying anything. Different-ID equivalence is accepted only when all requested effects can be proved; complex ambiguous outcomes return conflict. Structural mutations share the Location replay owner lock. Preserve nonblocking contention and 8-second statement/1.5-second lock deadlines. Conflict status is read after rollback under a bounded, scoped read.

Store only required private intent and presentation. Save-place requests necessarily retain selected name, coordinates, radius and edits; record-POI-once retains only the trimmed name and edits. No raw Apple response, HealthKit payload, bearer token or upload journal copy belongs in this outbox. Location Evidence DTO coordinates have their separate bounded cache owner. Diagnostics expose action/state/count/timing only, never request JSON, names, descriptions or coordinates.

## Required evidence

Run shared/web/mobile suites, both Review validators and both Location validators, full lint/typecheck/test/build/docs/brand/diff gates and a clean native build. The Review SQLite validator executes real store transactions, v4→v5→v6 migration, two-source rollback/restore/acknowledgement, interrupted-delivery reconciliation, and account tests. Complete the physical staging matrix in `docs/dayframe-regression-checklist.md`; unit/Simulator results do not establish iPhone force-quit, background, network or navigation behaviour.
