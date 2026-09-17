# Dayframe — Saved-place arrival and boundary quality V1

**Document ID:** `DF-SAVED-ARRIVAL-BOUNDARY-V1`
**Prepared:** 17 September 2026
**Intended executor:** Codex, GPT-5.6 Luna, Max reasoning
**Planning baseline:** `63d61d83013331457b8c4ff4b5243ed9e418ac0d`
**Repository:** `kwabiwe/dayframe`
**Suggested branch:** `fix/saved-place-arrival-boundaries`
**Expected next implementation PR:** #204, if that number is still available. GitHub assigns the actual number.
**Suggested PR title:** `fix(location): corroborate saved-place arrival boundaries`

> This is the new arrival/boundary-quality plan, NOT the PR #199 saved-place dwell plan and NOT the PR #202 replay-performance plan. Verify this document ID before starting. This is a plan, not a claim that the proposed behaviour has been implemented or tested.

## 1. Outcome and scope at a glance

Fix the specific class of error in which Dayframe captures early evidence of arrival at a saved place, does not promote the early short cluster into a stay, starts the recognised stay much later, and assigns the intervening stationary/uncertain time to the inbound commute.

Two corrections belong in this one focused PR:

1. **Corroborated Visit support:** allow an already accepted, finite, less-precise native Visit to support a saved-place interval only when independent, high-quality observations establish the saved-place identity and the episode. Do not make a broad coordinate precise, widen matching radii, or lower the ordinary quality threshold.
2. **Arrival-conflict safeguard:** when such a full interval cannot be justified, prevent a narrow, evidenced early-arrival conflict from being presented as a long commute to a later same-place stay. Suppress the conflicting spanning suggestion rather than invent an earlier visit, fabricate travel, or attach a commute to a nonexistent stay.

The first correction should recover the approximately 12:33–13:35 gym visit in an unconfirmed, sufficiently corroborated reproduction. The second provides an honest fallback when the evidence is insufficient to reconstruct that full stay. It is not a blanket ban on uncertain commutes.

**Do not change the following in this PR:** native capture, permissions, background sampling, geofence registration, global accuracy/radius limits, ordinary 12-minute continuity, the 30-minute point-only saved-place bridge, minimum five-minute saved-place dwell, finalisation lag, seven-day retention, rollout/acknowledgement, automatic logging policy, timer/Health/Review owners, scheduling/coalescing, SQL timeouts, PR #202's optimisation, or adjacent UI.

**This is not server-only.** The shared engine is used by both server replay and the iPhone's local journal processing. The API format can remain compatible, but a new signed staging iPhone build containing the final shared-engine code is required for physical acceptance. Building/installing is a later OpenClaw job, not part of the Codex implementation session.

## 2. Who does what, and when to stop

| Job | Owner | Deliverable | Hard stop |
| --- | --- | --- | --- |
| A. Implementation and local verification | Codex, Luna Max | Focused code, synthetic regressions, appropriate local validators, docs, draft PR, exact base/head handoff | Immediately after push/draft-PR update and report |
| B. Independent review | OpenClaw running Claude Opus 5, low reasoning | Complete-diff read-only review at exact SHAs | After verdict; no automatic fixes or deployment |
| C. Targeted corrections, if substantiated | Codex in the same branch/worktree | Only reviewed issues, focused validation, one appropriate final pass, new head | After push/report |
| D. Exact-head staging preparation and evidence | OpenClaw | Ready Preview verified/promoted, staged evidence, signed staging app if needed | After reporting readiness/results or a blocker |
| E. Physical acceptance | KB, with OpenClaw observing technical evidence | Real saved-place journey and UI/sync checks recorded PASS/FAIL/NOT RUN | No merge by automation |
| F. Merge and production release | KB explicitly authorises; OpenClaw executes approved operations | Actual merge SHA, deployment identity, later production observation | No extra work inferred from approval of another job |

Codex must not run the whole lifecycle. A passing local test is not physical acceptance. A Ready Preview is not a staging promotion. A staging PASS is not production acceptance.

## 3. Source of truth and evidence limits

### 3.1 Verified repository baseline

GitHub confirms PR #203, the small post-#202 documentation reconciliation, merged at `63d61d83013331457b8c4ff4b5243ed9e418ac0d`. Current `main` was verified at that SHA while preparing this plan. Its parent includes PR #202 at `c72cba498805bf80ba683239610a7b50a7109825`. [R1]

Fetch `origin/main` again before work. If main has advanced:

- Record the new base and inspect the intervening diff.
- Continue from fresh main when the change is unrelated and the plan remains applicable.
- Stop for a scope decision if intervening work changes the engine, schema, provenance protection, policy, rollout or acceptance assumptions materially.
- Do not branch from the merged #199/#202 implementation branch. Do not stack on another unmerged feature.

Use `docs/feature-fix-tracker.md` for current delivery state. The current tracker records staging acceptance of #202, not proof of production performance. Do not assume the production issue is closed because performance improved on staging. Do not re-investigate production in this implementation job.

### 3.2 Owner/OpenClaw-reported gym incident

The following is supplied investigation evidence, not a raw trace independently executed during planning:

| Observation | Reported time/value |
| --- | --- |
| Owner left for gym | Approximately 12:20 BST |
| Owner expected arrival | Just after 12:30 BST |
| Staging inbound suggestion | Approximately 12:24–13:21 BST; UI displayed 56 minutes |
| Staging saved-place stay | Approximately 13:21–13:34 BST; UI displayed 13 minutes |
| Staging return suggestion | Approximately 13:34–13:41 BST; about seven minutes |
| Native Visit interval | 12:32:51–13:34:53 BST |
| Saved-place geofence enter | 12:33:26 BST |
| Early point-cluster end | 12:36:18 BST |
| Later point cluster | Begins around 13:21 BST |
| Quiet interval | Approximately 44 minutes |
| Outbound maximum observation gap | 49 minutes 35 seconds; low-confidence/uncertain-gap |
| Window evidence | 40 staging observations, uploaded and retained as accepted |
| Early Visit/geofence linkage | Reported unlinked to emitted segments |
| Subsequent replay | Successfully retained the wrong boundaries; not merely stale output after a timeout |

Date: **17 September 2026**. BST was UTC+1. Store/compare instants, not formatted local strings.

The supplied report does **not** give the complete coordinate/accuracy/speed sample set, exact horizontal accuracy of the Visit, every geofence callback, or exact native arrival-to-upload history. Do not manufacture these values. A synthetic fixture may use, for example, 120 metres of Visit accuracy, but must label that as a chosen test value, not the real trace's measured accuracy.

The production journal was separate and had acknowledged observations; no successful processing of that journey had been established in the earlier investigation. That is separate from this detection-quality defect. Staging/production catalogue counts also differed. Do not compare their output as though their input were identical.

### 3.3 The historical gym stay is now protected

KB subsequently Quick Confirmed several items. OpenClaw traced the questioned gym time entry and three Home entries to explicit Review confirmation receipts. Those were user decisions, not evidence of automatic logging in `v2_review`.

**Do not automatically expand, replace, delete or duplicate the already accepted 13-minute gym entry.** The algorithm can improve future/unconfirmed evidence processing while canonical history remains protected. A test on this exact already-confirmed record should expect preservation, not retrospective correction. A new unconfirmed/synthetic episode is needed to prove the corrected full duration.

### 3.4 Keep facts and new design decisions separate

Sections 4 describes inspected code. Sections 6–9 prescribe the proposed correction authorised by this plan. The proposed corroboration and fallback rules are product/engineering choices to implement and test; they are not claims about existing behaviour or guarantees of native location accuracy.

