# Location Reliability V1 implementation evidence

## Scope and identity

Planning and actual fresh-main base: `a83bfc976f03b14ffc48712681707ecdc27b2601`.
Fetched 14 September 2026; no intervening changes. Isolated branch:
`codex/location-reliability`. Final head is the commit containing this report;
the draft PR/handoff records its exact SHA without a self-referential commit hash.
The supplied [plan](../plans/location-reliability-v1.md) preserves all content;
its original Markdown double-space hard breaks use equivalent backslash syntax
to satisfy the staged whitespace check.
Sections 0–11 govern this implementation; later jobs are not authorised here.

Documentation impact: Location reliability, safe diagnostics/API observation and
validation. Canonical architecture/API/Location references and regression checks
are updated. Product rules in PRD are unchanged. No migration, native module,
queue, retry coordinator, rollout/cutover/retention/permission/threshold/timeout,
Health, timer or Review mutation change. Section 0 overrides older release/native
validation guidance for this session. No Claude/delegated review was invoked.

## Incident evidence and limits

Owner-supplied evidence described 860 retained observations (605 standard, 102
significant-change, 93 Visit and 60 provider-status), 555 acknowledged observations
and seven pending batches containing 305 observations. Local engine snapshots had
48 commute and 68 stay records; these are not canonical/user-visible journey counts.
There were no saved or accepted learned places. The historical phone and server
had different source revisions. Historical 503 bodies, request durations and DB
phases were unavailable. These are supplied historical observations, not new hosted
inspection or proof of a root cause.

Two plausible server causes were excessive round trips consuming the deadline,
and acquisition/lock/statement contention. Synthetic experiments distinguish those
mechanisms, but do not establish which caused the owner's incident. Missing retained
observations between approximately 05:40 and the approximately 06:35 return departure
remain **CAPTURE GAP — FOLLOW-UP REQUIRED**. No native signal/transfer/expiry cause
was established; upload optimisation cannot recover or invent that return journey.

## Implementation

- Routes generate independent UUID v4 correlation headers and safe server duration;
  one completion log per request distinguishes auth from processing failure.
  Closed parsers discard unknown keys/values and preserve actual transaction phase.
  Acquisition/lock/commit failures cannot inherit a misleading service substage.
  Successful replay JSON remains strict-compatible. Observation errors are contained.
- Existing mobile request/SQLite owners retain one backend/account-bound result per
  endpoint plus last success, with separate server and client elapsed time. Auth,
  cancellation and stale-session guards precede persistence; reads/share recheck
  ownership. Logout/replacement invalidates these records. Optional diagnostic
  failure cannot rollback an acknowledgement, alter backoff or poison the serial queue.
- Upload uses one parameterised VALUES insert for up to 100 observations after
  the existing summary/lock/cleanup sequence, retaining the original field mapping,
  classification, first duplicate, all acknowledged IDs and expiry on conflict.
- Replay lineage uses four bounded chunks for this 840-link fixture instead of
  840 individual inserts. Deletion and every chunk share the existing transaction.
  Exact protected/manual/terminal links and rollback on the second chunk are tested.

## Disposable setup and finite measurements

Fresh isolated PostgreSQL **17.11**, PostGIS **3.6**, six ordered local migrations,
loopback port 55437, unique synthetic owners; no hosted URL or credentials loaded.
`npm ci --ignore-scripts --no-audit --no-fund` succeeded without lockfile changes.
The new runner initially needed its top-level await changed to the repository's
CJS-compatible main function; setup did not require a second database version or
native build. Its owned cluster is stopped at handoff. The runner removes its synthetic owners;
the temporary cluster directory remains local because automatic approval review
rejected recursive directory removal.

One instrumented before run used the unchanged insert algorithms, after request-local
stage markers were added. Focused after correctness used normal local transport;
the final after run includes one normal and one each 20/40 ms profile. No p95 claims.
All timings below are service transactions through the real shared helper; full
route/auth/session timing is NOT RUN. Artificial delay is before each actual driver
query in the test-only injected pool and is not shipped in transaction code. Successful
query counts include BEGIN/configuration, per-query guards and COMMIT. Substage totals
attribute transaction startup to the initial stage and COMMIT to the last service stage;
route failure metadata separately preserves the helper's actual phase.

