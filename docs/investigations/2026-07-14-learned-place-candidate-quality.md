# Learned-place candidate quality

## Report

- TestFlight build `0.1.0 (32)` showed a saveable learned-place candidate near Rainsford Road with only one visit and three samples.
- Another one-visit candidate used coordinate-first copy: `Regular place near 51.748, 0.438`.
- A single meaningful stay should be reviewable as time spent there, while weak/pass-through evidence should stay out of Learned places.

## Version and data path

- Fix branch base: `199fbcac6bf1b7b0912a88089771518368f59f7f` (`main`, documentation for the PR #58 TestFlight release).
- The screenshot predates PR #58's mobile repeat-visit and distinct-day gate, but queued build-32 events can still reach the current API.
- Evidence path: Expo background samples -> local cluster in `apps/mobile/src/lib/geofence.ts` -> queued `activity_event` -> `processActivityEvent()` -> `review_items` plus `learned_places` -> bootstrap -> Places/Review UI.

## Hypotheses and evidence

1. **Mobile promotion was too permissive in build 32.**
   - Proven by the screenshot and the pre-PR #58 implementation, which could queue a learned-place event after basic sample/dwell thresholds without recurrence.
   - Latest `main` partly mitigates this with two visits on two days, but does not classify a long one-off separately.
2. **The server trusts event type as classification.**
   - Proven: every non-ignored `learned_place_visit` is upserted into `learned_places`, regardless of visit/day/dwell/stability evidence.
   - This keeps legacy queued events and malformed clients capable of creating weak saveable candidates.
3. **Evidence and resolved location data are too lossy.**
   - Proven: `learned_places` stores visit/sample counts and latest timestamps but not distinct days, total/longest dwell, stability, classification, or cached address/POI fields.
   - Reverse geocoding happens only when mobile queues a learned-place event. Existing coordinate-only rows have no lazy repair path.

## Fix plan

- Centralize deterministic thresholds and classification in the shared package.
- Track cumulative/longest dwell, accuracy, and cluster spread on mobile and send the evidence with each surfaced event.
- Queue a single long stay as `unknown_stay`/one-off Review evidence; only repeated, stable evidence may use `learned_place_visit`.
- Reclassify on the server before any learned-place upsert so older clients cannot bypass the gate.
- Add additive learned-place evidence and geocode-cache columns, server filtering, and a scoped resolution endpoint for lazy mobile backfill.
- Make address and coordinates copyable in the mobile detail sheet and remove one-visit “regular” language.

## Closure criteria

- Weak one-visit/three-sample evidence does not create or appear as a saveable learned place.
- A qualified single long stay creates a one-off Review item without a learned-place row.
- Repeated stable visits can create a saveable candidate with complete evidence.
- Resolved name/address are cached and coordinate-only legacy candidates can be repaired lazily.
- Saved-place visit and commute behavior remains covered by regression tests.

## Resolution

- Shared classification now requires recurrence, distinct days, dwell, samples, accuracy, and cluster stability before a saveable place candidate can be created.
- Mobile queues a qualified single long stay as an event-first `unknown_stay` for Review and retains weak clusters locally without surfacing them.
- The API reclassifies every learned-place event before upsert, so events left in older mobile queues cannot bypass the current gate.
- Learned-place upserts persist monotonic evidence instead of adding already-cumulative counts, and bootstrap only returns `place_candidate` rows.
- Expo/Apple reverse geocoding is behind an optional provider interface. Resolved POI/address data is cached, and visible legacy coordinate-only candidates are backfilled lazily with a workspace/user-scoped API update.
- The mobile detail sheet uses readable place/address copy, exposes address and coordinates as separate copyable fields, and labels the item as an unsaved Place suggestion.

## Validation and remaining deployment checks

- Passed shared, mobile, and web typechecks and test suites, including focused classification, legacy event, one-off Review, geocoding cache, formatting, and clipboard helper tests.
- Passed root lint, typecheck, test, Next.js production build, brand asset check, and `git diff --check`.
- An iPhone 17 simulator native build succeeded with Expo Clipboard linked; the app bundled and launched. The target detail sheet remains a physical-device check because current simulator data has no saveable learned candidate.
- Before deployment, apply `supabase/migrations/202607140001_location_learning_intelligence.sql` and run the physical-iPhone scenarios in the feature tracker. No hosted database migration was applied from this branch.