Apple documents Visit arrival/departure as approximate and horizontal accuracy as a spatial radius. Spatial imprecision is not permission to ignore otherwise corroborated temporal evidence, but neither does it justify treating the timestamp as exact ground truth. Preserve uncertainty and conservative confidence. [A1–A3]

## 4. Current mechanism: what the code actually does

### 4.1 Two different accuracy gates

`LOCATION_ENGINE_V2_CONFIG` currently defines: [R3]

| Setting | Current value | Rule for this PR |
| --- | ---: | --- |
| `maxAcceptedHorizontalAccuracyMeters` | 200 m | Unchanged |
| `highQualityHorizontalAccuracyMeters` | 65 m | Unchanged |
| `maxAccuracyAllowanceMeters` | 60 m | Unchanged |
| `savedPlaceMinimumDwellMs` | 300,000 ms | Unchanged |
| `savedPlaceExitReentryGraceMs` | 300,000 ms | Unchanged |
| `maxContinuityGapMs` | 720,000 ms | Unchanged |
| `savedPlaceQuietGapMaxMs` | 1,800,000 ms | Unchanged |
| `segmentFinalisationLagMs` | 600,000 ms | Unchanged |
| `rawEvidenceRetentionDays` | 7 days | Unchanged |
| `outsideConfirmationCount` | 2 | Unchanged |

In `segmenter.ts`, `preprocess` retains accepted observations up to the acceptance ceiling, but the saved-place processing loop separately skips non-geofence coordinate observations failing `accurateCoordinate`, which uses the stricter high-quality threshold. The retained Visit-support map also requires a saved match and that stricter accuracy. Thus **accepted and uploaded does not mean used as saved-place interval support**. [R2]

### 4.2 Short early clusters can disappear before commute derivation

`stayFromWorking` requires a meaningful supported known-place window. Its guard correctly prevents short passing fixes or midpoint uncertainty from manufacturing five minutes of attendance. Do not undo this #199 safeguard.

Without accepted interval support, a 44-minute saved-place gap exceeds both the ordinary 12-minute continuity and the 30-minute point-only same-place exception. The earlier cluster may not qualify as a stay, leaving only the later one.

### 4.3 The late stay start becomes the commute end

`deriveCommutes` pairs promoted stays. It already advances an origin boundary using later origin-matching evidence, but uses `to.startedAt` as the destination arrival/commute end. Therefore a late gym stay can stretch the inbound suggestion. Significant endpoint displacement can still qualify a low-confidence suggestion containing a large internal gap. It is not proof of continuous movement. [R4]

### 4.4 Relevant protections already exist

Server replay calls the shared engine, protects manual/terminal source portions, retires obsolete open proposals atomically, persists stays before commutes, maps actual persisted endpoint IDs, and replaces unprotected lineage. These are existing owners, not targets for replacement. [R7]

The mobile journal also calls the shared engine, and its complete account-journal replay replaces derived snapshots. Local segment computation is not an alternate authority for confirmed entries or Review mutations. [R8]

### 4.5 Medium confidence is not universally review-only

`automaticPolicy.ts` has a medium-confidence saved-route commute exception. Merely setting `continuityStatus = uncertain_gap` or limiting a commute to medium does not guarantee it stays out of automatic confirmation in `v2_enabled`. New weak-Visit-derived arrival/departure boundaries must not accidentally activate that exception. Do not fabricate a large max-gap value or false uncertainty to bypass policy. [R6]

## 5. Setup and bounded baseline work — Codex Job A

### 5.1 Read only relevant guidance

Read `AGENTS.md`, `docs/feature-fix-tracker.md`, `docs/documentation-governance.md`, relevant Location/Review sections of `docs/PRD.md` and `docs/architecture.md`, `.codex/reference/location-learning.md`, relevant validation sections and `docs/dayframe-regression-checklist.md`.

Read the existing #199 tests and fixture, not just its dated investigation. Historical notes explain why safeguards exist but do not override this plan/current source. The July commute-boundary investigation is useful context for preserving the existing origin-side correction. [R9]

No UI work is authorised, so do not read/rewrite the entire visual system or start a design task.

### 5.2 Isolate the worktree and preserve other jobs

Create one fresh task branch/worktree. Verify base SHA, clean status and branch ownership. Do not touch OpenClaw's TestFlight archive/worktree, another Codex job, untracked private evidence or the working #202 test environment.

Add this plan to `docs/plans/saved-place-arrival-boundaries-v1.md` with document ID unchanged. Record deviations in the investigation and report; do not silently replace the requested plan with the older saved-place-quality document.

### 5.3 Local database and machine readiness

Use only an explicitly verified, disposable loopback PostgreSQL/PostGIS test database. Historical environment evidence identified a usable service on `127.0.0.1:54323`; **verify it now**. Do not assume that endpoint is still healthy. Do not fall back to the formerly broken Docker/default service on port 54322 or to hosted credentials.

Before installing dependencies or running DB validators:

- Check free storage and existing dependency readiness.
- Verify Git, Node/npm and the configured local database connection.
- Confirm the validator target is loopback and task-owned with a `_test` suffix.
- Confirm PostGIS and the database version required by the actual validation script.
- Prefer an existing healthy environment instead of reinstalling unrelated tooling.

An environment readiness check and at most one narrow, non-destructive setup recovery are allowed. Storage exhaustion, I/O corruption, Xcode licence/toolchain issues or unresolved credentials are OpenClaw operational work: preserve the worktree, report the exact blocker and stop. Do not uninstall Xcode, prune Docker, delete caches/backups, accept licences or attempt a machine repair campaign.

### 5.4 Private incident input, when already available

OpenClaw may identify the already authorised, privately preserved incident evidence on the same Mac. Codex may read that identified local input to extract a minimal reproduction. Do not search every account/folder or provision production access. Keep it outside Git and normal logs; never commit route coordinates, place names, account IDs or device IDs.

Produce a safe evidence worksheet: timestamp, source kind, accepted versus excluded status, accuracy band (`<=65`, `65–200`, `>200`), candidate-match class, whether the observation supports or contradicts the episode, and which output used it. Do not print raw accuracy coordinates/identities merely to make the report detailed.

If the full private trace is unavailable, implement from clearly labelled synthetic reproductions and mark the real-trace gate NOT RUN. If inspected real input contradicts the proposed safe support criteria, do not weaken them to force that one trip to pass. Complete the safe synthetic work and report the unresolved incident condition, or stop if the primary design no longer applies.

## 6. Authorised design A — corroborated saved-place Visit interval

### 6.1 Design principle

Treat an accepted finite Visit with lower spatial precision as **conditional temporal interval evidence**, not as a high-quality GPS fix. Independent high-quality saved-place observations establish the place; the native interval can then explain a reporting silence between them.

Do not allow a saved name, preferred category, a single callback, distance to the gym, or the user's remembered journey duration to become algorithm input.

### 6.2 Eligibility: all conditions must pass

Build one replay-local support analysis over already preprocessed accepted evidence. It must not query the database, call a geocoder or retain state between engine invocations.

A new corroborated support record may be created only when:

1. The observation is an accepted `visit` for the same device/algorithm as the replay, with both coordinates and finite non-null accuracy. Its accuracy is **above the existing high-quality threshold and no greater than the existing acceptance ceiling**. Existing high-quality Visit handling stays on its current path.
2. Both interval endpoints are valid, `arrival < departure <= processingAt`, and the effective interval is at least the existing saved-place minimum dwell. Missing, open, future, reversed or invalid departure does not qualify.
3. A current saved-place catalogue record exists. The proposed saved place is geometrically compatible with the Visit under the existing matcher/allowance, not a new larger radius. A saved ID hint alone is not proof.
4. There are at least **two distinct high-quality strong saved-place point observations near arrival** for that same saved ID, with distinct occurrence times. These must be actual `standard_location`/`significant_change` points, not Visit, provider or geofence callbacks. They fall within `[arrival, arrival + 5 minutes]` and inside the Visit interval.
5. There is a **later independently supported point cluster at the same saved place**, after the quiet interval being repaired. It contains at least two distinct strong points and spans at least the existing five-minute supported-dwell floor. At least one later strong point must be within the ordinary 12-minute continuity horizon before the reported Visit departure.
6. The same saved identity is the unambiguous corroborated result. Inspect candidate classes, not just a name or the first candidate returned by a tie-break. Competing strong saved-place identities at the relevant anchors veto the new support. Do not rewrite the global matcher to resolve this ambiguity.
7. Any same-place `geofence_enter` near arrival is consistent supporting evidence and should be retained in lineage when used. It does not substitute for the required high-quality points. A registration `geofence_state`, an exit or a callback for another region is not an arrival.
8. No contradiction or unresolved departure veto from Section 6.3 exists within the interval.
9. All corroborating observations occurred by `processingAt`. The preprocessing tolerance for slightly future timestamps is not permission to use future witnesses for this inference.
10. The episode is not built from simulated evidence. Keep existing simulated handling; do not grant it this new inferred interval path.

**Parameterisation:** add only the dedicated small constants needed for this new rule to `LOCATION_ENGINE_V2_CONFIG`/its type, rather than unrelated files: an arrival corroboration window of 300,000 ms and a minimum strong-point count of 2. Name them for corroboration, not capture. Reuse the existing saved-place dwell and continuity durations where their actual meanings apply. Do not couple arrival timing to exit grace merely because both happen to be five minutes.

The exact private gym accuracy and strong-point inventory must be checked against these criteria. These are conservative V1 policy decisions, not established details of that private trace.

### 6.3 Contradictions always take precedence

For this new lower-precision support path, a finite Visit is never an unconditional bridge.

Veto the proposed broad interval on any of the following:

- A credible high-quality observation establishes a different saved/accepted-learned place inside the proposed episode.
- Existing-quality corroborated outside/moving evidence establishes a departure before the proposed Visit departure. Reuse the existing outside-count and displacement/movement reasoning; repeated callbacks are not independent outside points.
- A same-place exit remains unresolved: it is neither a known near-simultaneous restoration pair nor cancelled by actual strong inside evidence within the existing exit/re-entry grace.
- A genuine A→B→A episode occurs. Never use one long Visit to merge the two A visits across B.
- Reliable movement contradicts the supposed quiet interval.
- Saved-place association is ambiguous or contradictory.

For V1, **reject the new inferred full-interval support** when such a contradiction exists and let ordinary segmentation handle the evidence. Do not add a second algorithm that carves a broad Visit into arbitrarily many reconstructed episodes. Existing high-quality Visit clipping/reuse behaviour must remain intact.

A weak Visit must not itself cancel an unresolved exit just because its end is later. This is a narrower trust path than existing high-quality Visit support. Preserve #199's five-minute chatter protection and real-departure precedence.

### 6.4 Working-state integration

Suggested helper: `packages/shared/src/location/savedPlaceArrivalSupport.ts`.

Suggested internal output (illustrative; not an API schema):

```ts
type CorroboratedSavedVisitSupport = {
  visitEvidenceId: string;
  savedPlaceId: string;
  arrivedAt: string;
  departedAt: string;
  arrivalUpperBoundAt: string;
  departureLowerBoundAt: string;
  corroboratingEvidenceIds: readonly string[];
};
```

Use the existing `runLocationEngine` state-machine pass as the sole segment owner. A support index may associate the original Visit evidence with a proven saved identity for that invocation. Do not globally mutate `ClassifiedEvidence.match`, falsify `horizontalAccuracyMeters`, modify raw evidence, or create synthetic `LocationEvidence` observations.

At the original Visit occurrence, use a dedicated internal working-stay construction path only for a fully qualified support record. Populate saved identity from the proven catalogue association, retain the original Visit evidence ID and mark the working state as inferred. Its original coordinate stays broad.

**Do not pre-insert later GPS samples into `WorkingStay.evidence`.** The helper can analyse the complete retained input, but the occurrence-ordered state machine must consume point observations at their own times. Otherwise an early transition can accidentally see a future inside point. Finite Visit interval support and GPS point timing are different concepts.

Keep actual source IDs in the final stay lineage, with deterministic order and no duplicates introduced by support reuse. Include the original Visit and actual corroborating points/callbacks used by the episode. Do not invent new source IDs. For unchanged cases, preserve existing segment IDs; do not globally change `stableLocationId` or evidence ordering just to simplify new fixtures.

Do not treat the lower-precision Visit as a high-quality sample for centre, speed or sample-count decisions. Prefer the independent strong point cluster for the new inferred stay's representative centre; document/test this local rule without changing legacy weighting globally.

### 6.5 Arrival, departure and uncertainty

For the qualified, uncontradicted episode:

- The proposed stay start may use the native Visit's occurrence/arrival time.
- Start bounds must retain the evidence-supported interval from the Visit arrival to the earliest corroborating strong inside point; do not declare both bounds equal merely because one timestamp was chosen for display.
- The proposed stop may use the finite Visit departure when no later inside point or earlier credible departure contradicts it.
- Stop bounds must retain the available interval from the last compatible strong inside evidence to the Visit departure. A corroborated exit can narrow the bounds through the existing machinery; it must not invent precision.
- Maintain `lower <= chosen boundary <= upper`, positive duration and ordered non-overlapping adjacent endpoints where the engine contracts require that.
- If later inside evidence contradicts the Visit departure, do not freeze the stay at that old end. Fall back to the existing reopening/bounded transition rules and keep the inferred trust limitation.
- Supported dwell comes from the valid clipped interval and corroboration, not from the wall clock or an arbitrary midpoint.
- Keep finalisation at the existing ten-minute lag. Before finalisation, do not emit a final Review just to make the test visible.

This does not globally change #191's existing strong-Visit exact departure rule. It adds conservative bounds to the new weaker-spatial-evidence path only.

### 6.6 Confidence and automatic-policy safety

The new reconstructed saved stay is at most **medium confidence**, with `uncertain_gap` continuity to make the inferred character explicit within the existing representation. A high-quality point must not promote the weaker interval back to medium-high.

Maintain an **ephemeral internal set of boundary-inferred stay IDs** through commute derivation. Commutes whose actual arrival/departure boundary depends on that newly corroborated lower-precision Visit must be **low confidence**, so the existing medium saved-route automatic exception cannot promote them. This is a conservative representation choice, not a change to the automatic-policy table.

Do not lower confidence for unrelated or unchanged high-quality trips. Do not fabricate observation gaps or inflate time bounds merely to force policy rejection. Unit and DB tests must prove new inferred stays/affected commutes remain Review candidates under both `v2_review` and a synthetic `v2_enabled` evaluation, while unchanged eligible strong cases retain their existing policy outcome.

No rollout change is authorised. No new public/persisted provenance enum or migration should be necessary. If the existing representations cannot safely preserve the distinction through engine → persistence → policy, stop with a concrete design proposal rather than discarding the safety rule.

## 7. Authorised design B — stop unsupported arrival gaps becoming long commutes

### 7.1 Why a fallback is necessary

Some observations will fail Section 6 legitimately: the Visit is absent, too broad, lacks a finite departure, or lacks enough corroboration. The correct response is **not** to fill a 44-minute silence as attendance. It is also not to assume every minute before the later promoted gym stay was travel.

