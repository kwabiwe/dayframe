# Location capture ownership safety — 30 September 2026

Status: focused draft implementation on `codex/location-capture-ownership`. No release or physical acceptance is claimed. Paused PR #212 is separate and untouched.

The initial-head implementation/checks below are historical. The subsequent correction of Claude’s I-1–I-4 findings on existing PR #213 is recorded in [review fixes](2026-09-30-location-capture-ownership-review-fixes.md), including actual material filenames, real API/SQLite probes, distinct capture/semantic cutovers and the retained upload/context expiry gap. The later R-1–R-3 follow-up from `046d840` is recorded in [residual lifecycle corrections](2026-09-30-location-capture-ownership-residual-lifecycle.md); each note preserves its historical checks.

## Actual materials read

The following actual private files were read. The reproduction filename came from the first-fix plan. Their content and private audit data have not been copied into Git; this note records a sanitised implementation contract and synthetic results.

| Actual source path | Lines | SHA-256 |
| --- | --- | --- |
| `/Users/major/Library/Application Support/dayframe-location-quality/architecture-audit-2026-09-29-claude/FIRST-FIX-PLAN-location-capture-ownership.md` | 184 | `e843169d1432b4132be35ec1cb114aac022285cbf0c782f724212aa5da7f2077` |
| `/Users/major/Library/Application Support/dayframe-location-quality/architecture-audit-2026-09-29-claude/probes/ownership.repro.test.ts` | 181 | `512827f78722749da9bc143214f81a5629bbe79f73a8c5adebd4b79bc00f5922` |
| `/Users/major/.codex/attachments/e753719d-084e-4262-a0c9-9b7f2c02e447/dayframe-location-capture-ownership-implementation.md` | 159 | `b054222e36860ea439d14d591c06b35b57b5287a99d5106fb017e347f399483d` |

Repository authorities reviewed (applicable sections): `AGENTS.md`, `docs/PRD.md`, `docs/architecture.md`, `docs/feature-fix-tracker.md`, `docs/documentation-governance.md`, `docs/vercel-supabase-hosting.md`, `docs/brand-style-guide.md`, `docs/dayframe-regression-checklist.md`, `.codex/reference/location-learning.md`, `.codex/reference/mobile-permissions.md`, `.codex/reference/database.md`, `.codex/reference/components.md`, `.codex/reference/style.md`, `.codex/reference/motion.md`, `.codex/reference/validation-matrix.md`, and `.codex/reference/release-and-testflight.md`. The release reference's historical build snapshot does not override the tracker or this job's build prohibition.

Source/test trace reviewed: `mobileAccount.ts`, `mobileSessionTransition.ts`, relevant `secure-session.ts` and `api.ts` lifecycle paths; `location/store.ts`, `location/runtime.ts`, `location/syncOwnership.ts`, `geofence.ts`, `backendIdentity.ts`; Settings and Dashboard Location wiring; existing runtime, SQLite, geofence, API and session-invalidation tests; `scripts/validate-location-v2-sqlite.sh` and workspace package scripts. All paths above are in `apps/mobile/src/lib` unless qualified. Follow-up catalogue call sites in `apps/mobile/app/places.tsx` and `place-editor.tsx` were inspected and fenced with their bootstrap owner.

## Baseline and reproduction

Fresh `git fetch origin main` verified `f42543eae397074a02e586140d3d748882da7ff1`, matching the requested baseline. The primary checkout stayed clean on its original local main; the new managed worktree was branched directly from fresh `origin/main`.

The saved real-code probe was run before implementation and repeated from a scratch `git archive` of that exact baseline. All six original assertions passed: S1/S2/S3/S4/S6 demonstrated the unsafe mechanisms and S5 passed as the offline control. Both runs used synthetic A/B accounts and offline network mocks. The scratch tree was deleted. This is reproduction of software behaviour, not evidence of a production disclosure.

