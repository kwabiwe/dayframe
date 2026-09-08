# Four-PR stack and Visit departure review

Historical status note (2026-09-08): PRs #188–#191 subsequently merged in order, with PR #191 at `ae60f6d`. The final App Group repair is recorded separately; production rollout/cutover, exact-final staging promotion, signed-device isolation, and physical acceptance remain unrecorded release gates. Current state lives in `docs/feature-fix-tracker.md`.

## Scope and source identity

Reviewed #188 `90626eb3f3e9221c4b269ac66122210de1b9ffad`, #189 `160b1c169c80006b8e30ca9b437d833ff132c860`, #190 `ce9f5a0ff172db4fa1c501f993d4bc15a77fcf24`, and #191 `dea5eed1197d5872b8b67e171e57bdd127c47088` against main `d649e2db3a9393d521bd8c127d54504451b65a47`. These form an ancestry-preserving dependency chain in that order. The cumulative diff contains 121 files, 6,853 insertions and 1,547 deletions before this fix.

At review start, every reported GitHub check on all four heads was successful, including both disposable PostGIS profiles and clean unsigned iOS Simulator builds. Vercel's stable staging alias was read-only verified at #191's supplied head (`dpl_Afth4JwP7JTXWA63PTqMYNrwUqSa`); production remained at main (`dpl_2LAfrviiH9J2A38BXUxrpvYrifyE`). Those deployment identities do not prove installed-device identity, live schema, or the new fix's staging behavior.

## Boundary evidence and smallest correction

Two hypotheses were checked: the engine discarded Visit support during transition, or server replay/presentation retained an older estimate. The existing September 7 fixture proves the first without any hosted data access: its exact start assertion failed with `2026-09-07T16:54:22.971Z`, the midpoint of GPS `16:32:19.376Z` and first driving `17:16:26.566Z`. The completed Visit departure is `17:15:53Z`. In Europe/London these are 17:54:22.971, 17:32:19.376, 18:16:26.566 and 18:15:53 respectively.

`closeAtTransition` used the final GPS observation for its midpoint despite retaining `visitSupportUntilAt` on the stay. The fix preserves the completed Visit departure and equal lower/upper bounds only when the latest inside observation and transition bracket it. Earlier contradictory-place evidence and observations at the origin after departure still use the existing estimate. No schema, rollout flag, algorithm identity or native implementation changes are needed.

The exact fixture now asserts the stay stop, commute start, and both bounds. Its coordinates were replaced with synthetic geometry; the timing and route qualification remain covered. Other regression cases cover saved-place transitions, corroborated outside samples, long gaps, intervening contradictory places and later inside evidence. A source fixture must never require committing a private location trace.

Server replay updates open Review suggestions for a stable segment identity, preserves terminal event decisions and does not overwrite manual segment corrections. Consequently, fixing the engine is not permission to rewrite confirmed historical entries. Expired evidence cannot be reconstructed.

## Stack boundaries and remaining release gates

- #188 owns bounded server transactions, receipt reconciliation and the additive Sleep resolution-link migration. The migration belongs before #190's source-revision consumer. It must be verified in the target database before release; this review runs no hosted migration.
- #189 owns mobile cancellation, independent recovery, force coalescing and retained request identities. Its integration preserves #188's server tree. The `.vercelignore` change is deployment hygiene, not Location semantics.
- #190 deliberately combines the Health journal with those earlier contracts. The merge retains backend/workspace/user and session guards, bounded source-decision reads, the shared owner-scoped resolution-link helper and both Expo Constants/Crypto dependencies. No lost fix was found in the inspected conflict resolutions. Legacy Health events without proven backend provenance remain retained but withheld; physical-device repair/recovery evidence remains necessary.
- #191 also contains staging identity commits `3e2f351`/`4c382ac`, outside its original Location-only description. Its Staging host and extension entitlements grant `group.com.layereight.dayframe.staging`, while `DayframeSharedStorageConfiguration.appGroupIdentifier` still hard-codes `group.com.layereight.dayframe`. This breaks the native shared-container contract for a signed Staging build. Complete that isolated correction and validate App Intent/Live Activity hand-off before relying on this staging identity. The current CI builds unsigned Debug, not signed Staging. This boundary fix does not broaden into native changes.
- V1 suppression is server-wide in every non-`v1` mode, including the default `v2_shadow`; the PR title does not restrict it to staging. Existing V1 records and duplicate receipts are preserved, while newly delivered queued V1 semantics become audit-only. Shadow emits neither V1 nor V2 suggestions. Review/enabled output requires matching client acknowledgement and a post-cutover segment start. Confirm the actual production mode, installed clients and intended cutover before releasing #191; changing no environment variable does not mean unchanged production behavior after deployment.
- Sparse unknown stays may bridge at most 60 minutes within 120 metres and retain uncertain continuity; intervening accepted place/route evidence still breaks them. Co-located unsaved round trips now qualify only with the existing substantial route, excursion and reliable-speed requirements. They remain review-only without saved endpoints. Endpoint observations without route evidence no longer manufacture a commute.
- Upload and semantic replay use separate transactions under the same owner lock. This protects durable upload from replay deadlines, but replay retains its finite budget and foreground retry requirements. A drained upload queue alone is not semantic completion. Canonical architecture/Location guidance previously contradicted this split and is corrected in this PR update.

## Validation and disposition

The exact regression failed once on the supplied head, then all 40 engine tests passed after the targeted correction. Further validation results and the updated head/CI snapshot belong in PR #191's description. No merge, production deployment, rollout change, production migration, new PR, signed iPhone claim or historical-data repair is implied.

Recommended merge order remains #188 → #189 → #190 → #191, after the relevant staging/device and migration gates. Preserve ancestry when merging, or deliberately retarget/rebuild descendants if using squash merges. Hold #191 until its staging identity and production-cutover gates are resolved.