Add a narrow saved-destination arrival-conflict test before emitting a spanning commute. It must not mutate the destination stay into an earlier one or fabricate a hidden promoted stay.

### 7.2 Define a credible early-arrival witness

For a different-saved-destination candidate, an early witness requires:

- Same replay device and the actual destination saved ID.
- At least two distinct high-quality strong point observations at that saved place, at different times, spanning **at least two minutes and no more than the five-minute arrival-corroboration window**.
- Point geometry and available speed evidence are compatible with a brief stationary cluster, not a high-speed crossing. A speed inferred from the preceding travelling sample alone does not make the first arrival point a moving cluster; evaluate the cluster's own point pairs and any explicit speed values.
- Additional compatible arrival evidence: a genuine same-place geofence enter in the associated arrival window, or an accepted finite spatially compatible Visit starting in that window. A bare callback without the point cluster is insufficient.
- The cluster occurs after the origin's chosen departure and **before** the later promoted destination stay.
- The long interval between that cluster and the later same-place stay exceeds the existing route-continuity ceiling and has no credible intervening departure/away/re-entry route that explains continued travel.

A dedicated `savedArrivalWitnessMinimumSpanMs = 120_000` is permitted in the central engine config for this fallback. It is **not** a new saved-place dwell floor: a two-minute witness does not create a stay, Review item or entry. It only makes an unqualified continuous-travel interpretation unsafe.

Use narrow typed internal witness records. Their IDs refer to actual observations. Do not store them in a new journal, queue, table or cross-request cache.

### 7.3 Required behaviour

When a spanning different-saved-place commute crosses such an unresolved early-arrival witness, and no qualified corrected stay already supplies that early arrival, **omit that spanning commute suggestion**. Keep the later independently valid stay and genuine subsequent return trip. Preserve the raw evidence so a later valid Visit or user action can resolve it.

Do not shorten the commute and leave its `toStaySegmentId` pointing to a stay that begins 44 minutes later. Do not manufacture a provisional/canonical activity for the unresolved interval. The data model currently pairs actual stays; respect it.

Do not add a global maximum-gap rejection or suppress all low-confidence commutes. Preserve meaningful long travel with route evidence, existing different-place low-confidence cases without this specific arrival conflict, true same-place round trips, and known A→B→A transitions.

If the full corroborated Visit rule succeeds, ordinary commute derivation should use the corrected stay boundary; the fallback should not suppress that correctly bounded inbound commute.

### 7.4 Preserve route and origin rules

After changing a destination boundary, derive the route from actual observations within the new interval and recompute:

- route sample count and lineage;
- route/straight-line distance using existing definitions;
- maximum internal gap, rounded upward as now;
- qualification and confidence;
- start/stop uncertainty.

Do not keep the former 49m35s gap attached to an eight-minute commute, and do not count the broad Visit's coordinate as a route point. Preserve the origin-side late-support adjustment added for earlier false journeys. Do not hardcode a ten-minute gym journey or subtract a remembered workout duration.

## 8. State and provenance invariants

### 8.1 Pure engine

For the same accepted input, catalogue, configuration and `processingAt`, results must be deterministic and input arrays/objects must remain unchanged. Arrival support is recomputed per invocation, keyed by actual saved/device identity, not cached across accounts.

Preserve the engine's one-device precondition. No cross-device Visit-to-GPS corroboration. A same-name second place cannot lend support. Two close saved places cannot be merged by textual similarity.

Do not change evidence-format/algorithm identity merely to avoid old rows. This is a code-versioned correction within `location-v2.0`, as #199 was. Native evidence IDs, client batch IDs and acknowledgement timestamps remain unchanged. Old and new app versions must remain wire-compatible during rollout.

### 8.2 Mobile ownership and persistence

The existing mobile Location journal and account-scoped serial transaction remain the only local derivation owner. A complete journal replay replaces derived snapshots atomically, including empty output. Upload batches are not complete replay input and may never drive snapshot pruning.

The new engine result may change local derived segment IDs. It must not change raw journal data, pending upload payloads/IDs, Review outbox effects, receipts or another account's snapshots. On restart, the new binary recomputes through the existing path; do not add a migration or reset to force an update.

Canonical Today/Review presentation still comes from the existing server presentation/outbox owners. Do not render raw evidence as completed or provisional Today time to compensate for a held server result.

### 8.3 Server replay and changed identities

Reuse `replayLocationEvidence`, `excludeProtectedReplacements`, `retireOpenReviewsForMissingSegments`, existing segment persistence and the Review emitter. No per-segment SQL, second transaction or new sync owner.

Expected behaviours:

| Existing state | Correct action on improved arrival inference |
| --- | --- |
| Wrong stay/commute still an open, unmodified proposal | Existing replay may supersede/update it and emit the corrected open proposal atomically, with explicit provenance |
| Accepted/confirmed source, including the real gym item | Preserve canonical decision, entry, receipts, fields and protected source lineage; do not create a competing replacement |
| Ignored source | Preserve ignore/terminal semantics; do not resurrect it through a changed segment ID |
| Manual correction, including open manual Review | Preserve it exactly; do not infer that open means unprotected |
| Shared long Visit used by a genuinely distinct later episode | Shared Visit alone must not suppress that later episode; require actual occupied-source protection as already implemented |
| Evidence naturally expired | Do not treat absence as proof an old Review is obsolete; retain existing retention safeguards |
| New inferred start crosses backwards over semantic cutover | Keep the existing cutover suppression; do not move the acknowledgement to get the desired result |

A corrected stay may be held because it conflicts with a user-confirmed old fragment. That is expected safety, not permission to relax protection. Associated commutes must not be emitted with unresolved/pseudo endpoint IDs. This is particularly important now that KB has confirmed the historical gym stay.

If tests reveal an actual hole in existing changed-ID protection, allow only a directly necessary, bounded correction in the existing owner. First reproduce it; do not remove predicates. If it requires a new schema, new persistence owner or broad policy change, stop for explicit authorisation.

### 8.4 Quick Confirm and receipts

Meaningful boundary/identity changes must continue to invalidate a previously captured proposal hash. An uncommitted old Quick Confirm may require refresh and a new explicit decision. A committed old receipt must continue to replay exactly once without restoring overwritten fields or duplicating entries.

Do not change `review-proposal-hash.ts` merely to keep stale UI requests accepting after an intentional time change. The #197 revision-only churn fix remains intact. Use the existing durable Review outbox, not direct Today-specific mutation logic.

## 9. Likely files and scope budget

| File/area | Expected role |
| --- | --- |
| `packages/shared/src/location/segmenter.ts` | Integrate corroborated finite Visit support with existing working-state lifecycle |
| `packages/shared/src/location/savedPlaceArrivalSupport.ts` (new, suggested) | Pure support/witness analysis, contradiction checks and internal provenance |
| `packages/shared/src/location/commute.ts` | Narrow arrival-conflict suppression and inferred-boundary confidence propagation |
| `packages/shared/src/location/config.ts` | Only clearly named new corroboration/witness constants/type fields |
| `packages/shared/src/location/types.ts` | Only if an internal type belongs here; preserve existing wire/persisted types |
| `packages/shared/test/saved-place-arrival-boundaries.test.ts` (new, suggested) | Baseline incident, eligibility, veto, fallback, confidence and determinism tests |
| Existing `saved-place-quality.test.ts` | Regression extension only where it directly asserts retained #199 behaviour |
| Synthetic fixture under shared test helpers or existing fixture pattern | One reusable, explicitly synthetic episode for shared/mobile/server tests |
| `scripts/fixtures/location-saved-place-quality.ts` or narrow sibling | Real PostgreSQL open/terminal/manual replacement, lineage, receipt and rollback tests |
| Existing Location DB/SQLite validator wiring | Include new fixture in the established guarded runner, no second testing framework |
| Relevant mobile Location store tests | Prove new shared output survives existing SQLite replacement without queue mutation |
| `docs/plans/saved-place-arrival-boundaries-v1.md` | This plan |
| `docs/investigations/2026-09-17-saved-place-arrival-boundaries.md` | New safe evidence/results/deviations ledger |
| `docs/PRD.md`, `.codex/reference/location-learning.md`, regression checklist, tracker | Small durable behavioural/validation updates |