| Workload | Before ms / driver calls | Focused after ms / driver calls |
| --- | --- | --- |
| Upload 1 | 20 / 13 | 18 / 13 |
| Upload 25 | 11 / 61 | 6 / 13 |
| Upload 100 | 23 / 211 | 9 / 13 |
| Upload 100 + 20 ms artificial delay | 4,800 / 211 | 290 / 13 (final) |
| Upload 100 + 40 ms artificial delay | FAIL at 7,008 ms, evidence write | 565 / 13 (final) |
| Replay 860, meaningful retained history | 336 / 2,541 | 192 / 869 |
| Replay + 20 ms artificial delay | FAIL at 7,003 ms, segment persistence | FAIL at 7,002 ms / 307 calls (final) |
| Replay + 40 ms artificial delay | FAIL at 7,003 ms, segment persistence | FAIL at 7,003 ms / 162 calls (final) |

The before stress failure counters included an attempted delayed query that could
be cancelled before reaching the driver; they are deliberately not reported as actual
query counts. The final runner counts only calls actually sent to the driver.

Seven days of synthetic London-relative observations produce **56 stays, 28 commutes,
28 Review items, zero entries and 840 links**, with no saved places. This is a synthetic
workload, not a reconstruction of the private 48/68 engine snapshot. Exact ordered
lineage hash before and after:
`2cac2993956118d7cd548ca2abc765fecad04eca289a13e26e8b69d84bf4c899`.
The fixture explicitly fixes the clock and cutover. A one-way 30-observation subset
produces one outbound Review commute and no invented return.

Lineage consumed 1,682 guarded driver calls (165 ms local) before, versus 10 calls
(42 ms in the focused after run). This directly supports the plan's conditional
batching. The remaining normal profile includes **342 segment-persistence** and
**505 semantics/commit** calls. Under artificial latency, segment persistence hits
the existing budget before lineage. Further segment/semantic batching, partial replay,
cursors or timeout changes are outside scope. **Replay budget decision required**;
normal loopback completion is not hosted repair or robust network-latency proof.

## Focused validation ledger

| Command / scope | Outcome | Elapsed | Last relevant edit |
| --- | --- | --- | --- |
| Evidence route regression before implementation | Expected FAIL: no request ID | 2.16 s | Before diagnostics |
| Route tests after diagnostics | PASS, 14 tests | <1 s | Current route implementation |
| Shared allowlist parser | PASS, 8 tests | 0.11 s | Before last-success/auth enums; final suite covers them |
| Mobile Location network + real SQLite | PASS, 15 tests | <1 s | Before last-success field; final suite covers it |
| Reliability correctness-only PostGIS | PASS | <3 s | Before additional owner/device/invalid-body assertions; final runner covers them |

Focused PostGIS checks include exact mapped values/zero metrics/rejected-coordinate
nulling, within/across-request duplicates, immutable retry expiry, coordinate-free
summaries, FK/bulk/commit/cancellation rollback, second-lineage-chunk rollback,
manual/terminal lineage, meaningful unknown-endpoint Review, absent return, and
upload-versus-replay contention. Held-owner replay failed with SQLSTATE 55P03 in
1,509 ms at `owner_lock`; another owner uploaded concurrently. The test releases
the lock and makes one later explicit replay attempt. Real SQLite additionally proves
seven batches progress in maximum-five passes and preserve their request bodies/IDs.

## Settings motion and accessibility contract

The existing Privacy & troubleshooting disclosure owns entrance/exit and surrounding
layout via its existing local Reanimated presence/layout helpers. The new text has
no independent animation, navigation, spinner, banner or floating surface. A sync
result updates in that established region; rapid disclosure toggles and navigation
retain the current owner. Failure/success replaces endpoint text only; there is no
optimistic mutation or Undo to roll back. Reduce Motion retains the existing no-travel
path. Body text is uncapped, multiline and selectable, including the UUID, within the
existing scroll area; no line-count truncation or fixed height is introduced.

Large Dynamic Type, VoiceOver, normal/Reduce Motion transitions and signed-app
presentation are **NOT RUN BY CODEX**. No native build/install is authorised. The
later acceptance uses an ordinary locally signed Xcode staging app, without Expo/EAS.

## Final validation ledger

One final broad pass ran with an explicit disposable local DATABASE_URL and dev
auth, without loading hosted configuration. Lint includes docs/config checks.