Node `v24.21.0`, Vitest `4.1.9`, real in-memory `node:sqlite` transactions and the existing Expo/native mock harness were used. Dependencies were reused through symlink views; `@dayframe` workspace links point at this fresh-main worktree. No dependency installation is claimed. Local logs are outside Git under `/Users/major/Library/Application Support/dayframe-location-quality/capture-ownership-2026-09-30-codex/`.

## Implemented contract and scope

- Existing `mobileAccount`/secure-session signals remain authoritative. A persisted Location binding projects backend, owner, generation, cutoff and consent. A synchronous admission fence rejects both old and newly arriving callbacks while teardown is queued; the existing SQLite mutation queue revalidates inside the exclusive transaction and rolls back an interleaved switch.
- No new unbound writes or reassignment exist. Database initialization deletes legacy unbound rows and associated unbound state/outboxes idempotently and counts the deletion. SQLite schema version stays 1; metadata and AsyncStorage state migration are still required.
- Pre-binding standard observations and Visit arrivals, including straddling Visits, are discarded without invented times, clipping or replacement Visits. Invalid native/Expo timestamps are not converted to receipt time. Accepted native IDs clear after the acceptance/discard decision commits. Region registrations carry their generation because Expo supplies no occurrence timestamp; an old registration cannot become a new lifetime's event.
- Explicit logout deletes the signing-out owner's local Location journal/outbox/derived context and warns about unsynchronised evidence loss. Involuntary invalidation/replacement ends capture while preserving accepted rows under the original owner. Journal expiry is seven days; raw frozen upload bodies (including acknowledged bodies) and retained engine/account/segment context do not share that expiry. Login/upload do not purge those copies. Explicit logout removes all five owner-local stores; Delete recent evidence removes journal/outbox/engine state but retains account/segment context. The bounded-expiry/deletion gap is separate tracker work. Admission cutoffs do not retroactively invalidate owned upload work. Another owner cannot read/upload/relabel it. Existing already-owned rows on upgrade are retained, without claiming their older attribution can be reconstructed or repairing previously uploaded data.
- Consent and exposed places/diagnostics are keyed by backend/workspace/user. Legacy device-wide consent migrates only with a demonstrable matching binding, otherwise it is discarded. A matching legacy owner can hydrate that migration and restart capture from the first headless callback without Keychain; its new cutoff rejects delayed pre-upgrade observations. New accounts default off regardless of OS permission. Opt-out invalidates the lifetime; re-enable creates a new cutoff. Ordinary same-owner bootstrap, token refresh and cold/headless restart keep a valid enabled generation. Diagnostics pin one snapshot through cache read and write, so a delayed A result cannot overwrite B's cache.
- OS start/stop/native-clear/drain operations share the runtime lifecycle lane; callbacks and SQLite remain on their existing owners. A late captured teardown, screen catalogue refresh or consent request cannot modify B. Logout additionally guards its existing session snapshot through awaited cleanup so old A logout completion cannot clear B or a later A session. Authority interfaces and unrelated timer/Review/Health policies remain unchanged. V1 compatibility events also pin their callback owner; no classifier policy changes were made.
- No Swift/Pods, API contract, DDL/Supabase, server batch, segmentation, boundary/stop threshold, radius, Core Motion/Health collection, rollout, staging, production or TestFlight change. The suspected foreign/deleted-place server batch failure remains unconfirmed and deferred to its own disposable-DB investigation.

The historical `2026-07-20-location-intelligence-v2.md` fail-closed account-switch claim was incomplete: native purge and SQLite owner changes did not cover Expo tasks, unbound reassignment or headless sign-out. Its historical evidence is preserved. The conflicting blanket account-switch deletion text in the current Location reference is replaced with the explicit-logout versus involuntary invalidation contract chosen by the owner.

Documentation impact: runtime ownership/auth/storage and mobile privacy/permission behaviour; update architecture, Location/permission references, product privacy, regression matrix and tracker in this PR. No hosting/schema/release configuration change is needed.

## Logout warning motion contract

