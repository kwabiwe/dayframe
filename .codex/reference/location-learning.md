# Location Learning Guardrails

Use this when changing Expo background sampling, learned-place events, `learned_places`, or location Review UI.

## Location Intelligence V2 architecture

`packages/shared/src/location/` owns the deterministic `location-v2.0` evidence, matching, segmentation, commute, DTO, and fixture contracts. Thresholds live only in `LOCATION_ENGINE_V2_CONFIG`. Both the account-isolated mobile SQLite journal and the server replay service call the same pure engine. V1 learned-cluster classification below remains compatibility behavior during shadow rollout; do not mix its recurrence counters into V2 temporal continuity.

Evidence sources are Expo standard locations and geofences plus the local `dayframe-location-visits` module's `CLVisit`, significant-change, provider, pause, and resume signals. Native callbacks persist a bounded protected Application Support queue and perform no networking. JavaScript clears a native signal only after inserting it durably into SQLite. The complete saved/accepted-learned place catalogue is passed to matching even though iOS registers no more than 20 geofence regions.

Initial capture profile:

- `distanceInterval: 75m`; this is a movement filter, never a dwell timer.
- deferred delivery after `200m` or `300s`, timeout `300s`.
- `pausesUpdatesAutomatically: false`, activity type `Other`.
- no iOS `timeInterval` assumption.
- maximum accepted horizontal accuracy `200m`; matching allowance capped at `60m`.
- saved dwell `5m`; unanchored candidate dwell `10m` with at least three samples; unknown review threshold `20m`.
- continuity gap `12m`; finalisation lag `10m`; two corroborating outside samples.
- raw evidence retention `7d`; upload batches at most 100 items.

Temporal invariants:

- Evidence is ordered by occurrence time, source precedence, and stable client ID; duplicate delivery is idempotent.
- A later appearance at the same coordinates is not continuity. `A -> B -> A` is three stays.
- An accepted different saved/learned place closes the current stay. A single noisy outside point does not; two corroborating outside points can.
- A completed `CLVisit` can support a gap, but accepted intervening-place evidence breaks that support.
- Initial geofence state is not an arrival. A bare geofence exit yields bounded uncertainty rather than a fabricated precise departure.
- Boundaries retain lower/upper evidence bounds. Manual corrections use `continuity_status = manual` and canonical replay must not overwrite them.
- Commutes connect distinct contiguous stay endpoints and use ordered route evidence. Route distance and straight-line distance remain separate.
- All local-day keys use the user's IANA zone, never UTC string slicing.

## Storage, privacy, and rollout

Mobile uses `dayframe-location-v2.db` with WAL, foreign keys, a 5s busy timeout, and evidence/outbox/account/state/segment tables. All mutations run through one rejection-safe serial queue. Seven-day cleanup expires local raw evidence intentionally, including unsent evidence, to enforce the privacy boundary; row-count cleanup may remove only acknowledged or permanently rejected rows and must never evict pending uploads. Logout and account changes clear native signals plus the previous account's journal, outbox, state, and context before another account is bound. HTTP `401/403` clears the app session, `413` shrinks/requeues a batch, `400/422` rejects only the permanently invalid items, and retryable failures use bounded exponential backoff with jitter.

Server ingestion creates one coordinate-free `activity_events` batch summary, stores exact evidence in user-owned `location_evidence`, then replays segments in the same transaction. Evidence APIs require both workspace and user ownership and return `private, no-store`; raw evidence is never logged. Deletion removes exact evidence and cascading lineage while preserving derived summaries and entries.

Rollout has four server-authoritative modes, returned by bootstrap and acknowledged by the mobile client:

- `v1`: stop and clear V2 capture; keep the previous geofence semantics.
- `v2_shadow`: capture/replay V2 but emit no V2 review item or time-entry semantics; V1 remains active.
- `v2_review`: suppress competing V1 location semantics and permit V2 stays/commutes that begin after the same-mode acknowledgement cutover to become review items only.
- `v2_enabled`: the same duplicate-suppressed V2 path, reserved for a later narrow high-confidence policy. Unknown or ambiguous evidence remains review-first.

