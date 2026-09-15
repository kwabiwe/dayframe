# Dayframe Location Reliability — implementation plan V1

**Prepared:** 14 September 2026\
**Owner:** KB\
**Repository:** `kwabiwe/dayframe`\
**Verified main / planning baseline:** `a83bfc976f03b14ffc48712681707ecdc27b2601`\
**Preceding delivery:** PR #196 merged at that SHA from approved head `139fa024d9554eb8e2909421bd546dad0c3709c3`\
**Proposed branch:** `codex/location-reliability`\
**Proposed repository home for this plan:** `docs/plans/location-reliability-v1.md`\
**Implementation model/effort:** GPT-6 Astra / High, following the agreed model strategy. Do not silently change model or effort.\
**Independent reviewer:** Claude Opus 5 / Low via OpenClaw and the Claude CLI.\
**Delivery:** One focused PR from fresh main. No stacked branch, no reopening #196, no reserved PR number.

## 0. Session boundary: read this first

This document describes implementation **and separately owned later acceptance**. It is not an instruction for one agent to perform the entire lifecycle.

**The initial Codex session owns only Sections 1–11: verify baseline, implement the authorised scope, run focused tests, perform one final validation pass, inspect its diff, commit, push and open/update a draft PR. Then STOP.** Report incomplete evidence honestly. A pushed draft is the handoff, not a trigger to begin release work.

Codex must not:

- wait for or poll GitHub CI or Vercel, run `gh pr checks --watch`, or repeatedly refresh deployment status;
- invoke Claude/OpenClaw, mark its own work independently approved, or merge;
- promote staging, trigger a hosted deployment, alter Vercel/Supabase configuration, or touch production;
- log into Expo/EAS, start an EAS build, build/install an iPhone app, or perform physical acceptance;
- replay real staging journeys, seed a real account, clear queues, reset acknowledgements, export private evidence, or change iPhone permissions;
- restart the whole test matrix after every small change or turn an environment problem into an open-ended repair session.

The handoff report must explicitly say **STOPPED** and list CI, Preview, hosted smoke, signed build and physical tests as **NOT RUN BY CODEX**. Do not claim they failed merely because this session does not own them.

**Bounded failure handling:** after two genuinely different attempts to resolve the same local setup/validator blockage, or about 15 minutes spent repairing that setup, stop that activity and report the missing prerequisite. A repeat command with no changed hypothesis does not count as useful work. Do not fix unrelated dependencies, install another database version, or rebuild native iOS to make a report green. Safety/correctness failures remain failures, not exceptions to waive.

## 1. Objective and explicit limits

Make Location evidence upload substantially less expensive in database round trips; make upload and replay failures diagnosable; measure whether realistic retained-evidence replay completes within the existing limits; and preserve recovery, ownership and privacy.

User outcome: observations already captured by the staging phone can progress to server evidence, then to qualifying **Review suggestions** in `v2_review`, without duplicate events or entries. If the server still cannot complete processing, the existing diagnostics must identify the failing stage rather than merely showing `HTTP 503`.

This is **not** a promise to reconstruct missing return-journey observations. No retained native/SQLite evidence was found for that departure window. The cause of that gap has not been established. Preserve and document it as a separate capture investigation; do not invent a journey, alter detection thresholds, or start a native capture rewrite here.

### Included

1. Safe structured failure evidence in both Location routes and the existing mobile Location diagnostics.
2. A single parameterised multi-row evidence insert per valid upload batch, replacing the per-item insert loop.
3. Real PostgreSQL/PostGIS correctness, contention and query-count/performance evidence for **upload and replay separately**.
4. If profiling establishes replay's evidence-link insertion loop as a significant bottleneck, a narrowly bounded same-transaction batching correction to that loop, with equivalence tests. This conditional work is authorised below; it is not permission to redesign replay.
5. Targeted Settings/diagnostic-export presentation of the safe details, without new Today/Review error banners.
6. Focused durable documentation updates and a small #196 delivery-status reconciliation.

### Excluded

- New queues, retry coordinators, background jobs, capture engines or canonical stores.
- Any change to rollout mode, cutover date, finalisation lag, retention, permissions, geofence radii, confidence/overlap thresholds or automatic-logging policy.
- Timer, Health, Review mutation or Today/chart redesigns; PR #196's 100-malformed-handover-row follow-up; `expo-symbols` dependency cleanup.
- Entry-sheet/Suggestions/duration-dial large-text repairs, native modules, pods, entitlements, signing identities or Xcode project changes.
- Splitting replay into partial semantic commits, widening its evidence window, silently truncating evidence, adding a new replay cursor, changing advisory-lock scope/order or increasing timeouts.
- New analytics, private-data export functionality, public debug routes or a schema migration by default.

## 2. Evidence and what remains uncertain

### 2.1 Owner-supplied incident evidence

The following comes from OpenClaw's report supplied by KB, not from a new hosted inspection by the plan author:

