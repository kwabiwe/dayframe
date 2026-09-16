# Dayframe — Saved-place detection quality

**Version:** 1.0\
**Prepared:** 15 September 2026\
**Planning baseline:** `5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a` — freshly checked `main`, including merged PRs #197 and #198.\
**Suggested branch:** `fix/saved-place-detection-quality`\
**Suggested PR title:** `fix(location): enforce meaningful dwell and preserve saved-place continuity`\
**Repository location for this plan:** `docs/plans/saved-place-detection-quality-v1.md`\
**Implementation target:** a self-contained plan for Codex with Terra Max. Use the owner's selected model; do not change models mid-session.\
**Independent review:** OpenClaw invokes Claude Opus 5 / low, read-only, in a separate job.

## 0. Job boundary — read before starting

This authorises **one focused implementation PR from fresh main**, not the whole release lifecycle. Do not reuse the merged #197 or #198 branch, create a stacked branch, or preassign the next PR number.

The implementation session owns Sections 1–11: verify the baseline, reproduce, implement, run focused checks and one final broad pass, review the diff, commit, push, open a draft PR, report, then **STOP**. Section 12 is a later acceptance checklist for OpenClaw and KB, not permission for Codex to deploy or test the phone.

**After opening/updating the draft PR, do not:** poll CI/Vercel; wait for hosted jobs; invoke Claude; promote staging; build/install iOS; replay real accounts; merge; change production; or start the next task. No Expo/EAS login is required. Later signed-device work uses local Xcode.

Classification: product behaviour and shared Location-engine correctness, with tightly bounded persistence integration and regression coverage. No visual redesign, native capture change, migration, dependency update or new sync owner is intended.

## 1. Outcome and scope

### User-facing outcome

A brief crossing of a saved-place radius must not become its own meaningful visit. A sustained visit must not turn into several Review items merely because of one uncorroborated boundary callback or a supported quiet reporting interval.

For the reported parking/gym sequence, aim for **one evidence-supported substantial gym visit, no standalone sub-five-minute parking fragment, and legitimate surrounding commutes**. Do not hard-code the owner's approximate building-entry/departure times into the algorithm or pretend the raw observations establish precision they do not contain.

### In scope

1. Enforce the existing five-minute minimum on the effective known-place stay, including completed-Visit-backed fragments.
2. Treat a same-saved-place geofence exit as a departure candidate; resolve it against supporting/contradictory evidence before splitting a visit.
3. Preserve compatible completed-Visit support and add a conservative, bounded same-saved-place quiet-gap rule.
4. Preserve real departures, returns, nearby distinct places, commute evidence, truthful uncertainty and deterministic replay.
5. Ensure new segmentation safely replaces obsolete **open** suggestions without rewriting terminal/manual decisions, duplicating canonical results or retaining obsolete current local snapshots.
6. Preserve #197's bounded batching and content-based Location Quick Confirm hashes.

### Explicitly out of scope

- Missing-return **native capture** investigation; no Swift, permissions, background tasks, GPS frequency or battery-profile change.
- Enabling `v2_enabled`, changing server mode, resetting the semantic acknowledgement/cutover, or changing production configuration. Staging remains `v2_review`.
- Increasing the PureGym radius or global matching/accuracy allowances.
- Category-to-Activity terminology, icons, Quick Confirm visuals, Today labels or time-entry accessibility.
- General Location learning, POI/geocoding, transport-mode inference, new analytics, new queues or coordinators.
- A general historical backfill/cleanup tool, automatic modification of accepted/ignored entries, or recovery of expired evidence.
- Another performance-tuning programme. Measure for regression; stop and report new bottlenecks.

The shared engine also feeds automatic mode. Test its existing safeguards locally, but do not claim hosted `v2_enabled` performance/acceptance: #197's semantic batching is specific to `v2_review`.

## 2. Evidence and limits

### 2.1 Owner-supplied incident trace, not a raw dataset

The following was supplied by OpenClaw after a read-only staging trace. All dates are 15 September 2026. BST is UTC + 1 hour.

| Evidence/result | UTC | BST | What it establishes |
| --- | --- | --- | --- |
| Inbound commute | 11:48–11:55 | 12:48–12:55 | Existing surrounding Review proposal |
| Saved gym fragment 1 | 11:55:29–11:56:09 | 12:55:29–12:56:09 | Approximately 40–41 seconds, below five minutes |
| Same-place exit callback | 11:56:43 | 12:56:43 | Closed fragment 1 using the existing midpoint rule |
| Saved gym fragment 2 | 11:58:52–12:05:48 | 12:58:52–13:05:48 | Last linked inside evidence before the quiet gap |
| Next linked inside evidence | 12:32:26 | 13:32:26 | 26 minutes 38 seconds after the preceding observation |
| Saved gym fragment 3 | 12:32:26–12:40:47 | 13:32:26–13:40:47 | Later part of the same reported physical visit |
| Completed native Visit | 11:55:29–12:46:44 | 12:55:29–13:46:44 | Retained interval support, not proof of exact building-door times |
| Outbound commute | 12:44–12:52 | 13:44–13:52 | Existing surrounding Review proposal |

