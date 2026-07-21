# Location V2 Trusted-Place Automatic Entries

## Report and intended outcome

On 2026-07-21 KB completed a real drive but saw no visible Dayframe result because production was still using `v2_shadow`. KB confirmed that Dayframe is a personal beta and approved enabling real production behaviour, including automatic entries where the evidence is trustworthy.

The agreed policy is:

- automatically record strong completed visits to saved or approved places;
- keep uncertain places, unclear journeys, and overlaps in Review;
- keep automatic entries editable/deletable and visibly sourced from location evidence.

## Documentation conflict recorded before implementation

At branch creation, `main`'s tracker still said build 60 was latest and that V2 had not reached TestFlight. Actual release evidence shows PR #88 in TestFlight build `0.1.0 (61)`, delivery ID `66577a40-9279-4fd0-add8-8849964871e7`. Documentation PR #89 contains that release update but was not merged into `main`. This branch updates the tracker from verified release evidence rather than treating the stale statement as runtime truth.

The older location guardrail also reserved `v2_enabled` for a later approved policy. KB explicitly approved that policy in this task. The checked-in fallback remains `v2_shadow`; production activation remains an explicit post-merge environment change.

## Implementation policy

`v2_enabled` automatically confirms only a finalised stay when all of the following are true:

- the match is a saved place, or an accepted learned place linked to a saved place;
- place logging is enabled;
- confidence is `medium_high` (the strongest ordinary V2 device result) or `high`;
- continuity is `continuous`, `supported_by_visit`, or `broken_by_other_place`;
- the detected window does not overlap existing confirmed/accepted time.

The entry is created transactionally after its idempotent `activity_events` record, uses source `location_learning`, links the resolved saved place, and inherits its default category/activity description. Commutes, unknown/ambiguous places, weak confidence, `uncertain_gap`, missing learned-place linkage, disabled logging, and overlaps remain Review-first.

## Idempotency issue found during validation

The first disposable-database run exposed a self-overlap retry bug: on a duplicate evidence batch, the already-created automatic entry could block itself and create a Review item for the same event. The overlap query now excludes the same stable `location-segment:<id>` event. The validator proves that retries create neither duplicate entries nor dual automatic-entry/Review output.

## Validation evidence

Completed:

- focused semantic-policy tests: 8 passed;
- all workspace tests: 519 passed (235 mobile, 190 web, 94 shared);
- all workspace typechecks: passed;
- lint: passed;
- production web build: passed;
- brand asset contract: passed;
- Location V2 SQLite validation: passed;
- fresh disposable PostGIS schema apply: passed;
- database validator: passed for shadow/review/enabled cutover, trusted-place automatic writes, overlap fallback, automatic-entry idempotency, semantic idempotency, atomic rollback/concurrency, split/merge, and V1 compatibility;
- TestFlight preflight: passed; release commands must pin full Xcode because `xcode-select` points at Command Line Tools;
- `git diff --check`: passed.

Still required before release: PR checks and merge, production deployment/schema verification, the explicit production mode change, archive/export/upload from merged `main`, App Store Connect verification, and the physical-iPhone journey.

## Release and physical success criteria

After merge:

1. verify the merged commit is the Vercel production source;
2. verify the hosted V2 migration/schema and retention path;
3. set production `DAYFRAME_LOCATION_ROLLOUT_MODE=v2_enabled` and redeploy;
4. open/refresh Dayframe so build 61 or later acknowledges the same mode;
5. ship the next internal TestFlight build through the documented lane;
6. verify Apple `VALID`, compliance, notes, `Internal Health Debug`, and `IN_BETA_TESTING`;
7. run a new physical journey after acknowledgement;
8. confirm a strong saved-place stay becomes one editable confirmed entry, while a commute/uncertain result remains in Review;
9. confirm no duplicate entry or duplicate Review card appears after refresh/retry;
10. record the exact build, delivery UUID, Vercel commit, mode-change time, and physical result.

The journey captured before activation is not backfilled because the semantic cutover intentionally excludes shadow-era segments.