- The inspected staging phone had source `aefbc695…`, separate staging identity, `v2_review`, and semantic acknowledgement at 7 September 19:03 UTC.
- It had zero saved places and zero accepted learned places. This affects automatic trust, not whether a sufficiently evidenced unknown-endpoint commute can be proposed in Review.
- The retained seven-day local journal contained 860 records: 605 standard-location, 102 significant-change, 93 Visit and 60 provider-status records.
- Local snapshots contained 48 commute and 68 stay segments. These are engine records, **not proof of 48 distinct real journeys, canonical output or user-visible entries**.
- 555 observations were acknowledged by the server; 305 remained associated with seven pending batches with repeated 503 responses.
- Last retained successful replay: 7 September 18:19 UTC, before the acknowledgement above. Last retained output: two finalised segments, zero semantic segments.
- The inspected live staging deployment was `dpl_FD9nVR2Kxnr9d5ZuDKogmS3sbRS3`, source `6ca7954469f638aa04a093eea50f9730b83ed174`, Ready, effective mode `v2_review`. Both Location endpoints returned 503 with valid sessions.
- The app and server were therefore on **different source revisions**. Do not use either historical identity as the deployment baseline for this new PR.
- Gym example: departure from home approximately 05:25 UTC; movement/Visit evidence approximately 05:34–05:40 UTC; no retained evidence was found from 05:40 through the approximately 06:35 return departure.
- Historical response bodies, precise database phase and request duration were not retained. The actual cause could not be separated into connection acquisition, lock contention, statement timeout or overall deadline.
- A concurrent-client warning occurred on other, successful Review-presentation requests. Different request identifiers mean it is **not proof** of the Location failure.

Keep these distinctions in the investigation. Do not upgrade a hypothesis into a confirmed incident cause because a synthetic experiment reproduces one possible mechanism.

### 2.2 Verified post-merge source facts

Source was inspected at main `a83bfc9…`:

- `location-ingest-service.ts` validates/classifies a batch, takes the existing workspace/user lock, writes a coordinate-free event summary, then awaits one `location_evidence` insert per observation. Upload does not emit commute semantics. [R3]
- Both Location POST routes use an eight-second route-level operation deadline. The shared helper reserves cleanup time, limits statements/locks, and adds a timeout-configuration query before each nested service query. [R4, R5]
- Replay loads retained accepted evidence, runs the deterministic engine, persists segments and replaces lineage. `replaceEvidenceLinks` currently inserts links one at a time too. [R6]
- `fetchLocationSync` already returns parsed non-success bodies when available. The store turns non-success upload/replay responses into a generic HTTP error and loses their safe structured details. [R7]
- Existing success replay parsing is strict. Add diagnostic identifiers/timing in **headers**, not unplanned fields in the success JSON. [R8]
- Location SQLite, upload/replay, session guards and foreground/reconnect recovery already have owners. Extend them; do not replace them. [R2, R7, R9]
- The tracker and UX roadmap still describe Stage B as unmerged. GitHub/main establish that #196 is merged. Reconcile only the affected status sections, not the whole documentation set. [R1, R10]

## 3. Preflight and reading order

### 3.1 Establish the isolated branch

Run from the existing local Dayframe repository. These commands inspect/fetch; do not reset, pull over, or clean the user's worktree:

```bash
git status --short
git fetch origin main
git rev-parse origin/main
git show --no-patch --format=fuller origin/main
```

The expected baseline is `a83bfc976f03b14ffc48712681707ecdc27b2601`. If main has advanced, record the actual SHA and inspect intervening changes to the listed owners. Use fresh main if changes are unrelated; stop for a material contract conflict or an already-active overlapping implementation. Do not hard-code an old SHA just to match this document.

Create a new worktree only if the proposed branch/path do not already exist:

```bash
git worktree add -b codex/location-reliability ../dayframe-location-reliability origin/main
```

If they exist, inspect them before reusing; do not delete/reset them. Copy this plan into `docs/plans/location-reliability-v1.md` **on this feature branch**, then work there. It does not need a separate commit/PR into main first. Preserve the supplied plan for reviewer access.

### 3.2 Read only relevant current guidance

Read `AGENTS.md`; relevant Location/auth/diagnostic sections of `docs/PRD.md`, `docs/architecture.md`, `docs/feature-fix-tracker.md`, `docs/dayframe-regression-checklist.md`; `docs/documentation-governance.md`; `.codex/reference/location-learning.md`; relevant database/API/validation references; and the hosting runbook for environment boundaries.

Read `docs/roadmaps/review-ux-roadmap.md` only to reconcile Stage B and record the owner's Location-reliability interlude. Calendar/web remain future. Read the brand/typography and motion references only as needed for existing Settings fields; this PR introduces no animation or new navigation.

Older AGENTS/reference wording about release work or a feasible Simulator build is not authorisation to execute those steps in the implementation session. The explicit session/actor boundaries in Section 0 control this task. Do not launch another documentation audit.

### 3.3 Capture the baseline efficiently

Record the relevant functions, existing tests, script names, dependency state and current schema requirements. Reproduce a new regression with a focused test first. Do not run a full baseline workspace suite before implementation and then again after each subtask.

The historically known mobile typecheck exception is TS2307 for `expo-symbols` in `ConnectivityStatusStrip.tsx`. Verify it still exists if encountered; report it separately from new errors. Do not suppress it, add an ambient declaration, or edit the package lock to hide it.

## 4. Owners and likely files

| Area | Existing owner / likely file | Authorised responsibility |
| --- | --- | --- |
| Ingest | `apps/web/src/lib/location/location-ingest-service.ts` | Bulk insert, safe stage markers, unchanged atomic event/evidence boundary |
| Replay | `apps/web/src/lib/location/location-replay-service.ts` | Measurement; conditional lineage batching only if warranted |
| Routes | `apps/web/src/app/api/location/evidence/route.ts`, `.../replay/route.ts` | Safe response/log correlation and failure evidence |
| Transaction lifecycle | `apps/web/src/lib/sync-transaction.ts` | Preserve budgets, one checked-out client, cancellation, commit/rollback; minimal additive observation hook only if necessary |
| Mobile HTTP boundary | `apps/mobile/src/lib/location/network.ts` | Extract allowlisted response diagnostics; preserve existing network/auth semantics |
| Durable Location state | `apps/mobile/src/lib/location/store.ts` | Persist bounded safe upload/replay results under existing owner guards |
| Settings | `apps/mobile/app/settings.tsx` | Existing Location diagnostics/read/export UI only |
| Pure shared contract | Proposed `packages/shared/src/location/syncDiagnostics.ts` and export | Small whitelist/parser/type shared by routes and mobile, not a new owner |
| Tests | Existing Location service/route/mobile tests; `store.sqlite.test.ts`; new narrowly named reliability tests | Real DB, bounded diagnostics, ownership and recovery coverage |
| Validation | `scripts/validate-location-v2-db.ts`, `scripts/validate-location-v2-sqlite.sh`, `scripts/validate-sync-transactions.ts` | Reuse disposable harnesses; add one opt-in reliability/performance runner only if needed |
| Evidence | Proposed `docs/investigations/2026-09-14-location-reliability.md` | Source facts, synthetic results, uncertainty, separate hosted/device gates |