`apps/web/src/lib/location/location-replay-service.ts` is **test/protection inspection first**, not presumed implementation scope. `location-ingest-service.ts`, Review batch persistence, `sync-transaction.ts`, native modules, mobile scheduling and UI must remain unchanged unless a substantiated directly necessary defect is escalated and approved.

Prefer a small helper plus focused integration over a segmenter rewrite. Do not fix unrelated imports, lint warnings, old broad docs snapshots, the `expo-symbols` dependency, animation, category-to-activity renaming or Today labels.

## 10. Synthetic fixtures and baseline reproduction

### 10.1 Required baseline fixture

Create a deterministic synthetic saved-place journey with a clearly artificial venue/name/coordinates and at least 800 m endpoint separation. Use real UTC instants corresponding to the reported sequence, not real route coordinates.

Suggested local-time shape, converted to UTC in test data:

- A well-supported origin stay before approximately 12:24 BST.
- Real synthetic route points between departure and arrival.
- Completed Visit at synthetic venue: 12:32:51–13:34:53 BST, illustrative accuracy 120 m.
- Same-place geofence enter at 12:33:26 BST, coordinate-free where representative.
- Two or more strong inside points in the arrival band, ending at 12:36:18 BST; use chosen 10–25 m accuracy and clearly stationary synthetic positions.
- No point observations until around 13:21 BST.
- A later independently supported inside cluster spanning at least five minutes and supporting the departure band.
- A compatible departure and route back around 13:34–13:41 BST.
- Enough destination support for the return to qualify independently.
- `processingAt` after finalisation; semantic acknowledgement safely before the episode in DB fixtures.

Record the unchanged-main output before implementation. Reproduce both the late promoted stay and the overextended inbound, or document the minimal adaptation required. Do not force exact minute-rounded screenshots; assert exact timestamps/relations from the synthetic fixture.

Expected corrected **unconfirmed** fixture outcome:

- One saved-venue stay starting from the corroborated Visit arrival, not 13:21.
- Stop supported near the original Visit departure, not an arbitrary later point.
- Inbound stop equals that corrected destination start.
- No inbound commute absorbs the 44-minute stationary gap.
- Return time remains supported and materially unchanged in the fixture; confidence may become more conservative where the new inferred boundary is used.
- Saved stay remains a Review proposal, not an automatic entry.

### 10.2 Required insufficient-support fixture

Use the same early arrival witness and later stay but remove/disable full interval support (for example, no usable completed Visit). Prove:

- No invented hour-long saved stay.
- No overextended commute through the unresolved early-arrival interval.
- The independently valid later saved stay and return remain.
- A single geofence callback or momentary crossing alone does not trigger this behaviour or create a stay.

### 10.3 Mixed-history fixture

Use a finite multi-day synthetic workload with unchanged strong visits, unknown stays, real same-place loops, two different saved places sharing a name, and one affected lower-precision Visit episode. Prove only the intended episode/provenance-dependent commutes change. Do not rewrite all existing expected IDs/hashes because a new helper changed iteration order globally.

## 11. Test matrix — write assertions, not just smoke tests

Use table-driven cases where practical. The following is the acceptance contract, not a requirement to run the entire repository after each individual edit.

### A. Support eligibility and boundaries

| ID | Case | Required assertion |
| --- | --- | --- |
| A01 | Synthetic gym, accepted 120 m Visit, strong early/later clusters | One correctly bounded inferred saved stay; inbound arrival fixed |
| A02 | Accuracy 65 m | Existing high-quality path unchanged |
| A03 | Accuracy just above 65 m | New path only with full corroboration; at most medium stay confidence |
| A04 | Accuracy exactly 200 m / just above 200 m | At-ceiling requires corroboration; above-ceiling never recovered by this rule |
| A05 | Null/nonfinite/invalid accuracy or missing coordinate pair | New support rejected; no fabricated precise match |
| A06 | Open, invalid, reversed or future Visit departure | No full-interval support; no processing-clock attendance |
| A07 | 299,999 ms versus 300,000 ms supported window | Original five-minute floor remains exact; new corroboration cannot waive it |
| A08 | One early strong sample or duplicated same-time sample | Not enough independent corroboration |
| A09 | No later cluster / later cluster below five-minute support | No reconstruction of the entire quiet interval |
| A10 | Later strong witness too far before Visit end | New broad Visit support not accepted as an unbounded tail |
| A11 | Reconstructed start/stop bounds | Chosen times fall within ordered evidence bounds; no false zero uncertainty |
| A12 | Later inside observation after Visit departure | Earlier departure cannot terminate contrary attendance without normal reconciliation |
| A13 | Geofence state or unrelated region callback | Never becomes an arrival or evidence of continued attendance |
| A14 | Same saved-name, different IDs / ambiguous candidates | No cross-place support or ID inference from name |
| A15 | No geofence registration but all required point/Visit support | Full corroborated path can work without a mandatory geofence callback |

### B. Contradiction and continuity preservation

| ID | Case | Required assertion |
| --- | --- | --- |
| B01 | A→B→A inside a long broad Visit | No join across B; retain distinct episodes |
| B02 | Two high-quality outside/moving points before Visit departure | New full-interval support vetoed; actual departure not erased |
| B03 | One noisy outside point | Does not on its own invent a confirmed departure or strengthen support |
| B04 | Unresolved exit during quiet interval | Weak Visit cannot override it merely because its end is later |
| B05 | Exit cancelled by strong same-place return within existing grace | Preserve #199 chatter behaviour; no tiny false visit |
| B06 | Repeated exits / restoration pair | Not independent motion; preserve existing five-second restoration handling |
| B07 | Point-only gap 30 minutes / 30 minutes plus 1 ms | Existing boundary remains; no global extension to 44 or 60 minutes |
| B08 | Accepted learned-place / unknown-place episodes | Existing learned and unknown continuity rules unchanged |
| B09 | Reliable old high-quality Visit with long quiet interval | Still supported through existing path; no unnecessary confidence downgrade |
| B10 | Simulated evidence / another device | No new inferred trusted episode; one-device isolation stays enforced |

### C. Commute fallback and policy

| ID | Case | Required assertion |
| --- | --- | --- |
| C01 | Corrected full stay exists | Shortened inbound emitted with actual endpoint ID/time and recomputed route metrics |
| C02 | Credible early-arrival witness, no full stay support | Conflicting spanning commute omitted; gap not turned into a fabricated stay |
| C03 | Witness under two minutes / sole callback | No new fallback claim from weak evidence; no stay promotion |
| C04 | Long but sampled journey without an arrival conflict | Existing commute qualification preserved |
| C05 | Actual travel after a brief intermediate visit | Do not falsely classify a supported continuation as quiet stationary time |
| C06 | Genuine same-place round trip | Existing route/excursion/speed requirements and output preserved |
| C07 | Origin-side late support | Earlier July boundary correction still applies |
| C08 | New inferred boundaries under `v2_enabled` policy evaluation | Saved stay and affected commutes remain Review; medium exception cannot silently auto-confirm |
| C09 | Unchanged eligible strong commute under `v2_enabled` | Policy result remains unchanged |
| C10 | New shorter route | No inherited old max-gap/sample/distance figures; no Visit coordinate counted as travelling |