All three gym suggestions were `needs_review`, `uncertain_gap`, and linked to the same saved place, with `suggested_category_id = null`. “PureGym” in the subtitle was the place label, not a category.

The trace found no linked/rejected observations explaining the central gap, but the read-only evidence API did not expose every unrelated accepted observation. **Do not claim complete raw-data absence.** Likewise, the later geofence callback and underlying outbound samples were not fully supplied. Do not invent them as historical facts.

The owner reports brief parking manoeuvres around 12:55, actual gym entry around 12:58 and departure around 13:40. A completed Visit extends beyond that reported departure. This is a reason to evaluate conflicting evidence, not blindly adopt either endpoint.

Create **synthetic-coordinate fixtures derived from these timings**, labelled as such. Do not commit private coordinates, device IDs, Review IDs, exported journals, tokens or raw source payloads. Use generic synthetic place names/IDs. Implementation does not depend on obtaining live phone access.

### 2.2 Baseline code findings

At the planning SHA:

- `stayFromWorking` promotes a saved/learned stay when `duration >= savedPlaceMinimumDwellMs || completedVisit`. The completed-Visit exception can admit a short fragment even when that Visit originally spans a much longer interval. [R2, R3]
- Same-place `geofence_exit` immediately closes the active stay, except for an existing five-second exit/enter restoration-pair check. [R2]
- A gap exceeding `maxContinuityGapMs` closes the active stay at its last supported point. The bounded sparse-gap exception applies to unknown clusters, not saved places. [R2, R3]
- Compatible-unknown coalescence deliberately excludes saved/learned places. Do not repurpose it into a global same-name/place merger. [R2, R7]
- Geofence V2 evidence contains place identity and callback time but no GPS coordinate. A callback is not an independent accurate outside fix. [R8]
- Mobile and server use the same pure engine. Mobile currently upserts local segment snapshots; server replays retained evidence, retires obsolete open sources, protects matching manual/terminal segment IDs, and preserves lineage. Changed segment identities therefore need explicit integration tests. [R4, R9]
- `v2_review` semantic emission has a separate unknown-stay duration guard, but no equivalent final known-place floor. Location Quick Confirm hashes are content-based after #197. [R5, R6]

### 2.3 Source versus design

The five-minute dwell, ordinary twelve-minute gap, ten-minute finalisation lag, matching radii and current protection contracts are baseline behaviour. The five-minute departure re-entry window and thirty-minute point-supported saved-place quiet-gap ceiling below are **proposed defaults for this PR**, not existing settings or Apple guarantees.

Apple describes Visit arrival/departure as approximate and permits incomplete arrival/departure information. Use valid native Visit evidence as interval support, not absolute truth that overrides contradictory observations. [A1]

## 3. Owners, primitives and likely files

| Responsibility | Existing owner / files | Planned treatment |
| --- | --- | --- |
| Deterministic segmentation | `packages/shared/src/location/segmenter.ts` | Main correction; small pure helpers or one adjacent private module are acceptable |
| Shared thresholds | `packages/shared/src/location/config.ts` | Keep existing values; add only the two named saved-place guard defaults if needed |
| Matching and distances | `placeMatcher.ts`, `geo.ts` | Reuse; no radius expansion or unrelated ranking change |
| Types / public exports | `types.ts`, `location/index.ts`, `packages/shared/src/index.ts` | Minimal only; avoid persisted protocol changes |
| Commute derivation | `commute.ts` | Regression target; no new qualification policy |
| Automatic policy | `automaticPolicy.ts` | Remains the policy owner; no bypass or automatic-mode activation |
| Engine tests | `packages/shared/test/location-v2.test.ts`, `test/automatic-policy.test.ts` | Add targeted tests; a new adjacent saved-place test file is acceptable |
| Shared synthetic input | Existing Location fixtures or proposed `packages/shared/src/location/savedPlaceQualityFixture.ts` | Reusable synthetic-coordinate trace, imported by mobile/server tests |
| Retained server replay | `apps/web/src/lib/location/location-replay-service.ts` | Only minimal reconciliation/protection integration proven necessary |
| Semantic emission | `location-ingest-service.ts`, `location-review-semantic-batch.ts` | Shared final known-place dwell guard; preserve batching and terminal rules |
| Local evidence / derived snapshots | `apps/mobile/src/lib/location/store.ts`, `store.sqlite.test.ts` | Existing owner only; test current-snapshot replacement when identities change |
| Real database regression | `scripts/validate-location-v2-db.ts`; proposed `scripts/fixtures/location-saved-place-quality.ts` | Extend the existing validator, not a new database framework |
| Existing reliability / Quick Confirm tests | `scripts/validate-location-reliability.ts`, `scripts/fixtures/location-quick-confirm.ts` | Preserve measurements/invariants; rerun relevant existing gates once near handoff |