Existing filenames above were inspected or referenced by current scripts; proposed names are suggestions, not assertions that files already exist. Reuse an equivalent helper/harness if present. Keep changes focused rather than spreading incidental formatting across large files.

## 5. Work package A — useful, private failure evidence

Implement this before performance changes so experiments can identify their failing phase.

### 5.1 One safe contract

Define a small schema/parser for optional Location failure details. Allow only known keys and bounded values. The following is the intended shape, not a demand to rename existing compatible fields:

| Field | Rule |
| --- | --- |
| `endpoint` | Local enum `evidence` or `replay`; never an arbitrary URL |
| `httpStatus` | Integer HTTP status when known; otherwise null |
| `code` | Explicit allowlist of existing safe Location error codes; unknown becomes a fixed generic value |
| `reason` | Existing safe reason enum, including timeout, cancellation, unavailable/lock-unavailable; do not trust arbitrary text |
| `phase` | Existing transaction phase enum or `unknown` |
| `locationStage` | Optional request-local substage enum: validation, evidence cleanup, summary write, bulk evidence write, evidence read, catalogue read, engine, segment persistence, lineage, semantics |
| `sqlState` | Five uppercase alphanumeric characters only, optional |
| `requestId` | Newly generated random server request ID; bounded, validated format |
| `retryAfterMs` | Finite nonnegative integer with a reasonable cap; diagnostic only in this PR |
| `durationMs` | Finite nonnegative bounded duration; distinguish server duration from client elapsed time |
| timestamps | Generated attempt/completion timestamps; never infer a trip time from them |

Do not preserve `error.message`, SQL `detail`, query text, query parameters, raw bodies, cookies, authorisation headers, coordinates, descriptions, place names, category IDs, event/evidence IDs or opaque arbitrary metadata in ordinary logs/diagnostics. A diagnostic request ID is independent of session, user, batch and journey identities.

Parsing must **construct a whitelisted output**. Spreading a raw response and deleting a few known-sensitive fields is not sanitisation. Unknown fields and malformed values are ignored; missing safe details fall back to the known status/general classification, never a secondary exception.

### 5.2 Server route logging and correlation

For each Location POST request, create/reuse a safely generated server request ID. Prefer a new `X-Dayframe-Request-Id` response header over changing successful JSON. Return it on success and failure, including private auth/validation responses. Any inbound client/platform ID must not be echoed/logged unchecked or trusted as identity.

Emit at most **one bounded structured completion/failure record per request**, using the same generated ID and safe endpoint, outcome/status, duration, phase/substage and classification. No per-evidence console output. It must remain possible to correlate a mobile failure with Vercel logs even if Vercel does not retain the response body. Do not enable verbose database logging.

Keep existing error status mapping and `private, no-store`/`Vary` headers. Preserve existing safe 503 body fields; additive safe error details are permitted. Prefer duration/correlation headers for successes because `LocationReplayResponseSchema` is strict. Do not add an unauthenticated debug endpoint or change auth scopes.

Use request-local timing/state. Update substage markers immediately before the relevant work; never store them in a process-global mutable variable that concurrent requests can overwrite. Preserve the helper's actual `acquire`/`owner_lock`/`commit`/failure phase; a last service substage must not falsely label an acquisition or commit failure as a bulk-insert failure. Logging/observation failures must not turn a committed operation into a retry or mask the original error.

The existing helper exposes eight-second total / one-second cleanup reserve / three-second statement / 1.5-second lock / five-second idle limits. **Do not change these constants, disable query guards or restore the obsolete eight-second statement helper.** The Repeatable Read-at-BEGIN correction from #196 remains intact. [R4]

### 5.3 Mobile extraction and persistence

Extract safe details from the already-read `{ response, body }` returned by `fetchLocationSync`; do not read the body a second time or reissue the request. A small Location-specific error carrying only sanitised fields may extend the existing HTTP error, keeping `instanceof MobileHttpResponseError` classification compatible.

Handle existing 401/403 auth rejection and captured-session replacement **before** storing a server error. Cancelled/stale requests must not write a replacement account's diagnostics. Preserve the existing full-response deadline and bearer-only/cookie-omission contract.

Keep the status policies unchanged: 413 resizing, existing permanent invalid handling, partial acknowledgement, jittered exponential backoff, maximum batches per pass and foreground replay/coalescing. The server retry hint is recorded for diagnosis; it must not silently introduce a faster retry schedule or an agent-driven retry loop.

Extend the current Location metadata/`updateOwnedDiagnostics` path. Do not create a second table/queue solely for diagnostics. Store one latest attempt result per endpoint plus its existing last-success information, not an unbounded log. Explicitly bind new records to the current backend/account and ignore incompatible/legacy unknown records. Revalidate captured ownership before writes, reads and exports; clear/invalidate these new diagnostic records on logout/account replacement using the existing cleanup owner. Do not reset the Location journal or rollout acknowledgement.

