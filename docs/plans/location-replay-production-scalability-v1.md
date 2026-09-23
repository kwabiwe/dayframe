# Dayframe — Production retained-replay scalability V1

**Plan ID:** `DF-PROD-REPLAY-SCALABILITY-V1`  
**Prepared:** 20 September 2026  
**Implementation model:** Codex GPT-5.6 Luna, Max reasoning  
**Repository:** `kwabiwe/dayframe`  
**Verified planning main:** `791e57ea3d806c1474407b7b3546d05a42bd0153`  
**Latest merged documentation:** PR #205, merged at that SHA  
**Suggested feature branch:** `fix/location-replay-production-scale`  
**Repository plan path:** `docs/plans/location-replay-production-scalability-v1.md`  
**Likely PR number:** #206; use the number GitHub actually assigns, not an assumed number.

## 0. Mission, authority and job boundaries

Make the existing server-side retained-evidence replay complete reliably at the production workload that is currently failing. Preserve what the replay means and what it saves. This is a performance/correctness-preservation task, not a new Location detection feature.

The proposed first implementation removes excessive client/database round trips in two measured parts of replay: protected-history provenance checks and lineage insertion. Both already use set-based SQL; the problem is not a remaining per-evidence insert loop. The change must remain bounded in rows, payload size and transaction duration.

**Implement Sections 1–16 in the Codex job. Sections 17–20 describe separate, later jobs and are not authorisation to execute them.** The optional metadata preflight in Section 3 is an OpenClaw job, not permission for Codex to access production.

| Job | Owner | Permitted work | Stop point |
| --- | --- | --- | --- |
| Topology/access preflight | OpenClaw | Existing authorised read-only deployment/database metadata; local environment readiness | Report metadata or one access blocker; no replay or configuration change |
| Implementation | Codex Luna Max | Isolated branch, local synthetic fixtures, focused correction, local tests, one broad validation pass, draft PR | Push draft PR, report exact SHAs and results, STOP |
| Independent review | OpenClaw coordinating Claude | Complete exact-base/head diff; read-only evidence and relevant docs | Verdict and substantiated findings, STOP |
| Review fixes | Codex, separately requested | Only substantiated corrections, affected tests and one suitable final pass | Push new head, STOP |
| Staging validation | OpenClaw + KB, separately requested | Exact Preview verification/alias assignment, explicitly authorised staging tests | PASS / FAIL / INCONCLUSIVE, STOP |
| Merge | KB | Manual merge after gates | No implicit production-release authority |
| Production deployment/acceptance | OpenClaw + KB, separately authorised | Verify/deploy the approved merged source, observe ordinary production processing | Evidence-based outcome, STOP; no automatic repair campaign |

No job owns the entire lifecycle. Do not poll GitHub or Vercel from the implementation job. Do not automatically invoke another model, start EAS/Xcode/TestFlight, assign a staging alias, merge or deploy production.

## 1. Evidence baseline: facts, limits and corrected assumptions

### 1.1 Repository state

Fresh GitHub inspection found main at `791e57ea3d806c1474407b7b3546d05a42bd0153`, the PR #205 documentation reconciliation. Its parent is PR #204 merge `9ceb944dddf156d7dd87afe5aef4066b877a7ce2`. The tracker now records #204 as merged with scoped saved-place physical acceptance and the production replay failure as still unresolved. [R1–R3]

Fetch main again at implementation start. If it advanced, inspect the actual intervening diff. Documentation-only advancement can be incorporated and recorded. Changes to replay, Review protection, transaction ownership, schema, runtime or this plan require a scope check before applying a stale design. Never reset main or another worktree.

### 1.2 Operational evidence supplied by KB/OpenClaw

The following is supplied operational evidence, reconciled into the repository by #205. It is not a new production measurement performed while writing this plan.

- Production has accepted the phone's Location evidence, but corresponding journeys have not become persisted Location/Review output.
- The identified failed replay had Dayframe correlation ID `cf4735a3-f6a5-436d-a98a-5c46e154c336` and ran on 19 September 2026 at approximately 15:27:25 UTC / 16:27:25 BST.
- Deployment: `dpl_4j81qGz4AFXcDhFcWFKz6RD4zaC1`. The export associated it with source `9ceb944...`; the recovered runtime record did not itself contain a source SHA.
- Function execution was reported in `iad1` (Washington, D.C.). `cle1` was ingress, not proof of the database/function execution location.
- HTTP 503, `location_processing_busy`, `operation_timeout`, phase `effect`, last service stage `lineage`, server duration 7,003 ms.
- The retained production-project query returned 29 replay attempts, zero successes and 29 timeout responses at 7,000–7,004 ms. Twelve stopped in lineage insertion and seventeen in semantic persistence. Logs lack owner/device identifiers; do not relabel this project-wide aggregate as 29 independently owner-filtered attempts.
- Evidence rows across that sample: 4,018–4,193. Production contains substantially more eligible evidence than the approximately 860–1,046-row fixtures/observations used earlier.
- The evening screenshot that appeared successful belonged to staging, not production. There is no demonstrated successful production replay in that evidence.
- There is no demonstrated causal Health lock conflict for the identified request.

Representative application-stage timings:

| Stage | Elapsed ms | Completed? | Remaining budget start → end, ms |
| --- | ---: | --- | --- |
| Request setup | 0 | Yes | Not recorded |
| Authentication | 481 | Yes | Not recorded |
| Request body | 3 | Yes | Not recorded |
| Connection acquisition | 0 | Yes | 6,515 → 6,515 |
| Transaction configuration | 376 | Yes | 6,515 → 6,139 |
| Owner lock | 104 | Yes | 6,139 → 6,035 |
| Evidence read | 900 | Yes | 6,034 → 5,134 |
| Catalogue read | 190 | Yes | 5,134 → 4,944 |
| Engine computation / evidence mapping | 560 | Yes | 4,944 → 4,384 |
| Protected-replacement checks | 1,808 | Yes | 4,384 → 2,576 |
| Obsolete handling | 643 | Yes | 2,576 → 1,933 |
| Stay persistence | 606 | Yes | 1,932 → 1,326 |
| Commute persistence | 406 | Yes | 1,326 → 920 |
| Lineage deletion | 188 | Yes | 920 → 732 |
| Lineage insertion | 735 | No | 732 → not recorded |
| Semantic/Review persistence | Not reached | — | — |
| Commit | Not reached | — | — |

Workload counters were 4,029 evidence rows, 109 engine stays, 58 engine commutes, 14 reported protected segments, and 1,000 prepared lineage links with four insertion chunks started and three completed. **The lineage counter accumulates as chunks are prepared; 1,000 is not a complete intended-link total for this failed request.** Engine counters are not proof of numbers persisted or committed. The existing protected counter also is not a standalone count of distinct pre-existing protected database rows.

About 6.08 seconds elapsed before lineage deletion and about 6.27 seconds before insertion. The last-stage marker does not mean lineage consumed seven seconds. These timings include application work, query setup and network time; they are not isolated SQL execution times. [R3–R6]

### 1.3 What #202 actually does