The server default is `v2_shadow` through `DAYFRAME_LOCATION_ROLLOUT_MODE`. A legacy client request for `v2` maps to `v2_review`, but new code and operational documentation must use the four canonical names. The server records a semantic cutover only after a client has acknowledged the same server mode; final segments that began before that cutover cannot backfill user-visible semantics. This acknowledgement barrier is the protection against shadow-era history suddenly producing duplicate suggestions.

Location review mutations lock the review/event and affected segment rows in one transaction. Edit-and-confirm, record-once, save-place-and-confirm, split, and merge either commit fully or roll back. Change-place feedback is a small bounded anchor and never expands a saved geofence from one noisy sample.

Reverse geocoding is display-only: use saved/learned identity first, invoke a provider only for actionable/visible unknowns, cache a bounded provider/version/locale result, and never put the provider's raw object in an event. V2 segmentation must not call reverse geocoding.

Postgres retention is operational through Vercel Cron calling `GET /api/cron/location-retention` daily at `03:17 UTC`. The route fails closed unless its bearer token matches `CRON_SECRET`, returns `no-store`, calls the bounded service-role cleanup function under an advisory lock, and warns if a 50,000-row run limit leaves a backlog. Vercel Cron runs on production deployments only, so hosted verification must confirm the environment secret, database role/function grant, invocation logs, and next-day schedule. A failed invocation leaves evidence for the next run and is visible through the non-2xx route result and Vercel logs; it must never fall back to an unauthenticated deletion path.

Default rollout is `v2_shadow`. Deploy the additive migration, then API/web, then the native TestFlight build; validate shadow counts and privacy; activate `v2_review` only after the physical matrix. Keep `v2_enabled` disabled until its high-confidence policy has separate approval. Rollback by changing the server-controlled mode to `v2_shadow` or `v1` before reverting runtime code. Additive tables may remain and confirmed V2 entries must not be deleted.

## Classification invariant

Location sampling is evidence, not a saved place. Classification thresholds live in `packages/shared/src/index.ts` under `LOCATION_LEARNING_THRESHOLDS`; do not duplicate them in mobile or server code.

- `noise`: weak, brief, inaccurate, or unstable evidence. Keep it local/raw so future recurrence can add evidence, but do not create a Review item or saveable learned-place row.
- `one_off_activity`: one stable stay with at least four samples and 60 minutes of dwell. Queue event-first `unknown_stay` evidence for Review; never expose Save place from this classification.
- `place_candidate`: at least two visits on two distinct days, six samples, 40 minutes cumulative dwell, a 20-minute longest stay, acceptable accuracy, and stable spread. Only this classification may upsert or promote a `learned_places` saveable candidate.

The server must re-run shared classification before an upsert. Never trust `event_type = learned_place_visit` as proof that the evidence is saveable; old mobile queues can outlive a TestFlight build.

## Evidence and persistence

Track visit count, distinct days, sample count, cumulative and longest dwell, first/last seen, average accuracy, maximum cluster spread, and radius. Cumulative mobile evidence is monotonic, so conflict updates use `greatest(...)`; do not add a cumulative payload to an already cumulative database count.

Ignored clusters stay suppressed. Noise or one-off rows may later become place candidates when new repeat evidence arrives, but direct place promotion must require `classification = 'place_candidate'`.

## Geocoding and labels

`apps/mobile/src/lib/locationGeocoding.ts` owns the provider abstraction. Expo/Apple reverse geocoding is the default and requires no external key. A future external Places/POI implementation must be optional, implement `ReverseGeocodingProvider`, document its key/cost/privacy behavior, and preserve the Expo fallback.

Resolve only when an actionable candidate is queued or a visible legacy candidate lacks cached readable data. Cache the address, POI name, formatted address, and resolution timestamp on `learned_places`; do not geocode samples or renders.

Prefer a genuine POI/business name, then street/locality/postcode. Coordinates are a final fallback and secondary debug/copy detail. Never call a one-visit cluster “regular.”

## Privacy and UX

Do not log raw coordinates or geocoder payloads. Preserve workspace/user scoping and the event-first flow. Learned places contains only saveable place candidates; one-off activity stays in Review with Confirm/Edit/Ignore. Address and coordinate copy actions must remain phone-safe and use at least 44px touch targets.