Prefer fewer files. Do not create a second semantic emitter, “saved-place sync” service, mutation queue or device/network owner.

## 4. Behaviour contract

### 4.1 Meaningful dwell

The `knownPlace` branch already covers saved and accepted learned matches using the same five-minute setting. Remove its completed-Visit waiver **for both kinds**, rather than accidentally leaving the same bypass under a learned identity. This does not alter learned-place discovery, trust or matching, and the new quiet-gap rule below is saved-place-only.

Rules:

- Apply the floor to the final effective interval **after** departure resolution and compatible continuity, not to the original uncut CLVisit interval.
- Exactly `300_000` ms passes the duration floor; any shorter interval does not. Use milliseconds, not rounded UI minutes.
- A valid long completed Visit may support a long visit. Merely finding one somewhere in a short fragment's evidence does not waive the floor.
- Do not manufacture dwell from `processingAt - firstSignal` for an isolated uncorroborated crossing. An open candidate may stay internally pending; elapsed wall time alone is not proof of meaningful attendance.
- For inferred windows, require continuing inside/interval/departure support, not one passing GPS sample and an arbitrary later distant sample. Keep lower/upper bounds honest; a midpoint must not manufacture enough supported attendance to pass the minimum.
- Do not sum distinct sub-threshold visits separated by a corroborated departure to reach five minutes.
- Retain rejected-as-a-visit signals in the existing raw evidence journal/upload flow. “Not a meaningful visit” is not a reason to discard capture evidence or create another Review task.
- Preserve unknown candidate/review thresholds (ten/twenty minutes) and their sample requirements.

Add a small shared pure duration predicate for the final finite known-place window if useful. Both server emitters must use it as a defensive output guard. It must not suppress explicit user-entered manual time or rewrite previously accepted short entries.

### 4.2 Observation credibility and precedence

Evaluate new decisions over the **existing preprocessed/accepted, deterministic occurrence-time stream**, for one device and owner. Reuse distance/matching helpers. Keep input observations immutable.

- A strong coordinate observation for the saved place, using the existing accuracy threshold, is stronger evidence than a coordinate-free same-place exit callback.
- Geofence enter/state/exit callbacks are contextual signals. Repeated exit callbacks are not two independent accurate outside fixes; registration snapshots cannot begin visits.
- Broad/inaccurate or rejected observations cannot establish a new place, real movement or continuity. An available but imprecise signal is not silently upgraded to “inside”.
- A credible different saved/learned place or corroborated outside movement prevents bridging, even if a long CLVisit spans both.
- A real `A → B → A`, including nearby saved places and a brief meaningful excursion, stays separate. Re-entry within the grace period does not undo a departure already corroborated by accepted evidence.
- Completed Visit support must have a valid finite arrival/departure, a compatible saved match and the same device. Arrival-only/unknown-departure Visits do not provide an unbounded future endpoint.
- `receivedAt` is delivery time, not arrival/departure. Delayed Visit delivery must not change occurrence ordering.
- Preserve the existing exact completed-Visit departure rule when it is non-contradictory. Do not replace it with a midpoint to a later driving observation.

### 4.3 Departure candidate rather than immediate split

Add minimal ephemeral state to `WorkingStay`, such as a pending same-place exit with the original callback time, last genuine inside observation and bounded corroboration. This state is rebuilt from the durable journal during replay; it is **not a new durable queue, native service or scheduled timer**.

Proposed threshold: `savedPlaceExitReentryGraceMs = 300_000` in shared config. It is a maximum short re-entry window, not an automatic five-minute extension of every visit.

| Subsequent evidence | Required outcome |
| --- | --- |
| Same-place enter/exit restoration pair within the existing five-second rule | Preserve its existing no-departure treatment |
| Strong same-saved-place inside evidence within the grace window, no corroborated departure | Cancel the suspect exit; continue the same visit; keep interval support |
| Coordinate-free re-entry plus compatible completed Visit support, no intervening contradiction | May cancel the suspect exit; do not count callback coordinates that do not exist |
| Credible other-place transition | Close using the bounded transition rule; do not merge on return |
| Corroborated movement/outside observations | Confirm departure using their actual temporal bounds; preserve route observations for commute derivation |
| Compatible completed Visit departure | Use its endpoint under the existing non-contradiction rule |
| No follow-up evidence | Do not extend the visit to now or keep claiming continuous attendance indefinitely. Resolve conservatively on the next ordinary processing pass; see below |

For a candidate still unresolved at end of input, do not immediately emit a final split during the short grace window. On a later ordinary processing pass after the grace window, an otherwise unsupported exit may produce a **bounded uncertain end** using the last genuine inside observation and exit time, as the existing fallback does. It is not a confirmed physical departure. Cap this uncorroborated fallback at `medium` confidence so it cannot become an automatically confirmed stay under the unchanged policy; waiting is not stronger evidence. Keep the existing ten-minute finalisation lag; use `processingAt`, not a new timer/poll.