### D. Determinism, time and state

| ID | Case | Required assertion |
| --- | --- | --- |
| D01 | Reverse/shuffle delivery and duplicate actual observations | Stable segment content and identities; unchanged input objects |
| D02 | Completed Visit delivered later but occurred earlier | Correction uses occurrence times, not delivery time |
| D03 | Partial evidence batch versus full journal | Only complete journal reprocessing can replace snapshots; no destructive partial pruning |
| D04 | Repeated processing with frozen time | Identical logical output and no duplicates |
| D05 | Clock advances without new evidence | Only legitimate finalisation/exit-grace behaviour; no attendance growth from clock alone |
| D06 | Midnight and Europe/London DST repeat/skip intervals | Duration uses UTC instants, local-day reporting stays correct |
| D07 | Very many unrelated observations/Visits | No unbounded helper state or new per-visit database work |
| D08 | Same raw identity across backend/account changes | No cross-owner support or snapshot/queue mutation |

### E. Real database and mobile integration

| ID | Case | Required assertion |
| --- | --- | --- |
| E01 | Seed old open late-arrival stay/inbound and replay corrected fixture | Old open proposals retire/replace atomically; corrected open Review fields and lineage agree with shared output |
| E02 | Accept old gym stay first, then replay | Preserve canonical time entry, event, Review, receipt and protected lineage; no expanded/duplicate entry |
| E03 | Accept old inbound commute first | Preserve that decision; no overlapping competing corrected result through changed IDs |
| E04 | Ignore / manual / split / merge source states | No resurrection, overwrite or receipt corruption; use existing mutation owners |
| E05 | Distinct later episode shares a long Visit | Do not suppress solely from shared Visit ID or timestamp proximity |
| E06 | Failure after retirement or after an early persistence chunk | Entire transaction rolls back; no missing old proposal with an uncommitted replacement |
| E07 | Old uncommitted proposal hash after meaningful boundary change | Reject safely; no hidden hash/envelope rewrite |
| E08 | Already committed old receipt replay | Exact-once result; no second time entry |
| E09 | Corrected boundary crosses semantic cutover | Existing gate suppresses as intended; no acknowledgement reset |
| E10 | Logging disabled / no default category | Existing suppression/default rules; place name must not become an invented category |
| E11 | SQLite full-snapshot replacement, restart and rollback | Derived IDs converge; raw evidence/outbox/Review effects remain untouched |
| E12 | Scope isolation and empty replay | Other owners unaffected; empty complete output handled safely, retention is not deletion proof |

## 12. Local implementation sequence

### Step 1 — establish baseline, fixture and contracts

Create the branch and document the base. Read relevant files. Add the synthetic fixtures and failing expectations for the affected case. Record the baseline late arrival/inbound span, not just that an assertion failed. Preserve the old passing suite.

Inspect the private input when already available, and state whether the synthetic eligibility reflects it. Do not claim exact incident reproduction from a guessed 120 m Visit.

**Checkpoint:** failing synthetic tests describe this bug; no runtime change yet; scope/representations understood.

### Step 2 — pure support analysis

Implement the small support/witness helper. Tests cover eligibility, distinct witnesses, place ambiguity, actual interval bounds and vetoes before integration.

Index observations by saved identity and occurrence time once where practical. Avoid scanning all evidence separately for every point or materialising N copies of the journal. Keep work comparable to the existing finite replay, without introducing a new unbounded quadratic stage. There are no external calls in this helper.

**Checkpoint:** helper tests show it is conservative, deterministic and independent of delivery order.

### Step 3 — integrate with existing state machine

Use support at the appropriate original Visit occurrence, keep lower precision and future-point handling honest, and preserve pending-exit/contradiction precedence. Do not rewrite ordinary point/Visit segmentation. Add/verify conservative bounds and confidence.

**Checkpoint:** affected fixture yields the corrected unconfirmed stay; #199 tests remain green.

### Step 4 — destination/commute integration

Use corrected stay endpoints naturally. Add narrow fallback suppression only for the defined early-arrival conflict. Carry internal inferred-boundary information through derivation so new weak-boundary trips cannot auto-confirm. Recompute actual route metrics. Do not create hidden stays or change existing unrelated commute qualification.

**Checkpoint:** both recovered-interval and insufficient-support fixtures are truthful; long/same-place/unknown regression cases still pass.

### Step 5 — persistence/protection validation

Extend established local PostgreSQL and mobile/SQLite tests. Seed old proposal state synthetically; do not replay real accounts. Test open replacements separately from already confirmed/manual/ignored rows, and include an explicit historical-gym-confirmation case.

If new output exposes a directly necessary existing protection hole, reproduce and isolate it before proposing changes. Do not bypass it to make the synthetic output match desired counts.

**Checkpoint:** new inference survives real persistence; rollback, lineage, receipts and owner isolation hold.

### Step 6 — performance regression and docs

Run the existing #202 reliability fixture and finite delay profiles without changing #202's implementation, timeout caps or chunk sizes. Unaffected fixture fingerprints should stay unchanged. A changed fingerprint is an investigation, not a value to blindly update.

Add a finite arrival-rich workload near the observed ~1,040 evidence-row scale when needed to exercise the helper's cost. Compare equivalent local runs at the same base/head, processing time and input. Log only safe counts and elapsed values; do not claim p95 from a few runs.

For unaffected workload, aim for no material shared-engine/replay regression. Investigate an increase greater than the larger of 20% or 50 ms in median engine time across a small fixed set of like-for-like runs; this is a regression trigger, not a promise of production timing. Existing local 20/40 ms profiles must still pass. The finite 85 ms deadline test remains a safety test expected to terminate/roll back, not a throughput failure to optimise away.

Update the scoped documents. Do not mix transient deployment status into permanent product policy.

### Step 7 — one final validation pass and draft-PR handoff

Run the commands in Section 13 appropriate to changed files. Inspect the final diff/status, verify no generated native files, private fixtures or unrelated modifications slipped in. Commit, push, open one draft PR and report Section 16. Stop.

## 13. Commands and validation discipline

All commands below run at the root of the isolated implementation worktree. Commands are examples tied to current workspace names; verify actual files/scripts before running. Do not create nonexistent scripts just to match the plan.

### Focused development

```bash
npm run test -w @dayframe/shared -- test/saved-place-quality.test.ts test/saved-place-arrival-boundaries.test.ts
```

Success: the new arrival/fallback tests and existing saved-place safeguards pass. Add the actual relevant commute/automatic-policy test paths after locating them. Run only affected mobile/web tests while iterating.

### Database validations

Use the already verified task-owned local `_test` database through the validator's existing environment configuration. Never paste connection strings or passwords into reports. Do not use copied hosted `.env` files.

```bash
npm run validate:location-v2-db
npm run validate:location-v2-sqlite
npm run validate:review-mutation-db
npm run validate:location-reliability
```

These must exercise the new fixtures where relevant. The SQLite shell script alone is not proof that React Native executed the new engine; retain an actual mobile store/shared-engine integration test as well.

Run `npm run validate:sync-transactions` if transaction/protection code is changed or required by the real rollback path under test. Do not repeatedly rerun unrelated Health/native validators. PR CI may run additional checks asynchronously.