On an endpoint's next successful operation, clear its active failure and record success. Upload success **must not erase replay failure**, and replay success must not imply that all pending upload batches drained. Keep counts/status honest: `semanticSegmentCount` is not necessarily the number of newly created Review items; verify actual identities/counts for that assertion.

A valid 503 JSON body should retain its safe details. HTML, empty or malformed responses must degrade safely without logging content. Keep HTTP status where the current network layer makes it available; otherwise use an explicit unknown-response classification rather than fabricating a status. Do not broaden this into a shared networking rewrite.

### 5.4 Settings only

Use the existing Location area in **Sync & diagnostics** and its existing export/share action. Present, for upload and processing separately, a short status, last attempt time and expandable/copyable safe reason/stage/request ID as appropriate to existing components. Expose available server duration and client elapsed duration with different labels.

No new Today/Review banners, alerts, spinners or connectivity icon. Use current typography/reflow; long safe IDs can wrap or live in details so they do not break large text. Export only the allowlist. Retain existing capture counts and native-status information; do not put precise coordinates in the export.

## 6. Work package B — one evidence insert, same meaning

### 6.1 Required algorithm

Keep this sequence inside the existing transaction owner:

1. Authenticate and validate the entire request, including the 512 KiB route bound and maximum 100 observations; retain the current classification and time checks.
2. Acquire the same workspace/user advisory lock using the same lock order.
3. Perform the existing bounded expired-evidence cleanup.
4. Write/reuse the existing coordinate-free `activity_events` batch summary, retaining batch idempotency and `duplicateBatch` behaviour.
5. Execute **one parameterised multi-row insert** for all candidate evidence rows.
6. Build the existing response, then let `withSyncTransaction` commit. Only after successful commit may the route acknowledge success.

Preferred low-complexity implementation: a bounded `INSERT ... VALUES (...), (...) ... ON CONFLICT (workspace_id, user_id, device_id, client_evidence_id) DO NOTHING` query using trusted placeholder generation and a parameter array. A typed `jsonb_to_recordset` implementation is acceptable if smaller/clearer with equivalent tests. Do not use COPY, a new driver, `Promise.all(client.query(...))`, one transaction per observation, or `pool.query` inside the transaction. [T1, T2]

### 6.2 Field mapping and privacy equivalence

Extract the current mapping into a typed pure helper if useful; compare against the baseline before replacing it. Preserve:

- workspace/user exclusively from the authenticated session; device/batch/algorithm/time-zone validation as currently implemented;
- kind, occurrence/received/departure times, simulation marker, saved/geofence references, accuracy and validated metadata;
- PostGIS longitude/latitude order: `ST_MakePoint(longitude, latitude)`, SRID 4326 and geography type;
- null coordinates for coordinate-free signals and for classified rejected observations;
- current nulling/normalisation of altitude, speed and course on rejection; no falsy conversion that turns valid zero values into null;
- `accepted`, `rejection_reason`, expiry calculation and seven-day retention; no refreshing an existing row's expiry just because it was retried;
- rejection classification versus durability: a policy-rejected observation may still be durably stored without coordinates and acknowledged under the current contract. A server error is not the same thing as that classification.

Do not interpret `RETURNING` rows as the only acknowledged IDs: conflict-skipped observations may already exist and are still acknowledged after a successful transaction. PostgreSQL returns only inserted/updated rows in `RETURNING`. Preserve the existing response identity semantics for fresh, duplicate, mixed and policy-rejected batches. [T1]

### 6.3 Duplicates and failures

Test duplicate client-evidence IDs both across requests and within one accepted request. Preserve the original loop's deterministic first-row persistence and existing classifier decisions; explicitly select a first representative in original input order if required. Do not silently change classification to fix an unrelated duplicate-policy concern.

The summary and evidence remain all-or-nothing. Inject failure at bulk write and commit/cancellation boundaries and assert no partial new summary/evidence is acknowledged. Replaying a committed request after response loss must retain exact client IDs and produce no duplicate records.

Do not solve a foreign-key or validation error by dropping the offending row, widening ownership or marking the batch successful. Preserve current error policy; escalate a newly discovered independent correctness defect rather than hiding it inside this optimisation.

## 7. Work package C — measure replay and apply only an evidenced narrow optimisation

**Faster evidence upload does not prove replay is repaired.** Replay has its own retained-data read, engine, segment writes, lineage and semantic emission. Measure them independently using the real shared transaction helper. [R6]

### 7.1 Measurement harness

Reuse existing disposable PostgreSQL 17/PostGIS setup. A proposed opt-in runner is `scripts/validate-location-reliability.ts` with `npm run validate:location-reliability`; add it only if existing test runners cannot cover this cleanly. It must:

- refuse non-loopback databases and names not ending `_test`;
- use a unique synthetic owner/fixture namespace, not real account data;
- run under explicit local database configuration; never load hosted credentials implicitly;
- call the real `ingestLocationEvidence`, `replayRetainedLocationEvidence` and `withSyncTransaction`, with the existing injected-pool seam where suitable;
- count **actual driver queries**, including timeout-configuration round trips, not only top-level calls;
- record per-stage time, operation outcome, transaction/query counts and fixture shape without raw payloads;
- verify domain results alongside timings: a fast transaction that produces nothing when a known fixture should produce Review is a failure;
- stop its own processes and remove only its own synthetic fixtures on completion/failure. Never broad-delete an unrelated workspace or a user's local database.

### 7.2 Finite workload matrix

Prepare before/after evidence for:

| Fixture | What it demonstrates |
| --- | --- |
| 1 / 25 / 100 valid observations | Correctness and constant evidence-insert query count |
| Duplicate and mixed-rejection 100-item batches | Idempotency/acknowledgement/privacy preserved |
| Seven-day synthetic history near the observed scale: about 860 observations and substantial stay/commute/lineage output | Replay cost with meaningful data, not 860 points that collapse to a single stay |
| Seven pending batches totalling about 305 remaining observations, alongside about 555 stored observations | Bounded multi-pass backlog recovery with unchanged request identities |
| Two concurrent same-owner sessions: upload versus replay | Lock contention stays bounded and correctly diagnosed |
| Two different owners | No new global serialisation or cross-owner data |
| One unknown-endpoint, post-cutover qualifying journey with no saved places | Review-only output can exist without automatic-trust endpoints |
| An intentionally incomplete return window | No fabricated commute from absent route evidence |

Use existing synthetic engine fixtures and generate a deterministic seven-day workload. Record actual generated segment counts; do not label it an exact replay of KB's private 48/68 records. Include a fixed processing clock/cutover so fixtures do not age out accidentally. Preserve real local-day/DST and finalisation assertions in existing tests.

For performance measurements, use one before run and up to three after runs per selected representative case. Include normal local transport plus a documented **test-only** per-driver-call latency, such as 20 ms and one 40 ms stress run for the 100-item/replay cases. Those are synthetic stress assumptions, not measured staging latency. Never ship the delay hook or sleep inside the production transaction.

Measure full route/session work separately where the harness supports it: the eight-second route deadline starts before authentication, so service-only timing is not the whole budget. Keep a margin rather than counting a 7.9-second success as robust.

Expected structural improvement: evidence inserts fall from up to 100 to one and their associated timeout-configuration overhead falls accordingly. Local representative upload and replay should complete within unchanged budgets without deliberately held contention. Record actual results; no invented p95 from three samples and no claim that loopback timing proves Vercel performance.

### 7.3 Conditional replay lineage batching

The current `replaceEvidenceLinks` function deletes links for the permitted derived segments and then inserts each link separately. If measured lineage round trips materially consume replay's budget, replace that insert loop with parameterised **bounded chunks**, for example a named 250-row chunk size, within the same transaction and deadline. This is the authorised replay correction; justify it with before/after numbers. [R6]

Preserve all of the following:

- exact workspace/user/segment/evidence linkage and existing `ON CONFLICT DO NOTHING` semantics;
- original `sequence_index` and `inside` versus `route` role;
- exactly one appropriate stay/commute foreign key per row;
- all protected/manual/terminal segment IDs: do not delete or replace their evidence links;
- missing evidence-ID behaviour, deterministic ordering and current ID maps;
- atomic deletion plus replacement; any chunk failure rolls the transaction back;
- no new commit between chunks, no progress checkpoint in live data and no parallel queries on the checked-out client.

Keep CPU/input preparation bounded by existing data and avoid duplicating the whole retained journal unnecessarily. Check remaining operation budget at safe existing boundaries; do not add an unbounded retry or extend the deadline.

### 7.4 Replay escalation condition

If the observed-scale replay still cannot finish, identify whether the remaining cost is segment upserts, semantic emission, connection acquisition, lock contention or engine work. Supply the safe stage/query-count/timing evidence and **stop for a scope decision**. Do not silently add arbitrary SQL LIMITs, change `supersedeMissingSegments` to operate on partial history, remove locks, raise timeouts, introduce incremental replay ownership or rewrite the engine.

An optimisation of lineage is not proof that every replay cost is solved. It is acceptable to hand off a draft described as **“bulk upload + diagnostic foundation; replay completion still blocked”**. It is not acceptable to label the incident fixed without successful replay/output evidence. This stop condition prevents an open-ended three-hour redesign session.

## 8. Required regression coverage

### 8.1 Real PostgreSQL / route boundary

Use a real disposable PostgreSQL 17/PostGIS database for SQL semantics and locking. Mocks alone cannot establish these behaviours.

- Compare persisted fields, acceptance/rejection, expiry, summary and acknowledgement identities before/after bulk insert for 1/25/100 items.
- Duplicate batch, duplicate observations in another batch, duplicate IDs within one batch, conflicting duplicate content, mixed policy rejection, coordinate-free signals, zero-valued optional metrics and invalid FK rollback.
- Empty/101-item/oversized/invalid-time/mismatched-device bodies keep their existing rejection status. Authentication precedes account data access.
- Same client IDs under different users/workspaces/devices remain isolated by the appropriate full conflict key.
- Upload alone emits no commute Review/entry; dedicated replay does. A repeat replay creates no duplicate semantic records and never overwrites accepted/ignored/manual outcomes.
- Successful `v2_review` replay with no saved endpoints produces a known qualifying Review suggestion, never an automatic confirmed entry. Shadow/cutover/mismatched-mode and terminal-decision safeguards remain covered.
- Held advisory lock returns a classified bounded failure; release it and one later explicit test attempt succeeds. This controlled failure is expected, not a test to rerun until it stops failing.
- Simulated connection acquisition exhaustion, statement timeout and total deadline yield their honest phases and release/rollback safely. SQLSTATE-only ambiguity must stay ambiguous rather than receive an invented reason.
- On lost response after committed upload, retry the same batch and prove deduplication.
- Route responses/logs carry the same safe request ID and no private content. Auth failures are not labelled Location processing failures.
- Replay lineage chunking, if implemented, preserves protected links and rolls back all chunks on injected failure.

### 8.2 Mobile unit + actual SQLite

