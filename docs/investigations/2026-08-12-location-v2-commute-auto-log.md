# Location V2 trusted commute automatic logging

Date: 2026-08-12

## Product decision

Dayframe should automatically record a commute only when Location V2 has enough
evidence to make the ordinary correction burden lower than the false-positive
risk. This PR extends the existing `v2_enabled` policy; it does not change the
checked-in `v2_shadow` default or activate the feature in any environment.

A commute is automatically eligible only when all of these are true:

- the segment is finalised;
- both endpoints are saved Dayframe places in the current workspace;
- confidence is `medium_high` or `high`;
- continuity is `continuous`;
- at least two accepted route samples support the journey; and
- the engine qualified significant endpoint displacement or a meaningful
  evidence-backed round trip to the same saved place.

Unknown, learned-only, ambiguous, or missing endpoints remain Review-first.
Endpoint-only journeys, lower confidence, uncertain gaps, and every other
qualification remain Review-first. A confirmed/accepted entry overlap of at
least one minute also falls back to Review.

The derived entry uses the existing `Commute` category, `location_learning`
source, retained confidence, and the detected time range. It has no fabricated
description or place because a commute spans endpoints rather than occurring at
one place.

## Audit and false-positive recovery

The event-first invariant remains the audit boundary. One deterministic
`commute_detected` activity event is confirmed before its derived entry is
created, and repeated ingest/replay cannot create a duplicate entry or a second
Review item.

Rollout must not reinterpret an earlier user-facing decision:

- an event already in Review stays in Review when a newer policy would make it
  auto-eligible;
- confirmed, accepted, and ignored event decisions are terminal on replay;
- removing a former overlap does not silently promote its existing Review
  item; and
- deleting an automatically logged commute through the ordinary entry editor
  is the recovery action. Its confirmed source event remains, so retained raw
  evidence cannot recreate the entry.

No commute-specific Undo surface is introduced. The normal entry editor and
delete flow remain the user-facing correction path.

## Implementation boundary

- `apps/web/src/lib/location/location-semantic-policy.ts` owns pure eligibility.
- `apps/web/src/lib/location/location-ingest-service.ts` verifies endpoint
  ownership, checks overlap, preserves existing event decisions, and performs
  the event-first automatic write in the existing transaction and advisory
  lock.
- The existing deterministic engine, confidence calculation, segmentation,
  mobile capture, APIs, Review actions, schema, and retention policy do not
  change.
- No migration, environment variable, mobile binary, or UI change is required.

The architecture, API, database, product-model, release, and Location V2
references were reviewed. This change stays within their existing ownership and
data contracts.

## Rollout and unresolved decisions

The repository default remains `v2_shadow`. Staging or production activation of
`v2_enabled` remains an explicit owner-controlled environment decision after
staging and physical-device evidence. This PR does not infer that approval from
merge, Preview deployment, or automated fixtures.

Confidence and segmentation thresholds remain centrally owned by
`LOCATION_ENGINE_V2_CONFIG`; tuning them from real-device observations is a
separate evidence-led change. Persisted category icons, proactive POI ranking,
and commute endpoint correction remain the separate decisions recorded in the
feature tracker.

## Motion contract

No visible presentation, navigation, gesture, feedback, layout, or animation
changes. `.codex/reference/motion.md` is therefore not applicable to this
server-policy PR.

## Validation evidence

- The pure semantic-policy suite passed 15 tests, including trusted
  saved-endpoint and same-place round-trip automatic cases plus finalisation,
  endpoint, confidence, continuity, route-count, and qualification rejection.
- The focused Location review-quality contract passed four tests, and the
  evidence/replay route suites passed seven tests from the web workspace.
- Web and shared workspace typechecks passed.
- `DATABASE_URL=postgres://dayframe:dayframe@127.0.0.1:54322/dayframe_commute_autolog_20260812_test npm run validate:location-v2-db`
  passed against a fresh current base schema. It covered the automatic commute,
  category-only entry, overlap fallback, existing-Review preservation,
  ignored-decision replay, deleted-entry replay, duplicate ingest, and the
  validator's existing Location V2 matrix. The disposable database was removed
  afterward.
- `npm run lint` passed, including documentation alignment, iOS configuration,
  and web ESLint.
- `npm run build` passed for the optimized Next.js production build.
- The final documentation and diff-hygiene checks are run after this evidence
  update.
- Full workspace suites and a second database topology were not repeated; the
  bounded pass stayed on the changed server policy and its transactional
  boundary. No iOS build is required because mobile/native source and contracts
  are unchanged.