At this baseline, server-effective `v2_review` selects `reuseFullCapTimeoutPair` automatically. There is no extra environment switch that must be enabled. The existing transaction owner skips redundant timeout configuration only while the installed statement/lock pair is known and both remain at their full caps. Below the applicable remaining-budget boundary, or after state becomes uncertain, normal configuration resumes. This guard must remain untouched. [R5, R7]

An earlier, short-lived description called the existing 85 ms fixture a latency profile. **The checked-in `replay-860-finite-85ms` case is an 85 ms total deadline with zero artificial per-call delay.** It is a cancellation/rollback test, not an 85 ms network-latency benchmark. Keep it distinct from any newly added 85/100 ms per-call simulation. [R8]

### 1.4 Correct query-cost model

`excludeProtectedReplacements` currently builds `byEvidence` from the evidence IDs attached to newly derived segments. Let **U** be the number of distinct IDs in that map. Its business-query count is currently approximately:

`2 × ceil(U / 250)`

The factor two comes from querying stays and commutes for each ID batch. **U is not the total uploaded evidence-row count.** Do not claim 30+ queries solely because the engine read 4,029 observations; measure U and actual raw driver calls. [R4]

`replaceEvidenceLinks` already inserts up to 250 lineage rows per SQL statement. Its insertion count is approximately `ceil(L / 250)`, where **L** is the complete intended set of mutable, resolvable links. It also performs a separate scoped deletion. A larger parameterised batch reduces round trips but does not remove per-row ownership triggers. [R4, R9]

The earlier suggestion to “start with protected rows” was a hypothesis, not an approved unbounded-history scan. This plan refines it: first retain the exact protected-source predicates and candidate-evidence intersection while greatly reducing repeated bounded probes. Do not fetch every protected row in the user's lifetime or assume SQL `FROM` order determines the physical query plan.

### 1.5 What remains unknown

Current production database region, actual connection/pooler route, relevant live index/trigger parity, per-query execution/wait times, and the count of reused/fallback timeout settings for the failed invocation are not established by the supplied log. Do not fill those gaps from masked credentials, old screenshots, old chat settings, mobile counts or staging metadata.

## 2. Scope, non-goals and invariants

### 2.1 Authorised default implementation

1. Add reproducible production-shaped synthetic measurement/correctness coverage.
2. Reduce redundant protected-provenance probes using a **dedicated bounded evidence-ID batch policy**, retaining the exact current protected-row query semantics and locks.
3. Replace repeated small lineage `VALUES` inserts on the selected path with **bounded, typed JSONB recordset insertion**, preserving the deletion boundary, order, constraints and triggers.
4. Keep the existing semantic emitter; measure the entire replay through its completion and commit.
5. Add only the small server-only aggregate counters specified in Section 10 when necessary to make the changed batch behaviour observable.
6. Update affected durable architecture/validation guidance, the tracker and a concise evidence ledger.

This authorises the dedicated batch bounds below. It does **not** authorise increasing global/shared batch constants or gradually raising arbitrary limits until a benchmark passes.

### 2.2 Explicit non-goals

No changes to the shared Location engine, saved/unknown-place thresholds, arrival inference, cluster radius, traffic policy, passive walk/motion capture, POI ranking, map provider, Health import, Today UI, categories/tags, Review decision policy or mobile scheduling. Do not resume the Chelmer feature work in this branch.

No extra replay queue, background worker, incremental checkpoint, cross-request cache, detached transaction, parallel queries on the checked-out client, persisted partial-progress state, reduced evidence retention, input truncation, newer-only replay window, raw-evidence deduplication policy change or automatic queue clearing.

No migrations, indexes, stored functions, trigger changes, RLS changes, library upgrades, connection-pool tuning, connection-string changes, regional deployment changes or increased timeouts in the default implementation. Evidence that one is necessary triggers the escalation rule, not an automatic expansion.

Do not replace the Review emitter with a giant multi-write CTE, add `SKIP LOCKED`, or drop required work to make timings look good.

### 2.3 Invariants that are acceptance criteria

- The existing Location owner and checked-out transaction retain capture/upload/replay sequencing. All changed database work stays on that client.
- The operation remains atomic: segments, lineage and semantic/Review writes either commit together or roll back together.
- Preserve the 8,000 ms overall deadline, 1,000 ms cleanup reserve, 3,000 ms statement cap and 1,500 ms lock cap, and the actual destruction/release behaviour. No test-only setting leaks into production. [R7]
- Preserve authentication, effective rollout calculation, acknowledgement, durable semantic cutover, finalisation and retention filters.
- Preserve workspace/user/device/algorithm scope wherever the existing query requires each dimension. “Owner lock acquired” is not permission to remove SQL predicates.
- Preserve the two different protection mechanisms: changed-ID replacements sharing protected provenance, and same-ID rows with existing manual/terminal protection.
- Do not infer identity from description, place name, time overlap or timestamps alone.
- Preserve accepted/ignored/manual decisions, recorded entries, explicit edits, receipt idempotency and protected lineage, including the historically confirmed gym entry.
- In `v2_review`, valid eligible output becomes Review suggestions, not automatically confirmed Location entries. Existing explicit Quick Confirm receipts remain legitimate explanations for entries.
- Mutable lineage maintains the same evidence identity, segment identity, sequence index and role. Protected link IDs and contents do not change. Mutable physical link UUIDs/creation timestamps may already change under the baseline delete/reinsert path; distinguish them from logical equivalence.
- The input can contain delayed Visits, expiry, repeated replay or empty output. Do not create a “fast path” that skips time-based finalisation or obsolete-proposal retirement.
- Privacy-safe logging only: no raw SQL/parameters, coordinates, descriptions, credentials, owner/device IDs or entire evidence objects in hosted logs.

## 3. Preflight without another setup/release loop

### 3.1 OpenClaw topology check — separate, read-only

Ask OpenClaw to supply, through existing authorised access:

- production and staging project/backend identity;
- active production deployment/source and configured/observed execution region;
- actual database region from trusted project metadata;
- pooler mode/region/port from authorised connection metadata, without exposing the connection string;
- relevant PostgreSQL/PostGIS version and whether the current schema contains the ownership triggers and indexes used by replay;
- whether actual invocation-region evidence agrees with configured metadata.

Record facts and unknowns separately. Do not log in through new credentials from chat, provision access, migrate a database, run replay, execute write-capable profiling or change regions.

Co-locating functions and their database is a valid candidate if a cross-region route is established. Vercel recommends placing functions near the data source. But do not choose a region from KB's location, infer production from the staging pooler, or combine a region change with this SQL experiment. [W4–W5]

**Missing topology metadata does not block local implementation.** Use the conservative simulated-latency coverage below and mark topology unknown. Before a hosted claim, record the actual tested topology. If the metadata proves a simple placement correction is likely preferable, report it for a separate operational decision; Codex does not deploy it.

### 3.2 Codex source/worktree preflight

Read `AGENTS.md`, the tracker, this plan, documentation governance, and the relevant architecture/Location/database/validation sections. Then:

- Fetch current main and record the base SHA.
- Verify this is `DF-PROD-REPLAY-SCALABILITY-V1`, not the saved-place-quality, arrival-boundary or #202 plan.
- Use one isolated feature worktree/branch. Do not stack on #204/#205 or use the TestFlight worktree.
- Inspect uncommitted files before any checkout/install. Stop rather than overwrite someone else's work.
- Record Node/npm/PostgreSQL/PostGIS versions, test target and free space without printing secrets.

### 3.3 Local database safety

The last verified healthy environment was task-owned local PostgreSQL 17/PostGIS 3.6 at `127.0.0.1:54323`. The earlier Docker/default `localhost:54322` store had I/O corruption. Treat 54323 as a lead to verify, not a reason to reset it.

Require an explicit task-owned database with a `_test` suffix on `127.0.0.1:54323`, using the known authorised local credential handoff. Validate host, port and database before importing anything that could construct a pool or read `.env.local`. Every child process and baseline harness must inherit the same validated local-only target.

Use a new task-owned database or the existing approved disposable harness. Never run `db:down`, prune Docker, remove shared clusters, guess passwords or repair global infrastructure. Do not use hosted data or credentials to make the local validator pass.

Setup allowance: one readiness check and at most one narrowly targeted, non-destructive recovery for this job. If Git/Xcode licence, disk space, dependencies or PostgreSQL still block readiness, preserve the work and report a concrete blocker. Do not turn this performance PR into an environment-repair campaign.

## 4. Owners and likely files

| Responsibility | Existing owner / likely file | Permitted change |
| --- | --- | --- |
| Server-effective profile selection | `apps/web/src/lib/location/location-ingest-service.ts` | Internal replay option derived from server-effective mode; no new request field or env toggle |
| Protected replacement, persistence, lineage | `apps/web/src/lib/location/location-replay-service.ts` | Primary correction, keeping the current owner and logical predicates |
| Small batching helper, if needed | Proposed `apps/web/src/lib/location/location-replay-batching.ts` | Pure bounded packing only; not a store, scheduler or DB owner |
| Transaction lifecycle | `apps/web/src/lib/sync-transaction.ts` | Read/test; no implementation changes by default |
| Review semantics | `apps/web/src/lib/location/location-review-semantic-batch.ts` | Measure/test; leave implementation unchanged in the default pass |
| Server stage counters | `apps/web/src/lib/location/location-sync-diagnostics.ts` and test | Three aggregate fields at most, plus safe validation; no public-wire expansion |
| Replay unit/contract tests | Existing replay/ingest/route tests in `apps/web/src/lib/location` and `apps/web/src/app/api/location` | Add focused selection/batching/failure coverage |
| Existing reliability harness | `scripts/validate-location-reliability.ts`, existing fixtures | Preserve 860-row and timeout checks; repair fault-injection reachability if batch shape changes |
| Production-shape fixture | Proposed `scripts/fixtures/location-replay-scalability.ts` | Deterministic, synthetic data only |
| Dedicated opt-in runner | Proposed `scripts/validate-location-replay-scalability.ts` | Local-only before/after measurements and assertions |
| Root script | `package.json` | At most one new validation script; no dependency change |
| Documentation | `docs/architecture.md`, relevant `.codex/reference/location-learning.md` / validation guidance, tracker, regression checklist, plan and investigation | Focused changes only; no duplicate policy/status owners |

Prefer one small batching helper rather than spreading profile constants across files. Do not create a second replay implementation to keep indefinitely. A test-only baseline adapter may live in temporary QA storage, not production code.

## 5. Establish the baseline before changing application behaviour

### 5.1 Freeze the same synthetic workload for both versions

Build the production-shaped fixture first. Keep one captured processing clock, catalogue, acknowledgement and seed state for each comparison. Seed equivalent separate disposable databases or reset only the task-owned synthetic scope from a preserved fixture between runs.

Compare the exact base application source against the candidate source using the same harness and fixture. A detached temporary baseline worktree/archive is allowed for measurement; it must not become another feature branch or PR. Verify imports/compiled shared packages resolve to the intended source, not accidentally to the candidate worktree's build. Record base/head commit and schema fingerprint in every result.

Do not change the base implementation to make it fail. Local measurements may expose overhead without reproducing the hosted timeout exactly. Label that honestly; synthetic delay is not a production measurement.

### 5.2 Measure the complete transaction, not isolated inserts

At the raw driver boundary capture, without payload values:

- all calls, including transaction scaffolding, timeout configuration and cleanup;
- calls by stage and operation family;
- distinct input evidence IDs used by output segments (U);
- expected and completed protected probes;
- returned protected provenance rows and distinct protected sources, separately from held candidate count;
- complete intended mutable links (L), insertion chunks/rows and maximum parameter/payload bytes;
- total request-model duration, transaction duration, stage durations, remaining work budget at commit;
- success/failure classification, whether the intended failure injection actually ran, and whether commit was reached.

An `INSERT` becoming `INSERT ... SELECT` must still be counted. Do not let a regex stop recognising the changed query and report an artificial zero-call improvement. Classify explicit stage/family labels in the test wrapper, inspect actual SQL shape and assert family counters are non-zero when expected.

Server-internal trigger queries are not raw-driver calls. Record trigger presence and, in local database profiling, their time/work separately. A lower driver count is not proof of lower total database work.

### 5.3 Baseline query-plan evidence

Use disposable PostgreSQL with the relevant hosted ownership triggers/constraints enabled as well as the complete local schema. Reuse the repository's validated hosted-parity harness rather than inventing permissive substitutes. Verify the named triggers really exist and run. Record exact definitions/index fingerprints and whether a representative deployed schema was independently checked.

On that disposable target only, inspect representative `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` results for protected-provenance queries and the new lineage insertion inside a rollback-contained test. This command executes the statement; never call it against production writes under a “read-only investigation”. Preserve safe local plans without source coordinates/credentials.

Evidence-read, engine and semantic stages remain in the benchmark. Do not precompute the engine output or pre-seed semantic output inside a test presented as first-success replay performance.

## 6. Internal selection and bounded policies

Introduce one internal persistence profile, conceptually `review_scalability_v1`. Select it only from the **server-effective** `v2_review` path in `replayAndEmitLocationSemantics` / its call to `replayLocationEvidence`.

The default/unspecified profile uses existing behaviour. Calls from `v2_shadow`, `v2_enabled` and existing generic fixtures retain their original path unless explicitly testing the new internal profile. Do not trust the request's desired rollout mode independently of the server decision. The API body/schema is unchanged; no mobile build is required for this scope.

Do not change #202's `reuseFullCapTimeoutPair` calculation or pass state between requests. The persistence profile selects batching representation only; it is not a new rollout mode or customer setting.

Proposed dedicated bounds for the new profile:

| Operation | Maximum rows/IDs per request | Additional payload bound | Notes |
| --- | ---: | ---: | --- |
| Protected provenance candidate-ID probe | 2,048 distinct evidence IDs | 512 KiB of encoded candidate-ID payload | Flush earlier at either boundary; keep exact original query/owner predicates |
| Lineage insertion | 2,048 intended links | 1 MiB UTF-8 JSON parameter | Typed recordset; owners bound separately |
| Segment lock/upsert batches | Existing 250 | Existing bound | Do not enlarge the shared segment constant |
| Semantic/Review batches | Existing 250 | Existing bound | Unchanged emitter |
| Evidence upload | Existing 100 per batch | Existing HTTP limit | Unchanged |