A compatible completed Visit can preserve support past a lone noisy exit, but not past credible contradictory movement. If Visit support conflicts with the inferred end, retain uncertainty and choose the documented conservative fallback. A future Visit `endedAt` must never be treated as a GPS sample occurring before the pending exit.

### 4.4 Saved-place quiet reporting gaps

Keep `maxContinuityGapMs = 720_000` unchanged for ordinary segmentation and commute route policy. Do not increase it globally.

Two permitted saved-place continuation cases:

**A. Compatible interval support.** A completed Visit covering the quiet interval can preserve the same saved-place episode beyond twelve minutes, provided no accepted contradictory place/route evidence breaks it. Retain that support when a suspect geofence exit is cancelled. If a genuinely corroborated departure split the Visit, its interval must not glue the earlier and later episodes back together. Later reuse must be bounded to the later episode and its supporting evidence.

**B. Strong endpoints without a completed Visit.** Add `savedPlaceQuietGapMaxMs = 1_800_000` (thirty minutes). Bridge only when both sides have distinct credible coordinate observations strongly matching the **same saved-place ID**, within the existing high-quality accuracy threshold, and there is no unresolved exit, credible outside movement or accepted different place between them. Inspect the entire accepted interval, not just observations already assigned to the two fragments.

Case B is conservative inferred continuity. Keep `continuityStatus = uncertain_gap` and confidence no higher than `medium` unless stronger compatible interval evidence is present. It must not make automatic confirmation more permissive. The ceiling is per gap; a single old observation cannot refresh itself or extend occupancy indefinitely.

A gap over thirty minutes without compatible Visit support keeps the existing conservative split. In particular, preserve the existing one-hour same-saved-place-gap regression. Unknown-to-unknown sixty-minute/large-site rules remain unchanged. Do not merge by place name, postcode, POI name, category or nearby distance alone.

### 4.5 Boundaries and commutes

- Every end must be after its start; estimates stay within their honest lower/upper bounds.
- No output may extend beyond credible contradictory departure evidence merely to honour an overlong CLVisit.
- Keep valid exact Visit departure as the stay stop and next commute start. If conflicting observations invalidate it, use bounded estimation; do not label an estimate exact.
- Do not manufacture outside movement, route samples, a destination stay, or a missing return journey.
- Filtering the tiny gym fragment must not leave commute foreign keys pointing to an omitted stay. Run existing commute derivation over the corrected meaningful stay list, then persist actual endpoint IDs.
- Preserve legitimate surrounding commutes only when the fixture supplies the existing required route evidence. Do not weaken route qualification to force exactly two commutes from the incident summary alone.
- Local-day and DST behaviour remains based on instants and the existing IANA-zone helpers; never compare display strings or use UTC string slicing for local dates.

## 5. Implementation sequence

### Step A — baseline and failing regressions

Fetch current main and confirm #198 is merged. If main advanced beyond the pinned SHA, inspect the intervening changes before branching. Proceed with harmless documentation-only drift and record the new base; stop for a conflicting Location/Review change rather than silently applying an obsolete design.

Read the relevant sources in Section 13. Reproduce these failures with synthetic evidence before changing behaviour:

1. Sub-five-minute fragment admitted by a longer completed Visit.
2. Early same-place exit losing later Visit continuity.
3. Same saved place split at a 26m38s quiet gap.

Record observed baseline output. Do not copy the entire previous engine into a permanent second implementation for comparison; use pinned expected synthetic rows/fixtures where needed.

### Step B — correct the pure shared engine

Implement the dwell, departure-candidate and saved quiet-gap rules together in the existing state machine, with small named helpers. Keeping interval support attached to the active episode is preferable to bolting a global after-the-fact merge onto all stays.

Conceptual order per accepted observation:

1. Identify meaningful coordinate/Visit/region evidence and its actual occurrence interval.
2. Resolve pending departure against later evidence and compatible interval support.
3. Handle genuine contradictions before considering quiet-gap bridging.
4. Apply the ordinary gap rule or the narrow saved-place exceptions.
5. Update the active episode without losing its earliest supported arrival, latest real inside observation or valid departure constraints.
6. On output, apply meaningful dwell to the resolved episode; derive commutes afterwards.

Keep the existing stable-ID function and ordering. Do not redesign all Location identities or matching. Add explicit tests for out-of-order delivery, duplicate signals, delayed completed Visits and repeated processing without new evidence.

### Step C — final semantic guard

Use the same shared known-place dwell predicate at the user-visible semantic boundary in both:

- `emitReviewSemanticSegments` (`v2_review` batched path);
- the existing `emitSemanticSegment` automatic/compatibility path.

It must be a cheap in-memory filter before creating events/Review/entries for an ineligible fragment, not a new per-row database query. Keep logging-disabled suppression, default category `null`, source types, titles, existing terminal decisions and mode/cutover checks unchanged.

