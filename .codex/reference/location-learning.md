# Location Learning Guardrails

Use this when changing Expo background sampling, learned-place events, `learned_places`, or location Review UI.

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