These are initial, explicitly authorised caps, not claims that PostgreSQL intrinsically needs these values. Measure them. A row that cannot fit a batch must fail visibly before committing, never disappear or be silently truncated. Test multibyte/maximum-length identifiers for the ID-byte bound. For lineage, use already bounded UUID/role fields and integer indexes; do not serialize evidence payloads.

A fixed smaller cap is acceptable only when measurement proves the proposed cap breaches query/lock budgets and the chosen bound still meets the end-to-end gate. Permit at most one such bounded adjustment, documented with the before/after result. Further cap hunting requires a scope decision. Never increase above these caps in this run.

## 7. Correction A — protected provenance checks

### 7.1 Lowest-risk default

Retain `sharesProtectedPortion` and the filtering of dependent commutes unchanged. Retain the current SQL joins and all its protection/ownership predicates. Replace use of the generic 250-ID segment chunker at this call site with the new dedicated row-and-byte-bounded evidence-ID packer.

The intended primary improvement is approximately:

`2 × ceil(U / 250)` probes → `2 × number_of_bounded_ID_batches`

For U <= 2,048 and a payload under 512 KiB, that is at most two protected-provenance queries, including a legitimately empty-result query for each table. For larger U, process every batch. Never silently cap U or scan only the most recent evidence.

This is a deliberate refinement of the earlier “invert the query” suggestion. It removes repeated evidence-slice probes without adding a new scan of all historical protected segments or rewriting a delicate protection rule. A different protected-first SQL plan is **not** automatically authorised if this simple correction does not meet the gate; provide the measured plan and request the scoped alternative.

### 7.2 Preserve the exact protected-source definition

Keep the current logical predicate:

`manual continuity OR (not superseded AND has source event AND no open Review for that segment)`

Do not “simplify” it to accepted/confirmed event status alone. In particular:

- a manual segment remains protected even if a status combination looks unusual;
- an event-linked, non-superseded segment with no open Review is protected according to the existing predicate;
- a superseded non-manual segment must not be resurrected as protected;
- an open Review permits ordinary replay replacement under the current rules;
- missing/superseded/open/terminal combinations must be tested from real fixtures, not guessed.

Use actual shared evidence IDs plus the occupied portion, exactly as `sharesProtectedPortion` currently requires:

- same client segment ID is not a changed-ID replacement;
- positive temporal intersection is required;
- Visit evidence uses the current same-start rule;
- standard/significant points must be strictly inside both intervals;
- touching an endpoint is not shared interior attendance;
- geofence/provider-only evidence does not gain a new replacement-protection role;
- null/open bounds behave exactly as before.

Do not add an unreviewed date/range shortcut that misses old confirmed history whose provenance still overlaps retained evidence.

### 7.3 Locking and concurrency

Maintain parameterisation, closed table/column selection, `FOR UPDATE OF s` and deterministic source-ID/evidence-ID ordering. Do not replace row locks with an unlocked pre-read or `SKIP LOCKED`.

Larger input batches can alter lock acquisition timing/order. The Location advisory lock serialises the same replay owner, but not every Review action uses that same lock. Audit the current Review mutation/Location correction lock path and run the two-connection tests in Section 11. Do not assert the coarse lock solves all races.

Keep the two table queries sequential on the checked-out client. No `Promise.all` on the client, and no extra connection to parallelise them. If a concrete new deadlock, stale protected-read race or lock-set expansion is demonstrated, stop and report it rather than weakening the lock predicate.

The resulting protected source set and held candidate set must match the base across boundary/chunk sizes. Many unrelated historical sources should not cause a full-history read; the candidate evidence intersection remains mandatory. Do not add a result `LIMIT` that drops legitimate protected links. Record fan-out and memory in a stress fixture; escalate if safe bounded input still produces unmanageable output.

## 8. Correction B — lineage insertion

### 8.1 Retain the transaction sequence

Preserve the existing scoped deletion of mutable lineage before insertion. Keep deletion as a separate awaited statement. Retain protection exclusions and the actual stay/commute ID maps returned by persistence.

Do not combine deletion and reinsertion of the same lineage rows into a single data-modifying CTE. Do not assume one CTE sees sibling writes or executes in textual order. PostgreSQL documents snapshot and same-row modification constraints for these constructs. [W1]

Segment persistence still precedes lineage, and lineage still precedes event/Review emission. The ownership triggers can therefore look up rows already inserted in earlier statements.

### 8.2 Build typed, bounded rows

For each mutable resolvable segment, enumerate its original `evidenceIds` in order. Resolve actual database evidence/segment IDs through the existing maps.

Each prepared row contains only:

- evidence UUID;
- stay UUID or commute UUID, with exactly one non-null;
- original `sequence_index`;
- existing role (`inside` for the recomputed stay path, `route` for the recomputed commute path);
- a temporary batch ordinal used only to enforce insertion order, never stored as identity.

Bind workspace/user UUIDs from the authenticated session as separate parameters. Do not duplicate trusted ownership from arbitrary input row JSON.

A conceptual statement shape is:

```sql
insert into location_segment_evidence
  (workspace_id, user_id, evidence_id, stay_segment_id, commute_segment_id, sequence_index, role)
select $1::uuid, $2::uuid, r.evidence_id, r.stay_segment_id, r.commute_segment_id, r.sequence_index, r.role
from jsonb_to_recordset($3::jsonb) as r(
  evidence_id uuid,
  stay_segment_id uuid,
  commute_segment_id uuid,
  sequence_index integer,
  role text,
  ordinal integer
)
order by r.ordinal
on conflict do nothing;
```

This is a design sketch. Use the repository's actual types/error conventions and prove behaviour on real PostgreSQL. Do not concatenate values into SQL.

Preserve the original conflict semantics: the same evidence/segment/role is not inserted twice, and the first equivalent input occurrence retains its original sequence index. Ensure that SQL input ordering—not an assumption about object/aggregate iteration—preserves that behaviour. Repeated evidence in different segments or roles is not a global duplicate.

If an evidence ID has no map entry, retain the baseline skip behaviour and original sequence numbering; do not renumber following evidence to hide gaps. If a commute endpoint cannot resolve, retain its omission and do not create orphan lineage. Do not skip a protected row and then delete its links through another list.

### 8.3 Bounds and memory

Stream batch construction over the existing engine output; do not make an additional unbounded whole-history JSON copy. Flush before the row cap or byte cap is exceeded. Compute UTF-8 bytes, not JavaScript character count. Send each chunk sequentially and await completion.

Keep `ON CONFLICT DO NOTHING`, foreign keys, check constraints, owner triggers and current role vocabulary. Row-level triggers still execute for each inserted row; a single SQL request is not permission to bypass them.