The old completed-Visit branch is the main fix; the emission guard is defence against accidental future bypass. Do not classify the evidence itself as invalid merely because no visit is emitted.

### Step D — integrate new segmentation with existing stored state

This is necessary scope, not a general history repair. A changed episode may have different first/last evidence IDs and hence a different client segment ID.

**Server open suggestions:** exercise `supersedeMissingSegments` / `retireOpenReviewsForMissingSegments` using retained, accepted owner/device-scoped evidence. Obsolete open fragments may be retired atomically by that existing replay owner. New meaningful output must produce exactly one open replacement. Do not delete history or infer disappearance from a partial read/expired evidence.

**Protected decisions:** same-ID upsert protection is not sufficient proof for changed-ID cases. Test an accepted fragment, an ignored fragment, a manual time/place correction and an already confirmed adjacent commute before replaying the corrected input. Their IDs, fields, entries, receipts and protected lineage must remain intact. Do not emit a competing replacement Review or automatic entry for the same already-resolved source evidence.

If the tests expose a gap, a small bounded source-provenance guard inside the existing replay/semantic owner is authorised. Base it on exact owner/device/algorithm-scoped evidence links and relevant interval portions, not timestamp/title similarity. A shared long Visit ID or one shared boundary signal alone must not suppress a genuinely separate later visit or a different journey. Prefer holding an ambiguous replacement for later explicit investigation over overwriting or double-counting a user decision. Do not automatically stretch an accepted forty-second entry into a full visit.

If this cannot be done safely without a new identity system, a migration or broad Review changes, **STOP and report the failing fixture and minimum additional scope**. Do not weaken protected-history tests to finish.

**Local derived snapshots:** `processPendingLocationEvidenceUnsafe` reads the complete current account journal, then upserts snapshots. Ensure obsolete derived snapshots do not remain advertised as current after corrected IDs replace fragments. A minimal account-scoped replacement/pruning of derived snapshot rows in the same state/snapshot SQLite transaction is allowed **only after a successful complete journal replay**. Never prune from a single upload batch, failed/partial processing result, UI cache omission or another account's output. Do not touch raw evidence, pending uploads, Review effects or receipts. Test the empty-output case too.

**Mixed versions:** keep `algorithmVersion = location-v2.0` for this compatible engine correction. Bumping it alone would strand retained evidence and partition replay by version. Do not rewrite durable evidence/envelopes or reset engine/account state. Document this as a code-versioned behaviour correction within the current evidence format; a new signed mobile build is required later because shared engine code changes.

### Step E — docs, final validation and handoff

Use Sections 8–11. Do not switch to hosted work when local code is finished.

## 6. Regression matrix

Use small parameterised unit cases and the existing database/SQLite harnesses. These are automated fixtures, not dozens of separate physical journeys.

| Area | Required assertions |
| --- | --- |
| Duration boundary | 0 ms, 40 seconds, 4m59.999s suppressed; exactly 5m eligible; valid longer stay preserved |
| Completed Visit loophole | Long CLVisit inside a short **contradicted/clipped** fragment cannot waive the final floor |
| False dwell | One passing fix plus elapsed processing time or a distant later observation does not manufacture meaningful attendance |
| Parking chatter | Exit then supported same-place re-entry inside grace, no outside corroboration: one meaningful stay, no micro-visit |
| Real departure inside grace | Two credible outside observations/movement or other-place transition still splits even with rapid re-entry |
| Duplicate callbacks | Duplicate exits and the five-second restoration pair cannot count as independent corroboration |
| Bare exit lifecycle | Pending within grace; later conservative bounded result; no ever-growing stay, no new timer |
| Completed Visit continuity | Quiet 26m38s and a longer gap within compatible finite Visit support remain one episode |
| Point-supported continuity | Same strong saved endpoints at 26m38s bridge with uncertainty; cap boundary tested; over-cap/one-hour unsupported gap stays split |
| Weak endpoints | Broad/rejected fixes, hints only, mismatched saved IDs or unresolved exits cannot invoke the point-supported bridge |
| Contradiction precedence | A → B → A, corroborated excursion, later inside evidence after an earlier Visit departure, and earlier movement before a late Visit departure |
| Unknown/learned separation | Unknown sixty-minute/large-site tests unchanged; learned dwell floor corrected, no accidental learned quiet-gap broadening |
| Processing order | Shuffled/duplicate delivery and delayed completed Visit yield deterministic equivalent current output |
| No-new-evidence pass | Existing ten-minute finalisation works through ordinary processing; no new capture is required and no endpoint drifts with clock time |
| Surrounding commutes | Real route samples produce correct inbound/outbound endpoints; nearby parking manoeuvre does not become a commute; unresolved endpoint omitted |
| Privacy/ownership | Same-name distinct places and two users/devices cannot merge; no raw coordinates in diagnostic output |
| Known place metadata | No default category remains null, saved place label remains separate, logging-disabled place remains suppressed |
| Server replay convergence | Seed old open fragments; corrected replay retires/replaces them atomically; repeat replay leaves no duplicates |
| Protected changed identities | Accepted/ignored/manual fragments and resolved adjacent commutes remain protected despite replacement IDs |
| Local snapshot convergence | Full account replay removes obsolete current snapshots; journal/upload/Review data and other account snapshots unchanged |
| Rollback | Inject failure after changed segment/semantic writes: no partial retirement/replacement/entry/lineage outcome |
| Rollout | Review-only emits no entries; shadow emits none; cutover unchanged; local automatic-policy guards remain valid without activating hosted auto mode |
| Quick Confirm | Capture two hashes; confirm one, unchanged replay, confirm the other; exactly one entry each. Genuine proposal changes still reject safely |