- A valid structured 503 preserves allowlisted fields for **each** endpoint in the existing diagnostic store/export.
- Empty/HTML/malformed JSON and oversized/hostile diagnostic values degrade safely; no raw body/message/coordinate/token survives. Missing body/correlation must not prevent scheduling the existing retry.
- Recording a diagnostic is not an acknowledgement and changes no batch ID, evidence payload or journal capture time.
- Upload success clears upload's active error only. Upload-success/replay-failure with an empty queue remains observable and recoverable through the existing foreground owner.
- Full JSON timeouts, 401/403, cancellation, stale response, logout/account/backend change cannot write another owner's diagnostic state or clear their work.
- A retry after failure preserves request identity; expiry/auth/backoff behaviour is unchanged.
- A diagnostic persistence failure must not cause network redelivery of already-committed work, mask the original error or leave the serial queue permanently rejected. Reuse existing error containment.
- Seven synthetic batches can progress across the existing maximum-five-batches passes; do not require a single pass to drain seven. Trigger a finite number of existing recovery passes in the test, not an endless `while pending` loop.
- Settings renders the new fields without overflow at large text and VoiceOver can read them; no Today/Review banner or connectivity-owner change.

Use the Location SQLite harness rather than rerunning unrelated Review/Health/native suites after every edit. If a shared primitive is actually changed, add its specific regression tests.

## 9. Validation schedule: one ledger, no loops

Maintain a concise validation ledger: command, scope, outcome, reason, elapsed time, and whether the result predates the last relevant edit.

### During implementation

Run only the affected unit/route/SQLite/DB cases. First reproduce the correctness/performance issue in the relevant harness, then implement and rerun that case. Do not start a broad suite per work package.

### Once near handoff