### Final broad pass — once near handoff

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:docs
git diff --check
```

`lint` already includes docs/config checks; avoid running the whole list repeatedly after tiny unrelated edits. Consolidate outputs into one ledger. A later narrow documentation correction needs docs/diff checks, not another entire native cycle.

If the existing mobile `expo-symbols` TS2307 occurs, verify it against the clean base and report the exact unchanged baseline failure. Do not install/upgrade dependencies or suppress errors to obtain green. Also report web/shared typechecks separately. New TypeScript failures are blockers.

A local clean iOS Simulator build is not required for a shared TypeScript-only change. Leave Clean iOS Simulator CI asynchronous; Codex must not wait for it. If Swift/native config unexpectedly becomes necessary, stop for scope approval.

## 14. Documentation classification and evidence ledger

This PR changes product inference behaviour and its validation contract. Documentation impact is **required**, but updates must stay focused:

- **PRD:** explain conservative corroborated saved-place interval support and the rule that an unresolved arrival gap is not automatically travel. Preserve category-first UX and automatic-policy intent.
- **Location-learning reference:** define the new witness conditions, unchanged global thresholds, departure vetoes, confidence treatment, fallback suppression and shared/mobile rebuild requirement.
- **Architecture:** only a small clarification if a new internal data-flow/provenance contract needs recording. State that the same engine/owners persist; do not paste the fixture or release log.
- **Regression checklist:** arrival-band accuracy, broad Visit corroboration, fallback, A→B→A, confirmed-old-state preservation, Quick Confirm and local/server parity checks.
- **Tracker:** new work is implementation pending until merged; #202 remains merged/staging-accepted with production evidence distinct. Do not claim the historical gym entry was repaired automatically.
- **Investigation:** record safe baseline output, explicit design choices, test/measurement results, deviations, missing evidence and later acceptance criteria. Leave older investigations historical.

Do not add real place coordinates, account IDs, device IDs, tokens, raw routes or private filesystem secrets. Generic synthetic fixtures can contain invented coordinates. Local private evidence filenames may be referenced in a private handoff, not exposed as a public download.

The ledger must distinguish:

1. Source-observed baseline facts.
2. Synthetic fixture assumptions.
3. Implemented changes.
4. Verified outcomes.
5. NOT RUN/unknown outcomes.

Do not label a malformed operator request as a failed engine test. Do not claim identical input from counts alone. Do not lose the exact before/after affected-ID set and later ask another agent to reconstruct it.

## 15. Stop and escalation conditions

Stop, preserve work and give a concrete report rather than widening scope when:

- Current main materially conflicts with this plan.
- Required local environment is broken after the single narrow recovery allowance.
- The real trace reveals that recovery requires evidence beyond the acceptance ceiling, nonexistent coordinates, relaxed global radii, invented arrival times or weakened contradiction guards.
- The only way to pass is to overwrite an accepted/ignored/manual source or reset a cutover/queue.
- A new migration, public wire contract, native change, scheduling owner or database access policy is needed.
- The new inference cannot remain conservative under the existing automatic-policy path without a material policy/schema change.
- An unaffected engine/persistence fingerprint changes without an understood reason.
- Protection/receipt/rollback/account-isolation regressions remain.
- #202 performance protections regress materially or require new per-segment SQL.
- More than two materially different algorithm approaches have been tried without meeting the primary and negative fixtures. Do not tune thresholds repeatedly until the one positive fixture passes.

Ordinary focused debugging is allowed; this is not a stop after each phase. Do not request permission for routine edits already inside the plan. Report the smallest missing decision, not a request to own the release lifecycle.

If substantive implementation is incomplete, say so. Never label a draft PR or green unit tests as hosted repair. A useful blocked branch/report is preferable to a speculative safety regression.

## 16. Required Codex handoff and hard stop

The draft PR/handoff must include:

- Verified base SHA, final head SHA, branch, clean/dirty status.
- Actual changed-file inventory and documentation classification.
- Baseline reproduction and synthetic-versus-real trace status.
- One paragraph explaining the Visit support rule and one explaining fallback behaviour.
- Exact added config values and why ordinary limits stayed unchanged.
- Unconfirmed fixture output before/after: arrival, stay interval, inbound/return intervals, confidence and source IDs represented by synthetic names.
- Confirmed-old-gym preservation result.
- Quick Confirm meaningful-change and receipt-compatibility results.
- Local mobile/SQLite/shared/server parity evidence.
- Baseline/head performance comparison and #202 validator outcomes.
- Commands actually run with PASS/FAIL/NOT RUN, including baseline-only failures.
- Limitations, private trace conditions not reproduced, and scope decisions still needed.
- Explicit statement that CI observation, Claude, Preview promotion, hosted replay, signed build, physical acceptance, production and merge were NOT RUN by Codex.

**After commit, push and draft-PR report: STOP.** No CI polling, Vercel waiting, Claude invocation, build/install, staging promotion, hosted replay, automatic fixes from another reviewer, merge or production action.

## 17. Later independent review — not executed by Codex

Claude reviews the complete PR diff against exact base/head and this same plan. Inspect new positive/negative cases, not just whether tests passed. Key risks:

- Broad coordinate accidentally upgraded into a strong place match.
- Future corroborating points consumed before their occurrence.
- Weak interval cancels a genuine departure or joins A→B→A.
- A brief arrival witness becomes a fabricated stay or broad commute rejection.
- Arrival correction bypasses endpoint identity/lineage or origin-side correction.
- Medium-confidence automatic-commute loophole.
- Confirmed old gym state overwritten/duplicated by changed IDs.
- Expired evidence mistaken for obsolete-source proof.
- Synthetic success misrepresented as the private incident reproduced.
- Added helper loops/queries undoing #202 performance benefit.

Findings: Blocker / Important / Nice-to-have, with file/line, consequence, evidence and correction. If no Blocker/Important exists, say APPROVE for the exact head. Tests not run by reviewer must be explicit. No invented findings, unrelated cleanups or auto-fix/deploy sequence.

## 18. Later staging preparation and acceptance — OpenClaw/KB, separate authorisation

### 18.1 Prepare the exact server and signed app

After review/fixes settle, verify the final head and checks. Confirm the exact Ready Preview is staging-backed and reports `v2_review` through the authenticated runtime before promoting it to `https://dayframe-staging.vercel.app`. Do not infer secrets/backend from masked values. A required login is a manual step, not a reason to alter credentials.

No migration is expected. If one appears, stop and review that scope before hosting it.

Only after exact final Preview promotion, build/install the signed staging app containing the same final shared engine:

- Bundle `com.layereight.dayframe.staging`.
- API `https://dayframe-staging.vercel.app`.
- Isolated staging App Group and Keychain.
- Preserve app data; no uninstall/reset.
- Verify source SHA/build identity, signing and installed API binding, not only the version label.
- Use the currently verified compatible local toolchain. The previous successful Xcode 26.6 setup is historical evidence, not permission to modify machine tooling in this task.

No production/TestFlight build or deployment is implied by staging preparation. Old production clients may still compute old local boundaries until a separately authorised release; compatible API does not mean matching algorithm behaviour.

### 18.2 Scripted staged correctness, not an unchanged-output check

This PR intentionally changes some open proposal boundaries. Do not reuse #202's requirement for all proposal fields to remain identical.

Prepare complete, readable owner/device-scoped before/after snapshots, preserving exact affected IDs, catalogue, input identity/content fingerprints and `processingAt`/retention context. Use private storage with verified files and checksums. Counts alone are insufficient. Pause interactive confirmations/category/place edits during a controlled comparison; do not clear durable queues.