### Incident fixture acceptance

Use two explicitly distinct variants:

- **Chatter-only variant:** supplied timings plus synthetic inside observations and no credible outside departure at the parking exit. Expect one substantial stay and no tiny separate fragment. An earlier radius-based arrival may legitimately be retained; do not claim it is the exact building entrance.
- **Corroborated-parking-departure variant:** add clearly labelled synthetic corroborating outside evidence, then re-entry at 11:58:52Z. The brief earlier episode is filtered; a new substantial episode begins at the supported re-entry and retains compatible later continuity.

For the final boundary, test both a valid Visit departure and a later Visit departure contradicted by earlier credible outside movement. Pin exact endpoints only where each synthetic fixture supplies the necessary evidence. The incident summary by itself cannot prove a precise 13:40 departure.

Keep the existing exact-departure, nearby-place, meaningful round-trip, owner isolation, privacy and terminal-decision tests. Update only the old uncorroborated-exit expectation intentionally superseded by this plan; replace it with before/after-grace and corroboration assertions rather than deleting the protection.

## 7. Persistence and rollout safeguards

- Preserve event-first evidence → segments → source event → Review/entry lineage.
- Keep #197's 250-row batching, existing transaction/statement/lock deadlines and scoped advisory lock. No new N-per-segment SQL pattern.
- Default no migration. If one is necessary, stop for explicit scope approval before writing it.
- No client-side presentation repair of canonical segments, title-based merging or provisional time fabricated from raw location data.
- No automatic deletion/reconfirmation of old Review records or mass replay. Retained open records can converge through the existing authorised replay process after deployment; expired or terminal records need no invented reconstruction.
- The recorded disposal of two stale staging Quick Confirm changes is complete; do not revisit or repeat it.
- Keep staging/production separated. All real-data checks are later explicit actions; do not touch production during this PR's implementation/testing.

## 8. Documentation changes

Read only relevant sections. Preserve existing organisation and terminology.

- `docs/PRD.md`: clarify meaningful known-place dwell, corroborated departure and conservative continuity outcomes; distinguish suggestion quality from automatic-logging activation.
- `.codex/reference/location-learning.md`: record pending-exit precedence, new guard defaults, interval support, unchanged route/unknown limits, and current-snapshot/protected-history invariants.
- `docs/architecture.md`: a short update only where replay/current-snapshot reconciliation or ownership contracts need clarification; do not paste the algorithm or incident log here.
- `docs/dayframe-regression-checklist.md`: add dwell/chatter/quiet-gap/real-departure/protected-replay checks.
- `docs/feature-fix-tracker.md`: mark this focused work implementation pending on its branch; keep #197 merged/Watch and capture/rollout follow-ups separate.
- Proposed `docs/investigations/2026-09-15-saved-place-detection-quality.md`: baseline SHA, owner-supplied trace limitations, synthetic fixture evidence, decisions, tests and NOT RUN items. Do not include private routes or claimed physical results.
- `docs/roadmaps/review-ux-roadmap.md`: change only stale immediate sequencing if necessary; no expansion of future plans.

No general documentation audit. No transient PR/build status in stable product docs. Do not edit status wording repeatedly after final push. Small merge-status reconciliation comes after merge.

## 9. Validation budget and commands

Run commands in the **new worktree's repository root** unless noted. Use existing locked dependencies and existing disposable test setup. Verify all database URLs are loopback disposable `*_test` databases before executing any database validator; never source a hosted production/staging environment to make tests pass.

### During development

Use the narrowest affected shared tests, for example:

```bash
npm run test -w @dayframe/shared -- test/location-v2.test.ts test/automatic-policy.test.ts
```

Include the new test filename once created. Use focused Location service/SQLite tests while touching those owners. Run only the failing/new fixture while iterating, not every specialist validator after each edit.

### One final broad pass, after the diff settles

```bash
npm run lint
npm run typecheck
npm run test
npm run build
git diff --check
```

`npm run lint` already invokes `check:docs`; do not immediately rerun it merely to duplicate that result. Report known baseline problems such as `expo-symbols` TS2307 separately if they still reproduce on this checkout. Do not assume old failures are still present or call a new error pre-existing without checking.

Materially relevant specialist checks, each once near handoff:

```bash
npm run validate:location-v2-db
npm run validate:location-v2-sqlite
npm run validate:location-reliability
```

Use one owned disposable ordered PostgreSQL/PostGIS setup, reusing it safely for the intended fixtures. The existing SQLite script is justified because the shared engine is consumed by the journal and current snapshots may change. Record real database output, not mock-only SQL confidence.

Run `npm run validate:review-mutation-db` once if replay/semantic reconciliation or protection changes affect the Quick Confirm/terminal path; otherwise run its affected fixture through the existing harness and report the broader validator NOT RUN by scope. Do not rerun Health, generic sync, Review SQLite, brand-asset or native validators unless their actual owner/config is materially changed.

The unchanged seven-day reliability fixture should retain its original correctness output where it does not exercise the new saved-place rules. If output legitimately changes, identify the affected inputs and explain the new expectation; never simply refresh a golden hash to make validation green. Preserve bounded query counts and record normal/20/40 ms synthetic results once. A newly failing stage is a report-and-stop condition, not permission to optimise it.

### Anti-loop rules

- Local setup: one normal attempt and at most one targeted recovery attempt. If still blocked, report the concrete blocker and NOT RUN tests; do not switch to cloud databases or rebuild the machine.
- A broad failure gets focused diagnosis and a focused retest. Rerun the failed broad command once after a substantiated repair, not all successful commands. If it still fails, report instead of cycling indefinitely.
- An unrelated flaky/baseline test gets at most one isolated confirmation attempt. Do not repair unrelated features or claim the broad command passed because one test later passed alone.
- Do not change thresholds repeatedly until the real trace “looks right”. Every adjustment must satisfy the named negative fixtures as well as the positive case.
- Do not run a local Simulator build: no native changes are authorised. Hosted Simulator CI may run asynchronously; do not wait.
- If evidence/identity safety or scope is unresolved, stop with the failing case and narrow decision needed. Never turn a blocked test into a bypass.

## 10. Stop / escalation conditions

Stop and report before broadening the implementation if any of these is required:

1. A new engine-version namespace, schema migration, durable queue, native capture change or general Review identity redesign.
2. Overwriting accepted/manual history, deleting receipts/raw data, silently auto-confirming, or resetting rollout/cutover to demonstrate success.
3. An algorithm that needs unavailable raw evidence to choose a precise historical endpoint. Keep the synthetic reproduction; label the real-data gap.
4. A continuity fix that merges real A → B → A or vehicle excursions, or uses unbounded gaps/ever-growing occupancy.
5. An unresolved changed-ID terminal/lineage collision that cannot be handled safely inside existing owners.
6. A newly introduced hosted/synthetic performance stage failure after the scoped correction. Do not restart #197's optimisation programme.
7. A conflicting current-main change, dirty unrelated work or an unavailable protected branch/environment.

A stop is a bounded handoff with evidence, not a reason to change unapproved settings or keep testing for hours.

## 11. Implementation acceptance and handoff

Before draft PR handoff, establish:

- no automated known-place fragment shorter than five minutes reaches Review/entry emission;
- the supplied-timing synthetic gym case no longer fragments solely on chatter/compatible silence;
- genuine departures/returns and unsupported long gaps stay distinct;
- no fabricated exact timestamps, increased radius or weakened commute route guards;
- old open fragments converge while terminal/manual outcomes and Quick Confirm remain safe;
- current local snapshots converge without losing durable evidence or upload/Review work;
- shared mobile/server output agrees for identical input/config/time;
- #197 batching/deadlines/hash protection remain intact;
- focused, real-database, SQLite and final broad results are accurately reported.

Review `git diff`, changed-file inventory and Git status. Place this plan at the repository path in the header on the feature branch, commit, push, open one draft PR into `main`, then STOP.

Handoff must include: base SHA, head SHA, branch/PR, changed files, baseline reproductions, implemented thresholds/precedence, synthetic expected/actual intervals, old-state convergence results, protection/rollback results, performance comparison, documentation impact, and PASS / FAIL / NOT RUN with baseline issues separated. Explicitly state that hosted deployment, real-data replay, iPhone build/physical acceptance, automatic-mode activation and merge were NOT RUN.

## 12. Later jobs — NOT instructions for the implementation session

### Independent review

OpenClaw/Claude reviews the **complete PR at exact base/head SHAs**, this same plan and relevant current docs, read-only. Focus on ambiguity, late Visit ordering, terminal-history protection, unchanged route/unknown rules and truthful test evidence. Each finding needs file/line, consequence, evidence and correction; classify Blocker / Important / Nice-to-have. No invented findings; explicitly APPROVE when appropriate.

Targeted fixes are a separate Codex job: only substantiated findings, focused tests plus one appropriate final pass, push and STOP. Material code changes require exact-head re-review.

### Staging preparation and device build