Trigger: Settings Log out. Owner: the existing iOS `Alert` presentation. Entrance/update/exit use its established native alert; only warning copy/availability changes. The underlying Settings layout stays fixed. Cancel dismisses without mutation. Confirm uses the existing guarded `completeSignOut`, navigation and failure alert; repeated completion is ignored by its existing ref. No Undo or optimistic data deletion is added. Reduce Motion, VoiceOver and focus remain native Alert responsibilities. Manual alert/accessibility/phone-width acceptance is NOT RUN because this job prohibits builds and device work.

## Validation evidence

One broad validation pass ran lint, workspace typechecks/tests, docs, SQLite validation and the diff check. Its mobile run failed three source-text assertions in `replaySync.contract.test.ts` that still named the old calls. Those assertions were updated for the fenced native-drain/catalogue calls and whitespace; the full affected mobile suite then passed after the final cache-race fix. The broad web/shared results remain valid because their source did not change. `npm run test` itself was not repeated or relabelled as a passing command.

Focused runtime/SQLite/geofence/API/session checks passed 180 tests across 8 actual files before the final diagnostics race was added. The final mobile suite includes all 26 synthetic S1–S6/race/upgrade protections and unchanged upload, timer, Review and Health lifecycle tests. The SQLite validator passed WAL, schema idempotency, duplicate import, partial retry, isolation, retention, rollback, restart and contention. Existing retention code is unchanged: the seven-day cleanup expires journal rows; this PR does not establish a new frozen-outbox expiry guarantee.

The existing `expo-symbols` limitation remains: `ConnectivityStatusStrip.tsx` imports it without a direct mobile dependency. This reused installation resolves the package transitively and mobile typecheck passes. Clean-install resolution and native bundling remain unverified; no dependency repair or clean-install claim is included.

| Gate | Result |
| --- | --- |
| Exact-base saved S1–S6 reproduction | PASS — 6/6 synthetic original assertions |
| S1 explicit logout and signed-out Expo/native observations | PASS — synthetic SQLite/task protection |
| S2 headless authoritative sign-out; retain/resume only A's accepted work | PASS — synthetic lifecycle and upload-owner preparation; no native revocation |
| S3 delayed/mixed samples and completed/straddling Visits | PASS — source times preserved; rejected native IDs cleared |
| S4 stale regions and foreign catalogue IDs | PASS — synthetic generation/catalogue gate |
| S5 offline/locked-Keychain and cold/headless same-owner control | PASS — mocked OS/network; real persisted mobile owner and SQLite |
| S6 scoped consent, cache isolation and legacy upgrade | PASS — synthetic A/B and idempotent cleanup |
| `npm run test -w @dayframe/mobile` final follow-up | PASS — 141 files, 1,268 tests, including 26 ownership protections |
| Broad `npm run test` | Initial FAIL — 3 mobile source-contract assertions, subsequently corrected; web 139 files / 970 tests PASS, shared 24 files / 367 tests PASS; 2 web files / 3 tests skipped |
| `npm run typecheck`, final mobile typecheck | PASS — all three workspaces; affected mobile repeated after final source changes |
| `npm run lint` | PASS — 2 existing web unused-parameter warnings; docs and iOS configuration checks also passed |
| `npm run validate:location-v2-sqlite` | PASS — real SQLite validator |
| `npm run check:docs`, `git diff --check` | PASS — 151 Markdown files; diff check clean |
| Simulator/native/Swift/Pods/web builds | NOT RUN — explicit job scope |
| Physical signed-staging acceptance, native Alert/Reduce Motion/VoiceOver checks | NOT RUN — later separately authorised device job |
| Disposable PostGIS/server batch confirmation | NOT RUN — speculative server fix is separate |
| Reviewer invocation, CI/Vercel polling, hosted replay, aliases/migrations, rollout, production, TestFlight, merge | NOT RUN — explicit job scope |

Physical follow-up must use two synthetic staging accounts and verified signed identities: logout loss warning, stopped OS monitoring, signed-out interval, B consent/cache isolation, 401 retention/resume only for A, delayed callbacks, opt-out, offline A, and cold/headless restart. Record counts/timestamps and PASS/FAIL/NOT RUN without exact location data. Nothing here establishes the paused pickup/automatic-stop defect is fixed.