Expected target at approximately 2,000 mutable links: one insertion request rather than eight, plus the unchanged delete. At 2,049 links: two requests. More links must continue through additional bounded batches; no artificial global lineage maximum.

Keep legacy profile behaviour where the new server profile is not selected. Do not change evidence upload batching or the segment upsert batch size just because a nearby constant has the same value.

### 8.4 Fault injection must still fire

Existing tests inject failure on the second lineage insert. With a larger batch, the old 840-link fixture may make only one insert. A test that never reaches its fault is not a rollback test.

Update test fixtures/injection seams narrowly so they use more than one new-profile batch or fail after a demonstrated executed write. Assert the injected fault fired exactly once and the earlier write/delete actually ran. Do not call an expected-failure scenario PASS solely because the final snapshot happened to be unchanged.

## 9. End-to-end decision after A and B

Measure cold first-success, steady replay and changed-input replay through **semantic persistence and commit**. Faster protection/lineage alone is insufficient.

If all required correctness/performance gates pass, stop optimising. Do not spend the remaining run cleaning up semantic SQL or adjacent engine code.

If they fail:

1. Preserve the baseline/candidate driver counts, complete stage timings and actual remaining budget when semantics begins.
2. Identify the next measured cost: query count, statement execution/trigger work, excessive result volume, evidence mapping/engine, network placement or another proved factor.
3. Return a scope-decision report. Do not raise timeouts, silently change the primary target, or automatically rewrite the semantic emitter.

A future approved correction may consolidate semantic work, improve a specific query/index, or change function placement, but this plan does not pre-authorise a chain of such jobs. In particular, the baseline emitter can insert and then update the same Review row across **separate** statements. Naively merging these into sibling write CTEs is not equivalent. [R6, W1]

Do not bypass required whole-journal correctness because data is unchanged: clock-only finalisation, expiry, catalogue changes, Review decisions and terminal-history protection still matter.

## 10. Diagnostics: minimal and accurate

Reuse #201's existing server-only `location_sync` payload. Keep its current timings, nonthrowing observers, JSON serialisation, completed/incomplete markers, correlation headers and privacy allowlist.

Permit at most three additional aggregate counters in its existing whitelist:

- `protectionEvidenceIds`: complete distinct U used for this replay's protection check;
- `protectionQueryBatches`: actual protected-provenance SQL calls started, not predicted calls;
- `lineageLinksIntended`: complete intended mutable/resolvable L, computed before insertion, excluding protected/unresolvable links under the same rules as the writer.

Use existing link chunk started/completed counters for progress. Preserve the legacy cumulative meaning of `lineageLinksPrepared`; do not silently redefine it as an intended total. Counter additions are optional when the existing observer design cannot support them without disproportionate changes; raw-driver local evidence remains mandatory.

All counters are safe, finite non-negative integers, owner-free, bounded for serialisation and immutable after diagnostic completion. A failing counter callback cannot change database outcomes. Add focused tests for omitted/invalid counts, callback errors, failed replay snapshots and late callbacks.

Do not add diagnostics tables, broaden the mobile export schema or ship per-query SQL text. No extra diagnostic SELECTs inside production replay and no request/owner identifiers in these counters. The app response still does not need a build to understand the change.

## 11. Correctness and concurrency matrix

Use the real schema and existing fixtures wherever possible. Test results are evidence, not a licence to change expected behaviour. Preserve existing 860-row logical fingerprints unless fresh base itself demonstrates a separately explained pre-existing change.

| ID | Scenario | Required result |
| --- | --- | --- |
| C01 | Server `v2_review`, client matching and valid cutover | New internal profile selected; existing #202 reuse still selected |
| C02 | Server shadow/enabled with client requesting review | No client-controlled opt-in; existing effective-mode behaviour preserved |
| C03 | Missing/mismatched acknowledgement or pre-cutover segments | Baseline suppression/warnings unchanged; do not report a suppressed response as functional recovery |
| C04 | U = 0, 1, 249, 250, 251, 2,047, 2,048, 2,049, 4,200 | All relevant IDs checked once per applicable table/batch; no omission at boundary |
| C05 | Long and multibyte evidence identifiers crossing 512 KiB | Payload cap honoured without truncating/dropping IDs; logical protection unchanged |
| C06 | Changed-ID candidate shares interior point with protected stay/commute | Same held candidate and dependent-commute exclusion as base |
| C07 | Only shared endpoint; long Visit reused after departure; same client ID | Same nuanced non-protection/protection outcome as base, not overlap-only logic |
| C08 | Manual, accepted, ignored, event-linked/no-open-Review, superseded/open combinations | Exact base protection semantics, including null/legacy cases |
| C09 | Many unrelated protected sources/history; same names/times without shared provenance | No false protection or full-history unscoped result; no name/time identity guessing |
| C10 | Same user/different workspace, same workspace/different user, device and algorithm collisions | No cross-scope read/write/lineage or borrowed protection |
| C11 | L = 0, 1, 249, 250, 251, 2,047, 2,048, 2,049 and larger-than-two-batch input | Correct JSON batches and exact logical links/sequence/roles |
| C12 | Duplicate evidence in one segment, same evidence across two segments/roles | Preserve first-conflict index; do not globally deduplicate valid relationships |
| C13 | Missing evidence map entry or unresolved commute endpoint | Baseline omission preserved; no orphan insert or renumbering |
| C14 | Existing protected lineage mixed with mutable links | Protected UUIDs/content unchanged; only correct mutable links replaced |
| C15 | JSON/bound/constraint/owner-trigger violation after an earlier write | Entire replay rollback; no partial output or leaked connection |
| C16 | Second new-profile lineage batch fails | Fault definitely executed; deletion and first batch rolled back |
| C17 | Semantic write fails after lineage completes | No committed segments/links/Review/entries; complete rollback |
| C18 | Lost response then same replay; stable repeated replay | Same logical output/IDs/receipts, no duplicate Reviews or entries |
| C19 | Quick Confirm before replay, replay before Quick Confirm | Exactly one canonical entry for the explicit action; terminal history/receipt untouched |
| C20 | Review correction races with protection read | Two real connections; no stale replacement of a committed protected decision, no new deadlock pattern |
| C21 | Same-owner concurrent replays / ingest versus replay | Existing bounded owner-lock behaviour, no second owner or partial progress |
| C22 | Cancellation during protection, after delete, during insertion, before commit | Destruction/rollback and lock release verified; no query dispatched after client release |
| C23 | Original 85 ms total-deadline case and #202 near-budget fallback | Retain actual deadline/rollback proof, separate from per-call latency testing |
| C24 | Timer start/stop and Health/event delivery alongside Location in isolated DB tests | Existing owner contracts preserved; do not assume or introduce a Health lock fix |
| C25 | Empty eligible evidence, one natural expiry, delayed Visit, clock-only finalisation | Exact baseline semantic behaviour; no “unchanged input” shortcut |
| C26 | Catalogue label/default category/logging preference changed between replays | Baseline proposal refresh/suppression without rewriting terminal history |
| C27 | Newly superseded open proposals | Identifiable legitimate retirement; no unexplained loss or alteration of user decisions |
| C28 | Server counters fail, serialization callbacks arrive late | No transaction/response behaviour change, bounded frozen logs |