From the feature worktree root, run one final broad pass:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
git diff --check
```

At the inspected baseline, `lint` already runs `check:docs` and `check:ios-config`; do not repeat those separately without a relevant subsequent edit. Record individual command results even if typecheck has the known baseline error. A baseline exception is not an overall green typecheck.

Additionally run once, against the already prepared **disposable local ordered schema**, the specialist checks actually affected:

```bash
npm run validate:location-v2-db
npm run validate:location-v2-sqlite
npm run validate:sync-transactions
```

`DATABASE_URL` must already be explicitly set to the guarded local `_test` database for database commands. Never paste a hosted URL into these validators. The Location DB validator already refuses non-loopback/non-`_test` targets. Use PostgreSQL 17/PostGIS; do not attempt to make a hosted-only RLS migration run on a plain local database by changing its semantics. Reuse documented fresh-base/ordered setup distinctions. [R11]

Run the new opt-in reliability suite once in this final phase if it is separate from those commands. If already exercised as part of an amended Location validator, do not duplicate it. Let the hosted CI matrix exercise its configured extra schema variants asynchronously.

**No local clean iOS Simulator build is required:** this plan changes TypeScript/server/database behaviour, not native modules/config. If native changes become necessary, stop for scope approval; that approval can then select the appropriate native checks. Signed-device acceptance is a later job, using local Xcode, not EAS.

After a small final edit, rerun only the affected focused tests/checks. Rerun a full suite only when the edit invalidates its broad evidence. If a critical test remains blocked/unavailable, the PR stays draft and the handoff must state that limitation; do not claim readiness.

## 10. Documentation and evidence

### Durable documentation in this feature PR

Classify impact as **Location reliability + safe diagnostics/API observation + validation**, not new product automation or new ownership.

Update only relevant sections:

- `docs/architecture.md`: bulk evidence write and safe request diagnostics, existing transaction/owner boundaries retained.
- `.codex/reference/location-learning.md`: upload/replay diagnostic distinction, measured backlog validation and conditional lineage batching.
- `.codex/reference/api.md`: additive safe Location failure/correlation contract, success-body compatibility.
- `.codex/reference/validation-matrix.md` and `docs/dayframe-regression-checklist.md`: real bulk/replay, privacy, contention and empty-upload-queue replay checks.
- `.codex/reference/database.md` only if query/persistence documentation or an explicitly approved schema change requires it.
- `docs/feature-fix-tracker.md`: new Location work is pending on this branch, not shipped/production-repaired.
- New investigation: accurate incident evidence, actual baseline/new SHAs, measured synthetic results, first still-failing stage, schema/hosted/device NOT RUN items and capture-gap follow-up.

Do not copy transient build logs into PRD/architecture. Product rules remain unchanged; state that rather than rewriting the PRD. Log safe structured examples only; private owner exports stay outside committed files.

### Small post-#196 reconciliation

In the same focused documentation pass, correct the tracker/roadmap's stale Stage B open/draft wording to **merged at `a83bfc976f03b14ffc48712681707ecdc27b2601`**. Record KB's supplied physical approval as owner-reported evidence without inventing exact deployment/build attestations. Do not infer production release or TestFlight status from the merge.

Record the approved sequence: **Location Reliability next; entry-sheet accessibility later; Calendar/web roadmap stages not authorised now.** Note the deferred malformed-handover scan case without implementing it. Do not repeatedly rewrite old investigations to modernise every historical statement.

Clarify this plan's device validation uses an ordinary **locally signed Xcode staging app**; no Expo/EAS account is required. Do not undertake a global runbook rewrite.

## 11. Initial implementation handoff and acceptance criteria

Before pushing: inspect changed filenames, final diff, Git status and `git diff --check`; remove accidental local artefacts, not user-owned files. Commit and push the isolated feature branch, open/update a **draft** PR into main, then STOP.

Required handoff:

- Actual base SHA and exact new head; branch and PR URL.
- Changed files and documentation impact.
- Implemented versus conditionally omitted work, with reasons.
- Query counts and bounded before/after timings for upload and meaningful replay; synthetic latency clearly labelled.
- PASS / FAIL / NOT RUN ledger, including the baseline typecheck exception if still present.
- Whether upload/replay completion was demonstrated locally, or which measured blocker remains.
- No claim of hosted repair, recovered gym journey, native capture repair or physical acceptance.
- Explicitly not performed: CI/Preview observation, Claude, staging promotion, hosted writes, migrations, Xcode build, installation, owner acceptance and merge.

### Implementation criteria

1. Valid maximum-size uploads use one evidence insert without changing saved fields, privacy, idempotency, acknowledgement or atomicity.
2. Safe failure phase/correlation survives from route to existing mobile diagnostics for both endpoints.
3. Queues/session/rollout/cutover/retention/automatic policy are unchanged; no new owner or native dependency exists.
4. Replay and upload are tested separately with real SQL and representative retained data; unknown-endpoint Review and terminal-decision protection pass.
5. Any evidenced lineage batching preserves exact protected lineage and transaction boundaries.
6. Outstanding replay/capture limits are explicit. Local performance is not presented as hosted proof.
7. Initial session ends at the pushed draft, even when later gates remain unavailable.

# LATER JOBS — NOT AUTHORISED FOR THE INITIAL CODEX SESSION

## 12. Independent review

OpenClaw uses **Claude Opus 5 / Low**, read-only in an isolated worktree, after the implementation handoff. Give it this exact plan from the PR branch and the exact base/head. Review the **complete PR diff**, relevant current docs and tests, not just Codex's summary.

Prioritise field/duplicate/ack equivalence, real SQL coverage, protected replay lineage, private diagnostic allowlists, auth/backend isolation, strict response compatibility, deadline/lock/cleanup preservation and the absence of a new queue. Check that benchmark claims distinguish synthetic and hosted results.

Classify evidenced findings as Blocker / Important / Nice-to-have; include file/line, consequence, evidence and recommended correction. Explicitly say APPROVE only when no substantive issue remains. List tests actually run and NOT RUN. Approval applies only to that exact head. No code edits, hosted operations, rebuilds, polling or merge.

If changes are required, batch substantiated related corrections into **one targeted Codex pass** with focused tests and one appropriate final validation, push and stop. Reviewer verifies that delta and its affected invariants at the new head; do not restart unrelated exploratory audits for cosmetic suggestions. Do not discard a genuine correctness failure to reduce churn.

## 13. Staging gate — OpenClaw, only when KB requests it

### 13.1 Establish exact runtime identity

Confirm the final reviewed head and required CI status once. Confirm the Vercel **deployment itself** is Ready and its source matches that head; a GitHub green status alone is insufficient. Verify staging Supabase, effective `v2_review`, required schema and authenticated session/owner/device. Record exact Preview/deployment IDs and server-reported source SHA/backend ID.

Use the existing authorised deployment path. If Preview is cancelled or CLI identity is not authorised, report that precise prerequisite; do not create a code commit, change Git authorship, upgrade a plan, expose the repo, or use production credentials to force deployment. No repeated redeploy/poll loop.

No migration is expected. If an explicitly approved migration became necessary, apply/validate it on staging before dependent code; production remains a separate approval.

### 13.2 Verify the real write paths with approved data

Login/bootstrap and an anonymous 401 are not enough. With KB's explicit staging-write approval, use a separate synthetic staging test owner/device to exercise a bounded evidence upload and replay, then prove the expected Review/event lineage. Do not seed fake journeys in KB's real account or rewrite their cutover to make a test pass.

Record safe HTTP status, endpoint, request ID, phase/timing, source/deployment and before/after counts. No coordinates or tokens in the report. A normal zero-output replay is not success for a fixture designed to produce Review; verify identity and reason.

If a 503 occurs, inspect the new correlated failure evidence and stop. Do not keep retrying or build the phone app before establishing the backend path. If the failure is outside this PR's proven fix, request the smallest evidenced revision.

Promote **that exact final Ready Preview** to `https://dayframe-staging.vercel.app` and verify the alias/source/backend afterwards, even if the latest changes were mobile-only. Do not leave a previous server SHA in place under an assumed-equivalence exception.

### 13.3 Build/install is a separate bounded task

Only after the exact-head gate succeeds, build the ordinary staging app **locally with Xcode**, verify its source, then install/update it on KB's authorised iPhone 17.

- Bundle: `com.layereight.dayframe.staging`.
- API: `https://dayframe-staging.vercel.app`.
- Existing isolated staging App Group/Keychain, URL scheme and extension identities.
- No Expo/EAS login, no EAS cloud build, no TestFlight and no production configuration.
- Update in place where practical; do not uninstall or reset the journal/Keychain to obtain a clean test.

Report signed source/configuration/version/build and installation result; STOP. Do not claim physical acceptance for KB.

## 14. Physical acceptance — KB

Keep the first pass small and focused. OpenClaw can collect safe counts when authorised; it must not infer success from no banner.

| Test | What KB does | Success / evidence |
| --- | --- | --- |
| Existing backlog | Open Settings → Sync & diagnostics; record pending Location count; press the existing Sync once | Uploads progress; replay shows success with current time; failures have useful request/stage details rather than unexplained 503 |
| Bounded follow-up | Allow normal foreground recovery; use one further deliberate Sync if the five-batch cap leaves work | Remaining work progresses without manually altering queues/identities; no endless agent polling |
| Existing journey | Open Review/Today after server processing | A sufficiently evidenced post-cutover journey appears once in Review. Do not expect automatic logging in `v2_review` |
| Confirm one suggestion | Review and confirm a suitable item | One canonical result, no duplicate/pending double count; existing Review outbox semantics preserved |
| Replay idempotency | Refresh/reopen once after success | No duplicate suggestions or resurrection of previously ignored/confirmed outcomes |
| Brief offline recovery | With existing data visible, go offline briefly, then reconnect normally | Captured data remains; existing icon owns connectivity; no new technical Today/Review banner; recovery uses existing owner |
| Basic regression | Start/stop a short test timer, open Today/Reports and Settings | No regression to merged #196 UI or timer/Health/Review ownership |
| Diagnostic readability | Enlarge text in the diagnostics section; inspect/share safe details | Readable without clipping; no token, raw response, route or coordinates in export |