| Command | Outcome | Elapsed | Evidence / scope |
| --- | --- | --- | --- |
| `npm run lint` | PASS | 9.20 s | Two existing unused-variable warnings in event-service tests; no errors. |
| `npm run typecheck` | FAIL | 10.30 s | FAIL: only baseline TS2307 expo-symbols in ConnectivityStatusStrip.tsx:27. Web/shared PASS. |
| `npm run test` | PASS | 15.38 s | 2,409 passed; 3 existing skipped tests. |
| `npm run build` | PASS | 14.24 s | Web production build PASS. |
| `git diff --check` | PASS | 0.04 s | Tracked diff PASS; staged check found original plan hard-break whitespace, normalised before final staged PASS. |
| `npm run validate:location-v2-db` | PASS | 1.50 s | Real ordered PostGIS correctness/Review/terminal/cutover regressions PASS. |
| `npm run validate:location-v2-sqlite` | PASS | 1.26 s | Existing SQLite validator PASS. |
| `npm run validate:sync-transactions` | PASS | 4.22 s | Real statement/lock/idle guards, cancellation/lock release and cumulative deadline PASS. |
| `npm run validate:location-reliability` | FAIL | 17.90 s | Correctness PASS; overall FAIL for 20/40 ms synthetic replay budget at segment persistence. No redesign/retry loop. |
CI, Preview, hosted smoke, signed build and physical tests are **NOT RUN BY CODEX**.
No CI/Vercel polling, staging promotion, hosted writes/migrations, production access,
real-user replay, Claude invocation, Xcode build, installation, owner acceptance or
merge is performed. STOP at the pushed draft.

Final normal after values: upload 1/25/100 = **8/5/9 ms**, all **13 calls**;
replay = **203 ms / 869 calls**, same 56/28/28/0 outputs and exact lineage hash.
Final lineage stage: **47 ms / 10 calls**. The synthetic 20 ms replay failure spends
6,655 ms / 295 calls in segment persistence; 40 ms spends 6,426 ms / 150 calls
there. This is the first still-failing stage. Neither failure reaches lineage or
semantic emission, and both preserve all prior links transactionally.

A final diff review added only malformed-metadata containment and a Settings
post-native-await session check, plus last-success/account-replacement regressions.
Affected mobile Location network/SQLite/replay-contract tests then passed **25/25**
in 0.59 s. Mobile typecheck was rerun for these edits and still reports only the
same baseline expo-symbols error. Web/build/DB evidence remains applicable; the
broad pass was not restarted. The final documentation update is separately checked
with `npm run check:docs` and `git diff --check` before commit.

Simulated acquisition exhaustion is covered by existing helper unit tests; it was
not separately induced on the real pool in this session. Full route/auth timing,
Settings rendering/large-text/VoiceOver/motion, hosted schema and synthetic hosted
write smoke remain NOT RUN. There is no claim that those gates passed. Local ordered
schema application was disposable setup, not a hosted migration.

## Changed files

- `.codex/reference/api.md`
- `.codex/reference/location-learning.md`
- `.codex/reference/validation-matrix.md`
- `apps/mobile/app/settings.tsx`
- `apps/mobile/src/lib/location/network.test.ts`
- `apps/mobile/src/lib/location/network.ts`
- `apps/mobile/src/lib/location/store.sqlite.test.ts`
- `apps/mobile/src/lib/location/store.ts`
- `apps/web/src/app/api/location/evidence/route.test.ts`
- `apps/web/src/app/api/location/evidence/route.ts`
- `apps/web/src/app/api/location/replay/route.test.ts`
- `apps/web/src/app/api/location/replay/route.ts`
- `apps/web/src/lib/location/location-ingest-service.ts`
- `apps/web/src/lib/location/location-replay-service.ts`
- `apps/web/src/lib/location/location-sync-diagnostics.test.ts`
- `apps/web/src/lib/location/location-sync-diagnostics.ts`
- `docs/architecture.md`
- `docs/dayframe-regression-checklist.md`
- `docs/feature-fix-tracker.md`
- `docs/investigations/2026-09-14-location-reliability.md`
- `docs/plans/location-reliability-v1.md`
- `docs/roadmaps/review-ux-roadmap.md`
- `package.json`
- `packages/shared/src/index.ts`
- `packages/shared/src/location/syncDiagnostics.test.ts`
- `packages/shared/src/location/syncDiagnostics.ts`
- `scripts/fixtures/location-reliability-correctness.ts`
- `scripts/fixtures/location-reliability.ts`
- `scripts/validate-location-reliability.ts`