For C20, obtain current Review lock order from the actual services before writing the test. If the base has an existing race, do not conceal it, claim this PR caused it, or silently fix it. Show base/head evidence and escalate the release relevance.

Run the existing Quick Confirm/Review mutation validator, not a hand-made direct SQL confirmation that bypasses the durable receipt path. Preserve the acknowledged-old-request and meaningful-proposal-change rejection checks.

### Logical equivalence rules

Compare complete canonical maps, not just counts. Include segment IDs/client IDs, kinds/statuses, start/stop and uncertainty bounds, place assignments, confidence/continuity, route/gap metrics, actual endpoint references, source-event links, Review proposal fields/status, entry identity/content and receipts.

Normalise random physical IDs only in **separate independently seeded fixture copies**, using stable fixture/source keys. Never normalise away a changed ID on the same database or disguise a broken foreign key. Exclude only explicitly documented volatile write timestamps and baseline-mutable link UUIDs from logical comparisons. Protected history/receipts must be exact. Preserve the raw snapshots before reducing them to hashes.

## 12. Production-shaped fixtures and finite performance gates

### 12.1 Required workload families

**S0 — existing regression:** unchanged 860-row reliability fixture with its 56 stays, 28 commutes, 28 Reviews, zero entries and 840 logical links, subject to the existing base assertions. [R8]

**S1 — production-shaped:** at least 4,200 accepted eligible observations across a seven-day synthetic journal, roughly 100–130 stays and 50–70 commutes, 10–20 deliberately protected source segments, and at least 2,000 mutable/resolvable intended lineage links. Include both saved and unknown stays, Visits, route points and genuine per-episode transitions. Do not inflate evidence count with thousands of ignored provider-status fillers while leaving the same tiny persistence workload.

Counts near the supplied 109/58/14 are shape targets, not a demand to fabricate that exact incident. Generate once, inspect the derived output and freeze the expected baseline. If real baseline output differs, report actual counts and amend the **synthetic fixture description**, not detection thresholds or golden output to match wishful expectations. A fixture with inadequate lineage/protection work does not satisfy S1.

**S2 — boundary/fan-out:** enough distinct segment-evidence IDs and lineage to exercise both sides of the new caps, many unrelated historical protected sources, and at least one relevant protected source in the last batch. Verify no loss behind any cap.

**S3 — growth characterisation:** approximately 8,400 eligible observations with genuinely larger segment/link/protection work. The standard/no-added-latency case must complete; the adverse-latency case may safely time out but is then recorded as a capacity limitation, not PASS for that latency/size. Do not drop older evidence or change the tested size to force success.

Each family needs:

- **First-success state:** evidence ingested, but the current replay's segments/events/Reviews do not already exist. Existing unrelated protected history may exist.
- **Stable state:** derived output exists, same input/clock/catalogue, ordinary repeated replay.
- **Changed-input state:** a small evidence addition or clock transition legitimately changes an open proposal while protected/terminal history is present.

The first-success state is critical: production currently has uploaded evidence without completed output. A benchmark that only rewrites already prepared rows can miss first-run category/event/Review costs.

### 12.2 Measurement clock and simulated latency

Use one request-start timestamp and an 8,000 ms absolute deadline with the normal 1,000 ms reserve. Include a **500 ms simulated pre-transaction/request-auth cost** in the end-to-end performance model so the replay does not receive a fresh seven seconds after authentication. This is test-only simulation, not an attempt to fabricate actual auth timings.

Apply additional latency at the **raw driver boundary**, before every driver call including configuration, and retain cancellation/release checks before dispatch. Do not use `pg_sleep` only in business queries as a substitute for modelling round trips. Clean up any still-pending test timers to prevent post-release queries or contaminated later measurements.

Keep separate fields for additional per-call delay and total deadline. Do not repeat the earlier 85 ms naming ambiguity.

### 12.3 Finite matrix

Use these planned measurement runs, not an unbounded repeat-until-green loop:

- S1 first-success, stable and changed-input states at 0, 40 and 100 ms additional latency per raw call, once per state/profile on base and candidate: 18 measurements.
- Two additional independent S1 first-success 100 ms samples per source for a three-sample median/range: four more measurements.
- S3 at 0 and 100 ms per call on base and candidate: four measurements.
- Existing total-deadline/cancellation cases remain correctness tests, not three extra performance matrices.

This is 26 principal performance measurements, plus focused correctness tests and the existing S0 validator. A baseline timeout is preserved as a result; do not replay it repeatedly or keep tuning simulation until it resembles production.

Use equivalent synthetic DB initial state per measurement. Do not let one source use warm pre-created rows while the other does first-success work. Report whether the connection/DB was warm; a three-sample median is not p95/p99 or a production capacity guarantee.

### 12.4 Required local handoff criteria

For S1 on the candidate:

- all required cases reach **commit** and return valid replay output;
- no unexplained logical-output difference versus the applicable no-timeout base oracle;
- median request-model duration at the 100 ms first-success profile <= **5,000 ms**;
- every required S1 measured request <= **5,500 ms**, with >= **1,500 ms** work budget remaining after commit;
- raw driver calls reduce materially, with changed families matching the formulas/byte-bound flushes rather than hidden skipped work;
- no unrelated statement/lock/cleanup guard is weakened;
- individual larger-batch operations remain within existing statement limits;
- the whole baseline-output/receipt/rollback suite passes.

The primary 100 ms added-latency assumption is deliberately conservative for the observed approximately 90–100 ms simple stage costs. It does not estimate actual round-trip latency from those stage values.

S3 adverse-latency failures require safe termination/rollback and explicit capacity reporting. S1 failure blocks claiming the proposed correction is ready for hosted acceptance. Do not mark success just because the request finishes at 6.9 seconds.

If a materially different machine environment causes a timing anomaly, allow one isolated rerun with preserved evidence. Do not repeatedly rerun until a favourable sample appears or weaken the target without asking.

## 13. Validation efficiency and commands

Run commands from the feature worktree root unless a workspace option says otherwise. Keep commands on one line. Substitute exact test filenames only after checking they exist.

During development: focused replay/batching/diagnostic tests and the affected synthetic fixture. Do not run the whole repository suite after every helper change.

One specialist validation pass near handoff, all using the validated local `_test` target:

```bash
npm run validate:location-v2-db
npm run validate:review-mutation-db
npm run validate:sync-transactions
npm run validate:location-reliability
npm run validate:location-replay-scalability
```

The last script is proposed; register it in `package.json` as part of this PR before documenting/running it. Do not document imaginary npm scripts. Its runner must reject absent/hosted/wrong-port/non-task-owned targets before database imports.