For a **new** known-endpoint journey, open staging before departure, background normally, let the destination dwell/finalisation requirements elapse, then open/sync after arrival. Record approximate departure/arrival and observed result. Do not force-quit as the ordinary baseline test, change permissions or save places merely to mask the incident. A zero-saved-place Review test should remain valid when route/stay evidence genuinely qualifies.

### Missing return capture: separate, honest outcome

For the next real trip, authorised read-only diagnostics can compare native pending counts, callback/evidence kinds and timestamps, SQLite persistence and upload progression. Distinguish “no native signal”, “native queue not transferred”, “retained then expired” and “upload/replay failed”; absence of retained data alone cannot prove which occurred.

Do not claim this PR repairs capture because outbound upload succeeds. If capture is still missing, record **CAPTURE GAP — FOLLOW-UP REQUIRED**, with safe timing/count evidence. No native code change is authorised here; it needs a separate plan/approval. Likewise do not promise historical recovery for expired evidence.

## 15. Completion, rollback and next-stage rules

### Merge readiness

Require exact-head independent approval, required checks, reviewed final diff/status and the relevant exact-head staging/physical evidence. KB alone authorises merge. The merge must not be presented as complete Location reliability if only upload works or replay remains unproven.

A separate native capture limitation can remain tracked when server scope is demonstrably correct; an unresolved replay correctness/budget failure within this PR cannot be relabelled as a cosmetic follow-up. Obtain an explicit narrower acceptance decision if needed.

### Rollback

No runtime toggle/timeout change is part of this plan. If the new Preview is faulty, stop processing tests and, only with KB's approval, restore a previously verified staging deployment. The previous deployment may retain the known 503 defect; describe that limitation honestly. Preserve queued evidence and immutable IDs; do not delete records or reset activation/retention as rollback. Database transactions already protect partial writes.

Because diagnostic changes are additive and a migration is not expected, an older app/server should tolerate absent safe diagnostic fields. Prove this compatibility. Any actual migration needs its own documented additive rollback strategy before use.

### After merge

Do a small tracker/roadmap reconciliation with the actual merge SHA and actual acceptance evidence. Do not invalidate exact-head approval before merge solely to alter status wording. Then plan the next approved task from fresh main. Entry-sheet accessibility and any demonstrated native capture repair remain separately scoped; do not start them automatically.

## 16. Reference register

### Source inspected at the planning baseline

For each repository path below, use the pinned main SHA `a83bfc976f03b14ffc48712681707ecdc27b2601`; reverify when implementation begins. Suggested canonical URL pattern: `https://github.com/kwabiwe/dayframe/blob/a83bfc976f03b14ffc48712681707ecdc27b2601/<path>`.

- **R1:** GitHub PR #196 metadata and main branch: merged from `139fa024…` at `a83bfc9…`. `https://github.com/kwabiwe/dayframe/pull/196`
- **R2:** `AGENTS.md`; `docs/architecture.md`; `docs/documentation-governance.md`.
- **R3:** `apps/web/src/lib/location/location-ingest-service.ts`, especially batch validation, `ingestLocationEvidence`, per-evidence mapping, `replayRetainedLocationEvidence` and emission gate.
- **R4:** `apps/web/src/lib/sync-transaction.ts`: budgets, checked-out client, per-query configuration and `syncFailureMetadata`.
- **R5:** `apps/web/src/app/api/location/evidence/route.ts`; `apps/web/src/app/api/location/replay/route.ts`. Their unchanged route contracts were inspected during the incident investigation; recheck current full files before editing.
- **R6:** `apps/web/src/lib/location/location-replay-service.ts`, especially `replayLocationEvidence`, protected segment handling and `replaceEvidenceLinks`.
- **R7:** `apps/mobile/src/lib/location/network.ts`; `apps/mobile/src/lib/location/store.ts`, especially `uploadLocationEvidenceBatch`, `requestServerLocationReplay`, owned diagnostic metadata and success clearing.
- **R8:** `packages/shared/src/location/schemas.ts`: request validation and strict replay success schema.
- **R9:** `.codex/reference/location-learning.md`: capture/upload/replay separation, retention, rollout/cutover and automatic policy.
- **R10:** `docs/feature-fix-tracker.md`; `docs/roadmaps/review-ux-roadmap.md`: stale Stage B status requiring small reconciliation.
- **R11:** `package.json`; `scripts/validate-location-v2-db.ts`; `.codex/reference/validation-matrix.md`: commands, synthetic fixture patterns and guarded local validation.

### External primary references, checked during preparation

- **T1:** PostgreSQL 17, INSERT: supports multi-row insert; `ON CONFLICT DO NOTHING` and `RETURNING` semantics. `https://www.postgresql.org/docs/17/sql-insert.html`
- **T2:** node-postgres, Transactions: all statements in one transaction use the same checked-out client, not `pool.query`. `https://node-postgres.com/features/transactions`

External references support SQL/client mechanics only. The incident facts above are owner-supplied evidence; the implementation constraints are Dayframe's source contracts and this authorised plan. No new hosted database, device or performance experiment was run to prepare this document.