Preferred initial server test uses a staging test owner and synthetic fixture through existing authorised ingest/replay routes. Seeding test data and replay are writes and require a separate explicit OpenClaw instruction; they are not authorised by Codex's implementation prompt. For a hosted synthetic test, use an already acknowledged test-device scope and shift the entire synthetic timeline consistently into a retained, post-cutover interval that has already passed finalisation. Preserve the relative gaps. Do not reset the acknowledgement, backdate its receipt, send a processing clock in the API body, or treat a suppressed pre-cutover replay as a positive acceptance result. If no such interval/test owner exists, report the precise readiness requirement.

For real retained data, do not force backfill or reset semantic acknowledgement. Use only an explicitly authorised bounded replay/ordinary foreground. Validate any operator-generated body against `LocationReplayRequestSchema` first; use actual device/mode/acknowledgement and no extra `processingAt`, `timeZone` or raw evidence fields.

Classify each affected old source as: unchanged/protected; explicitly superseded with linked current provenance; meaningfully updated open proposal; new evidence-supported source; or unexplained. Do not infer identity from a matching description/time alone. Retain exact diff sets, including zero-case proof.

Observe normal engine timers without repeated manual retries. Same raw evidence can finalise differently as time advances; document legitimate effects rather than altering the clock or claiming inputs were identical.

### 18.3 Physical test KB should perform

Use the ordinary signed **staging** app after OpenClaw confirms readiness.

1. **Fresh sustained saved-place visit:** note approximate departure, arrival and leaving times. Travel normally, remain at the venue for at least 30–60 minutes, then leave. Do not repeatedly foreground or press Sync during the trip. After normal finalisation time, foreground once. Expect a sensible arrival near actual arrival, a sustained saved-place Review, and inbound travel not enlarged by stationary silence. This is the primary acceptance case.
2. **Brief boundary crossing/parking:** a sub-five-minute crossing must not become a new saved-place visit merely from geofence entry or a broad Visit. Record whether a real corroborated departure/re-entry occurs rather than assuming every callback is travel.
3. **Genuine departure and return:** make/observe a real A→B→A example when practical. Separate visits must remain separate; do not use a long Visit to merge them.
4. **Quick Confirm:** only after the measurement snapshots, confirm one accurate fresh suggestion. Expect one canonical entry, no duplicate, the pending proposal gone only after the usual local/canonical handover, and no new Needs-attention loop. Do not confirm knowingly incorrect timestamps for test convenience.
5. **Existing confirmed history and basic regressions:** previously accepted gym/Home entries retain chosen times; timer start/stop, category/tags, Review refresh and web/mobile convergence still work. Mark any case not performed NOT RUN.

No need for a long UI/accessibility redesign matrix: layout is unchanged. Check ordinary VoiceOver/large-text readability only for affected existing confidence/time presentation and record limitations honestly.

### 18.4 Performance and release gate

The staged run should keep the #202 improvement: successful ordinary replay with useful headroom, no new persistent 503/lock regression, and no new unbounded query growth. Record workload and all naturally observed requests; do not call five requests 'one foreground caused five' without trigger evidence.

A one-off slow network measurement is not proof of engine CPU regression. Conversely, a local fast engine is not hosted performance proof. Stop on repeated timeout or a concrete regression; do not raise budgets.

Merge only after exact-head review/checks and relevant staging/physical results pass, with explicit KB approval. Keep extended rare-event soak as Watch rather than claiming perfect location accuracy. Production deployment and runtime observation remain separate, explicitly authorised gates.

## 19. Definition of done

Implementation can be handed off only when:

- The positive synthetic case is fixed with explicit source-backed boundaries.
- The insufficient-support case does not fabricate either attendance or continuous travel.
- All newly inferred output remains conservative under existing policy.
- Ordinary high-quality/learned/unknown/round-trip behaviour and #199 safeguards remain covered.
- Raw data, retained IDs, owner boundaries, terminal/manual history and receipts are protected.
- Complete local/shared/server persistence behaviour is tested, not merely DTO snapshots.
- #202 performance guards and bounded SQL remain intact.
- Required docs and PASS/FAIL/NOT RUN ledger are present.
- One focused draft PR is open; Codex has stopped.

Release is done only after the separately recorded final-head staging server, final-head signed app and physical acceptance gates. This plan does not authorise automatic merge or production rollout.

## 20. Source references

Repository references were inspected at planning baseline `63d61d83013331457b8c4ff4b5243ed9e418ac0d` unless identified as historical. Path/function references are more durable than line numbers; re-resolve lines in the implementation branch.

- **R1:** GitHub PR #203 and current main: https://github.com/kwabiwe/dayframe/pull/203 ; https://github.com/kwabiwe/dayframe/tree/63d61d83013331457b8c4ff4b5243ed9e418ac0d
- **R2:** Shared segmenter: https://github.com/kwabiwe/dayframe/blob/63d61d83013331457b8c4ff4b5243ed9e418ac0d/packages/shared/src/location/segmenter.ts — `preprocess`, `accurateCoordinate`, `strongSavedPoint`, `stayFromWorking`, `runLocationEngine`, pending-exit/Visit support.
- **R3:** Config: https://github.com/kwabiwe/dayframe/blob/63d61d83013331457b8c4ff4b5243ed9e418ac0d/packages/shared/src/location/config.ts
- **R4:** Commute derivation: https://github.com/kwabiwe/dayframe/blob/63d61d83013331457b8c4ff4b5243ed9e418ac0d/packages/shared/src/location/commute.ts
- **R5:** Matcher/types: `packages/shared/src/location/placeMatcher.ts` and `types.ts` at the same SHA. Existing allowance, candidate ordering and segment representations.
- **R6:** Automatic policy: https://github.com/kwabiwe/dayframe/blob/63d61d83013331457b8c4ff4b5243ed9e418ac0d/packages/shared/src/location/automaticPolicy.ts
- **R7:** Server owner/protection: https://github.com/kwabiwe/dayframe/blob/63d61d83013331457b8c4ff4b5243ed9e418ac0d/apps/web/src/lib/location/location-replay-service.ts
- **R8:** Mobile owner: https://github.com/kwabiwe/dayframe/blob/63d61d83013331457b8c4ff4b5243ed9e418ac0d/apps/mobile/src/lib/location/store.ts
- **R9:** Historical origin-boundary evidence: https://github.com/kwabiwe/dayframe/blob/63d61d83013331457b8c4ff4b5243ed9e418ac0d/docs/investigations/2026-07-25-commute-boundary-recovery.md . Historical endpoint-only wording is not current policy; defer to current code/tests.
- **R10:** Current guardrails: `.codex/reference/location-learning.md`, `docs/PRD.md`, `docs/architecture.md`, `AGENTS.md`, `docs/documentation-governance.md`, `docs/feature-fix-tracker.md`.
- **R11:** #199 regressions: `packages/shared/test/saved-place-quality.test.ts`, `packages/shared/src/location/savedPlaceQualityFixture.ts`, `scripts/fixtures/location-saved-place-quality.ts`.
- **R12:** Validators: `package.json`, `scripts/validate-location-v2-sqlite.sh`, `scripts/validate-location-reliability.ts`, existing DB/Review validator scripts. Test commands must be checked against fresh checkout.
- **E1:** KB/OpenClaw's 17 September 2026 gym trace and subsequent Quick Confirm receipt report supplied in this conversation. Not a public/raw-data attachment; exact trace details not independently re-executed during planning.
- **A1:** Apple CLVisit documentation: https://developer.apple.com/documentation/corelocation/clvisit
- **A2:** Apple Visit horizontal accuracy: https://developer.apple.com/documentation/corelocation/clvisit/horizontalaccuracy
- **A3:** Apple Visit departure date: https://developer.apple.com/documentation/corelocation/clvisit/departuredate