One final broad pass:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:docs
git diff --check
```

`lint` already includes documentation/iOS-config checks in this baseline. Do not repeatedly run every validator due to a tiny documentation formatting edit. Record what ran and why.

The prior unchanged mobile `expo-symbols` TS2307 is a known reported baseline issue. If it still occurs, verify the relevant source/dependency state or reproduce on base once, record exact failure, and retain passing web/shared checks. Do not update dependencies to conceal it. Any **new** type error is a blocker.

A previously isolated calendar timeout is not blanket permission to dismiss failures. For a new failure, preserve the broad result; at most one focused retry can establish intermittency. Report both outcomes, never relabel a failed broad run as PASS.

No local iOS clean Simulator build, Pods installation, EAS build, signed staging rebuild or TestFlight is required for this server-only scope. Let repository CI run asynchronously after push. Specialist mobile SQLite validators need not be rerun unless mobile/shared storage logic actually changes; such implementation changes are not authorised here.

## 14. Documentation impact

Classify this as server persistence/performance and validation impact, not product/detection-policy change.

Update:

- `docs/architecture.md`: dedicated Review replay batching profile, new bounded requests, unchanged transaction/protection ownership;
- `.codex/reference/location-learning.md` where existing blanket 250-row statements become inaccurate; distinguish unchanged segment/semantic batches from the new protected/lineage bounds;
- appropriate validation guidance and `docs/dayframe-regression-checklist.md`: production-shaped first-success/stable/dirty replay, safe trigger/receipt preservation, actual fault injection;
- `docs/feature-fix-tracker.md`: pending implementation/local evidence, never “production fixed” before production observation;
- this plan copy at the specified repository path;
- proposed `docs/investigations/2026-09-20-location-replay-production-scalability.md`: base/head, synthetic schema/workload, before/after numbers, limitations and stop decisions.

Do not rewrite the old #202 ledger's historical NOT RUN statements. Do not claim 29 owner-scoped attempts, reconstruction of the missing 17-item staging comparison, a Chelmer fix or historical data recovery.

Use valid Markdown command formatting such as `` `npm run lint` — PASS ``; do not place the trailing colon inside an npm-script token. Keep transient PR/build state out of permanent product/architecture documents. The PRD should state no product change unless a real contract conflict is discovered and escalated. [R10]

## 15. Finite implementation sequence and escalation

1. **Set up once:** verify attachment ID/main/worktree/local DB/schema/trigger readiness. Record source and environment.
2. **Baseline first:** create/freeze S1 fixtures, reproduce base semantics, capture query/driver counts and full replay timings.
3. **Implement A:** dedicated bounded candidate-ID probes, exact protection logic/locks. Run C01–C10 and relevant races.
4. **Implement B:** typed bounded lineage requests, separate deletion, exact provenance/order. Run C11–C18 and reachable fault injection.
5. **Check complete replay:** run the finite matrix, including semantics/commit and first-success state.
6. **Decide:** if primary correctness/performance succeeds, stop optimisation. If not, preserve evidence and stop for the smallest specifically justified extension.
7. **Finalise once:** affected specialist tests, one broad pass, scoped docs, final diff/status review.
8. **Commit/push draft PR:** complete handoff and STOP.

Stop/escalate immediately for:

- production/hosted credentials being selected for a local runner;
- need to change a trigger, schema/index, stored procedure, timeout, region or pool setting;
- code changes required outside the allowed persistence/diagnostic scope;
- uncertain protected-history semantics or a new demonstrated race/deadlock;
- requirement to scan/lock all historical protected rows without candidate intersection;
- any “optimisation” that needs to omit evidence, skip lineage, suppress warnings or change finalisation;
- corrupted environment after its single allowed recovery;
- inability to prove required rollback/fault tests actually executed;
- S1 performance still outside the declared gate after A/B and the one allowed bounded cap adjustment;
- unavailable hosted metadata preventing a claimed deployment/topology fact.

Do not leave experimental unsafe code active when stopping. Preserve the fixture/report and either revert unsafe exploratory edits or identify them as uncommitted/non-deployable. Never label an incomplete attempt MERGE READY.

## 16. Mandatory Codex handoff and STOP

Report in a compact ledger:

- actual base SHA, head SHA, branch, PR URL, clean/dirty status;
- verified plan ID and any baseline advancement;
- changed files and documentation-impact classification;
- exact runtime selection and dedicated bounds;
- before/after driver calls, protection probes, timeout-config calls, lineage requests/bytes;
- S1 first-success/stable/changed-input results and complete logical fingerprints;
- S0 regression result and S3 capacity limitations;
- genuine injection/rollback/receipt/concurrency evidence;
- broad/specialist PASS / FAIL / NOT RUN, including baseline failures and isolated retries;
- topology facts supplied by OpenClaw versus still unknown;
- any scope decision needed and why;
- explicit statement: hosted recovery and production repair are not established by local results.

After push/open/update of the draft PR, **STOP**. No CI/Vercel waiting, model invocation, staging alias assignment, hosted replay, physical acceptance, release or merge.

---

## 17. Independent review — separate job

Claude reviews the entire PR at exact actual base/head, using this plan and relevant current docs. Verify the changed SQL/packing does the same logical work, not merely fewer counted calls.

Priority issues are protection predicates, candidate scope, real row locks/Review races, duplicate/sequence behaviour, trigger preservation, cross-scope isolation, byte/row limits, rollback after a now-larger first batch, correct finite-85ms interpretation, and first-success rather than warmed-output performance claims.

Assess whether sample data has been padded to meet the evidence count while avoiding the expensive work. Check exact-head negative cases and all capacity failures. Do not approve a failed primary performance gate as if it were only a nice-to-have.

Findings: Blocker / Important / Nice-to-have, each with file/line, consequence, evidence and correction. Do not invent findings. APPROVE only when justified, scoped to the exact head. State tests actually run and NOT RUN. No edits or downstream actions.

A new material code head requires re-review. Do not change status wording before merge solely to generate unnecessary exact-head churn.

## 18. Staging validation — separately authorised after review

### 18.1 Preparation

Check current PR head equals the approved head, required checks pass and its exact Preview is Ready. Perform a single observation; if pending, report and stop rather than polling in a loop.

Verify Preview backend is staging, mode `v2_review`, and the intended profile exists in the attested source. Point `dayframe-staging.vercel.app` only at that exact Preview using a Vercel alias assignment:

```bash
vercel alias set <preview-deployment-url> dayframe-staging.vercel.app
```

Never use `vercel promote` for the staging alias; `vercel promote` targets Production. Do not point it at production configuration/data. No new iOS build is required; verify the ordinary signed staging app's existing identity/API binding.

No migration should be required. If one appears necessary, STOP. Record actual function and staging database region so performance comparisons are not presented as identical topology when they are not.

Authenticated bootstrap may schedule normal Live Activity reconciliation. Use retained runtime evidence first, and keep any newly needed bootstrap side effects within the operator's explicit authorisation. Do not call it strictly read-only.

### 18.2 Production-shaped hosted gate

A small ordinary staging journal alone is not sufficient this time. Use a dedicated synthetic staging QA owner with the same shape as S1 **only under an explicit staging synthetic-data authorisation**. Do not import KB's production coordinates or delete/reset KB's staging records.

Record the QA identity privately, create only task-owned synthetic records through approved existing interfaces/setup tooling, and validate first-success/stable replay. An authorised server replay normally writes segments/Review; this is controlled validation, not a “read-only” action. Every request uses the exact current schema and real target device/algorithm/acknowledgement values; locally parse its serialised body before sending. Never send `{}` or an invented cutover timestamp.

Choose a finite observation plan before running: one first-success and up to two stable/changed-input requests, no automatic script retry. Stop on the first failed gate and preserve evidence. No forced historical production replay.

Before/after snapshots must be authoritative, complete, privately persisted and verified readable. Record:

- selected owner/device/algorithm/backend;
- accepted eligible evidence IDs/content fingerprint and expiry times;
- relevant catalogue and decision/receipt state;
- complete segment/event/Review/entry identities and proposal fields;
- deployed source/profile and runtime counters;
- every request ID, all stage timings, actual intended/completed links and commit evidence.

Same counts or a maximum timestamp alone are not proof of identical input. Compare source/segment/evidence identity, not descriptions and clock times. Natural expiry, delayed input or explicit decisions can legitimately change output; explain each through provenance. Do not repeat the old mistake of discarding a final snapshot and later guessing an unmatched set.

Required hosted criteria for representative >=4,200-row workload:

- HTTP 200 through commit, correct mode/acknowledgement and no suppressed-output warning;
- all chosen representative requests <=5,500 ms, at least 1,500 ms remaining; aim for <=5,000 ms typical, using exact observed durations rather than averages that hide a failure;
- genuine eligible Review output on the first-success case, with no automatic Location entries;
- no unexplained lost/duplicate Review source, modified terminal history or receipt;
- full expected lineage, not just four chunks reported completed;
- no leaked account/device data, changed rollback guard or cross-environment configuration.

If an exception misses the headroom threshold, report it as a failed performance gate, not “approximately five seconds”. Any revised target needs an explicit decision.

After the synthetic gate, validate an ordinary signed staging app read of existing correctly sourced Review output. Ask KB not to confirm or edit places/categories during the preserved before/after window. A deliberate Quick Confirm test is a separate labelled step, with its expected entry/receipt recorded.

Retain acceptance outside the code branch where possible so approved source is not invalidated by temporary status wording. Evidence may be summarised after merge.

## 19. Production release and incident closure — explicit approval required

Do not deploy production as part of implementation, review or staging. KB must approve the exact merged source/release separately.

After approval:

1. Verify the actual merged main SHA and whether the active production alias already serves it. Do not assume a GitHub merge or green Preview moved production.
2. Deploy/promote production only with production Supabase and unchanged `v2_review`, acknowledgement and cutover. No staging Preview backed by staging data may be promoted as production.
3. Confirm build/runtime provenance and open production runtime logs **before** the observed normal foreground sync. No iPhone rebuild unless a separately established binary problem requires it.
4. Preserve authoritative before-state and observe one ordinary production foreground processing opportunity, not a loop of manual retries. Record any automatically generated attempts distinctly.
5. Capture the complete `location_sync` record immediately and match Dayframe correlation ID to actual invocation/deployment/source.
6. Verify persisted owner/device-scoped segments, lineage and open Review records, then their visibility in the ordinary production app. A success counter alone is not closure.
7. Check representative retained morning/evening sources, including the prior gym/private-residence observations **only if still retained and eligible**. Do not reconstruct expired evidence, reset cutover or overwrite confirmed history.
8. Establish that new Location entries appear only after explicit confirmation in review-only mode; attribute any Health/manual entries to their own owners/receipts.
9. On any failure or unexplained data change: preserve evidence and STOP. No silent region switch, timeout increase, queue clearing or manual database repair.

Production incident closure requires real persisted and visible output with comfortable budget, not merely a passing staging benchmark. Until then tracker wording remains “staging accepted / production observation outstanding”. The separate Health/activity backlog is not repaired or declared unrelated solely by this PR.

An operational rollback, if approved, should restore the prior production code/profile without deleting data. A rollback that again times out does not justify disabling protection or switching to `v2_enabled`.

## 20. What KB should test, in plain language

This is not a new gym-detection build. The app already sent the observations; the test is whether the server finally processes them in time.

After the operator says the exact approved server is ready:

- Open the ordinary staging or production app specified for that gate once, not both accidentally. Keep the existing app/data.
- Let its normal sync finish and open Review. Check the expected journey/visit is present, not just a green “Review complete” status.
- Do not use Quick Confirm during a before/after diagnostic capture. When asked to test confirmation separately, confirm one genuinely correct suggestion and check it becomes exactly one recorded entry.
- Check an existing confirmed item still has its original time/category/place, and that no new duplicate or automatic Location entry appears.
- Perform one simple timer start/stop and check it persists/syncs normally when the operator schedules that separate regression step.

The Chelmer stop, passive walking, venue suggestions, traffic-jam policy, global automation rollout and missing native return capture remain separate future tasks. This PR does not claim to fix those detection behaviours.

## 21. Source register and evidence provenance

Repository sources below were inspected at planning main unless identified as earlier operational evidence. Links are pinned; re-resolve current line numbers when implementing.

- **R1 — Main/#205 merge:** https://github.com/kwabiwe/dayframe/commit/791e57ea3d806c1474407b7b3546d05a42bd0153
- **R2 — Canonical tracker:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/docs/feature-fix-tracker.md
- **R3 — #202/production evidence ledger:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/docs/investigations/2026-09-17-location-replay-performance.md
- **R4 — Replay service:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/apps/web/src/lib/location/location-replay-service.ts
- **R5 — Effective-mode routing:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/apps/web/src/lib/location/location-ingest-service.ts
- **R6 — Review-only emitter:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/apps/web/src/lib/location/location-review-semantic-batch.ts
- **R7 — Existing transaction owner:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/apps/web/src/lib/sync-transaction.ts
- **R8 — Existing reliability runner:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/scripts/validate-location-reliability.ts
- **R9 — Hosted owner triggers/schema:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/supabase/migrations/202607200001_location_intelligence_v2.sql
- **R10 — Documentation governance:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/docs/documentation-governance.md
- **R11 — Root scripts:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/package.json
- **R12 — Agent rules:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/AGENTS.md
- **R13 — Database reference:** https://github.com/kwabiwe/dayframe/blob/791e57ea3d806c1474407b7b3546d05a42bd0153/.codex/reference/database.md
- **W1 — PostgreSQL 17 WITH/data-modifying statement semantics:** https://www.postgresql.org/docs/17/queries-with.html
- **W2 — PostgreSQL 17 row/advisory locks and deadlocks:** https://www.postgresql.org/docs/17/explicit-locking.html
- **W3 — PostgreSQL 17 transaction isolation:** https://www.postgresql.org/docs/17/transaction-iso.html
- **W4 — Vercel function regions and database proximity:** https://vercel.com/docs/functions/configuring-functions/region
- **W5 — Supabase transaction-pool connection constraints:** https://supabase.com/docs/guides/database/connecting-to-postgres

The full 19 September timing table and correlation/deployment identifiers are from KB/OpenClaw's supplied report. Detailed raw logs, actual coordinates and private source records are not included. All batch sizes, new tests, performance gates and workflow boundaries in this plan are proposed engineering decisions, not claims that those changes have already been implemented or measured.