After approval/checks settle, OpenClaw confirms the exact final Preview is Ready and uses staging Supabase with the existing required schema. Promote **that exact Preview** to `https://dayframe-staging.vercel.app`, verify source/deployment/backend and `v2_review`, then build/install the **ordinary signed staging app locally with Xcode** from the same head.

A new mobile build is required here because the shared engine changes. Bundle `com.layereight.dayframe.staging`, isolated staging App Group/Keychain; production identity is `com.layereight.dayframe` and must remain untouched. Preserve existing data; do not uninstall, sign out, clear queues or reset the acknowledgement to simplify testing. A build/provenance verification is not physical acceptance.

Synthetic staging fixtures or replay that changes real Review state require a separate explicit authorisation. Do not backfill/replay the old gym records silently. Normal foreground processing can legitimately update retained open suggestions; report it honestly.

### KB's physical checklist

Record each result as PASS / FAIL / NOT RUN against exact server/app provenance. OpenClaw must distinguish observed state from physical taps it cannot perform.

| Test | Success looks like |
| --- | --- |
| Pass briefly through a saved radius without staying | No standalone tiny visit appears after normal finalisation/sync |
| Park near the boundary, enter, remain at least 30 minutes, then leave | One substantial saved-place suggestion; no split solely from a quiet reporting gap |
| A genuine departure and later return | Separate meaningful visits, not one enlarged interval |
| Leave for another saved place with credible route evidence | Correct distinct destination and qualifying commute; no invented route |
| Refresh/reopen after ordinary sync | No duplicate current fragments, Review rows or canonical entries |
| Confirm a known-good suggestion, then refresh/replay normally | The accepted result stays once; it is not replaced or reopened |
| Two consecutive fresh Quick Confirms | Both canonicalise; no timestamp-only `proposal_changed`; normal transient lock retry can recover |
| Short timer regression smoke on staging | Start/Stop still works; stopped entry remains after refresh |
| Sync & diagnostics | Evidence upload and replay settle through existing owners; no fresh 503 regression; record latency without repeated load-testing |

Do not promise a device will become completely silent on demand. A naturally quiet interval is physical evidence; synthetic gap fixtures cover the deterministic rule. Do not deliberately drive while using the phone or force-quit the app during the capture portion to manufacture a different lifecycle problem.

### Completion

Merge only with KB's approval after relevant checks/review/acceptance. Record actual merge SHA and a small tracker/roadmap reconciliation afterwards. Keep missing-return capture separate. A `v2_enabled` staging trial is a later explicit gate, and its automatic-mode server performance must be validated separately. No production activation is part of this PR.

## 13. Sources and provenance

Repository sources below were inspected at the planning baseline unless noted. Their current behaviour is evidence; the proposed rules in Section 4 deliberately supersede the identified duration/exit/gap behaviour only.

- [R1 — current tracker](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/docs/feature-fix-tracker.md): #197 merged/Watch; saved-place quality next; capture and rollout separate.
- [R2 — shared segmenter](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/packages/shared/src/location/segmenter.ts): `stayFromWorking`, `runLocationEngine`, transition boundaries and unknown coalescence.
- [R3 — shared configuration](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/packages/shared/src/location/config.ts).
- [R4 — server replay](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/apps/web/src/lib/location/location-replay-service.ts): scoped retained-evidence reads, retirement, protected upserts and lineage.
- [R5 — batched Review emission](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/apps/web/src/lib/location/location-review-semantic-batch.ts) and [existing ingest/automatic emitter](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/apps/web/src/lib/location/location-ingest-service.ts).
- [R6 — proposal hash](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/apps/web/src/lib/review-proposal-hash.ts).
- [R7 — Location guardrails](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/.codex/reference/location-learning.md).
- [R8 — geofence capture](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/apps/mobile/src/lib/geofence.ts): coordinate-free V2 region callbacks.
- [R9 — mobile journal/snapshots](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/apps/mobile/src/lib/location/store.ts) and [runtime](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/apps/mobile/src/lib/location/runtime.ts).
- [R10 — shared Location tests](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/packages/shared/test/location-v2.test.ts): one-hour gap, completed Visit, exact departure, unknown gym, nearby places and routes.
- [R11 — PRD](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/docs/PRD.md), [architecture](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/docs/architecture.md), [documentation governance](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/docs/documentation-governance.md), [agent rules](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/AGENTS.md).
- [R12 — registered validation scripts](https://github.com/kwabiwe/dayframe/blob/5c5df4b5b3a2c7b6c4e2fe21df7579bc8909511a/package.json).
- [A1 — Apple CLVisit documentation](https://developer.apple.com/documentation/corelocation/clvisit): interval evidence and approximate/incomplete arrival/departure fields. External platform reference, not the source of Dayframe's proposed thresholds.
- Owner-supplied OpenClaw trace and `dayframe-upcoming-work-sequence.md` in this conversation: requested incident and scope/order. The source trace is summarised in Section 2; a complete raw export was not supplied.

**Planning evidence only:** no implementation, test suite, database replay, build, deployment or real-data mutation was performed to prepare this document.
