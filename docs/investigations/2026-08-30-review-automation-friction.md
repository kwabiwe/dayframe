# Review automation and durable corrections

Status: implementation complete on the feature branch; acceptance blocked. No merge, staging promotion or device acceptance claimed.

Baseline: `df59588a68391dec7693b266e71255350ce7cd15` (`origin/main`, fetched 2026-08-30).
Branch: `codex/pr186-review-automation-friction` in an isolated worktree; original checkout preserved.

## Contract and boundaries

Owner contract: `dayframe_pr186_review_automation_and_friction_plan.md`, prepared 2026-08-30. Normal automatic confidence is medium-high/high; each Location boundary and each thresholded overlap allows five minutes inclusive. Health overlaps may coexist, while sample/session duplicate protections remain. Medium commutes require the explicitly approved distinct saved-route exception. Existing Location Review remains user-owned.

Shared owns pure policy and strict schemas; server owns canonical eligibility, event-first transactions and idempotent receipts; Review SQLite owns account-bound intent and source-item effects; React owns presentation. PR #184 retains recovery ownership. PR #185 timer background assertions do not admit Review work. No major Review redesign or unmeasured list rewrite.

Existing Postgres boundary, max-gap and receipt columns cover the planned work. SQLite requires an additive transactional v4→v5 effects table and non-destructive backfill. No Postgres migration is currently required.

## Investigation

- Automatic logging: blanket continuity/overlap guards discard measurable boundary and activity context. Test exact threshold edges and canonical provenance rather than changing detected times.
- Back delay hypothesis A: repeated peer/interval preparation scales with backlog. Measure synthetic 2/13/25/50 profiles.
- Back delay hypothesis B: evidence prefetch/Health reprocess and stale callbacks compete with navigation. Measure cancellation and transition timing separately; do not infer device timing from desktop computation.
- Complex actions currently bypass the outbox. Merges require two source snapshots, atomic ownership, selective conflict restore and receipt replay of structural effects.

## Motion contract

- Local save trigger: committed SQLite intent only. Existing native stack owns detail pop; existing Review presence/layout primitives own source-card removal and restoration. Both merge sources share one durable action. No network await owns dismissal.
- Status trigger: message present/cleared/replaced. Existing local Reanimated presence/layout primitives own restrained opacity and reflow below the first summary. Header geometry stays fixed; no empty reserved band.
- POI trigger: one current nearby/search request publishes transient results. Existing local presence owner handles list entry/replacement/exit; native stack remains the navigation owner.
- Interruption: duplicate taps are gated; route/account generations invalidate stale callbacks, cancellation reaches prefetch, and a newer message/request supersedes older work.
- Async: SQLite failure retains all cards and the exact draft; retry/auth keeps committed effects hidden; permanent conflict restores only canonically open sources at surviving anchors. Structural children appear from canonical refresh, never fabricated locally.
- Reduce Motion: remove travel/reflow animation or use restrained opacity. Preserve semantic updates, 44-point targets, VoiceOver announcements without focus stealing, Dynamic Type and existing Reduce Transparency treatment.

## Implementation and root causes

1. Location used blanket continuity/overlap gates instead of independent measurable boundaries and activity provenance. The shared pure policy now implements the fixed thresholds and route exception; the server verifies catalog identity, rollout/cutover and terminal state before transactional materialisation. Actual maximum observation gap replaces total commute duration in the existing metric column.
2. Health treated ordinary activity overlap as a reason for Review. Eligible imports/reprocess now coexist, while per-user locking precedes logical Sleep matching and unsafe/edited/cross-source/multiple Sleep collisions remain conservative.
3. Structural corrections used direct requests, so dismissal could not be durable. Strict shared actions now pass through the existing receipt transaction and account-owned SQLite outbox, including both merge sources.
4. An always-reserved status band created the visual gap. Status is conditional beneath the summary. Repeated peer/interval construction scaled with backlog; prepared overlap counts and immediate navigation cancellation remove that repeated work. The larger Review redesign and list replacement are absent.

No product-rule deviation. Local synthetic bundles are implemented; staging fixture ingestion and all signed-device measurements remain outstanding. These limitations do not waive acceptance criteria.

## Final automatic-logging decision table

All Location rows require finalised segments, `v2_enabled`, acknowledged rollout/cutover, no pre-existing Review/terminal decision, and valid independently bounded start/stop estimates with each width ≤300000 ms. Detected times are never adjusted to pass a guard.

| Candidate | Eligibility in addition to common guards |
| --- | --- |
| Health | `medium_high`/`high`, enabled supported type, valid complete window, existing duration/plausibility rules and sample/logical-session safeguards |
| Saved/accepted-linked stay | `medium_high`/`high`, server-verified logging-enabled saved place or accepted learned linkage, supported continuity including bounded `uncertain_gap` |
| Standard commute | `medium_high`/`high`, two verified saved endpoints, ≥2 accepted route samples, significant endpoint displacement or meaningful same-place round trip, actual maximum internal gap ≤12 min |
| Medium commute exception | `medium`, distinct verified saved endpoints, ≥3 accepted samples, significant displacement or significant route distance, same gap/boundary/overlap guards |
| Unknown/unlinked/weak/invalid/disabled | Review; no automatic entry |

Overlapping saved radii retain the existing hint/continuity/distance/priority ranking with deterministic ID ordering and at most four alternatives. No radius expansion or provider lookup enters replay.

## Final overlap matrix

Each threshold is the largest **single** intersection, inclusive at five minutes. Touching is zero; running intervals stop at the candidate's finite end. Source identity exclusion remains independent. Blocker ordering is largest overlap, earliest start, then ID.

| Automatic candidate ↓ / existing confirmed or accepted entry → | Manual/other | Health | Same saved-place Location stay | Different/unknown Location stay | Commute |
| --- | --- | --- | --- | --- | --- |
| Health | Allowed | Allowed, subject to Sleep/sample safeguards | Allowed | Allowed | Allowed |
| Trusted stay | Allowed | Allowed | Allowed, subject to source idempotency | ≤5 min | ≤5 min |
| Commute (both tiers) | ≤5 min | ≤5 min | ≤5 min | ≤5 min | ≤5 min |

Explicit Review confirmation still allows intentional overlap. Calendar/Reports retain Logged = full duration sum and Covered = clipped union.

## Persistence and concurrency

SQLite `dayframe-review-sync.db` advances transactionally from v4 to v5. It adds the outbox owner unique index and `review_mutation_effects` with a composite account-owned outbox foreign key, one reserved source per account, snapshot, original position, preceding/following anchors and hidden/restore effect. Existing single-source rows backfill without changing request bytes or mutation UUIDs. All older columns remain.

Merge commits one intent plus two effects atomically; cached/open/unowned validation precedes writes. Disk failure retains both cards and the draft. Acknowledged effects remain until both IDs disappear from canonical open Review. Permanent rejection restores only proven-open sources. Discard cannot resurrect an unproven/closed source. Logout/account replacement clears the account's sensitive intent/evidence. Pending intent is not subject to the transient evidence cache's TTL/LRU.

The existing Postgres receipt columns and `commute_segments.max_gap_seconds` suffice: **no Postgres migration added or required by this diff**. Hosted availability of all pre-existing migrations still needs verification. Same UUID binds account, primary source, action and canonical request hash to the complete result. Structural effects and receipt share one transaction; the shared Location advisory owner serialises replay/direct structural work. Unprovable different-UUID equivalence conflicts. Statement/lock deadlines remain bounded. Review remains foreground-owned; no PR #185 timer assertion is acquired.

Main risks to validate on a database/device: concurrent replay versus split/merge, lost-response receipt replay, conflict restore after another device resolves one merge source, session rotation during dispatch, and cache/list callbacks during an interrupted native pop. New real-SQLite coverage verifies pre-dispatch session invalidation sends nothing and returns intent to pending.

## Validation commands and results

Run from the isolated worktree. Code tested at `16619d91707d3fef4e22fd7cf9165fd405076ac4`; subsequent changes in this report/canonical docs do not alter application code. Baseline remains `df59588a68391dec7693b266e71255350ce7cd15`.

| Exact command | Result |
| --- | --- |
| `npm ci` | PASS; frozen dependencies installed; existing audit findings not upgraded in this PR |
| `npm run lint` | PASS; two existing unused `_values` warnings in the web event-service tests |
| `npm run typecheck` | PASS, all workspaces |
| `npm run test` | PASS: mobile 925, web 858, shared 220; one opt-in Postgres test skipped by default |
| `npm run build` | PASS, Next production build |
| `npm run check:docs` | PASS, 120 Markdown files |
| `npm run check:brand-assets` | PASS |
| `git diff --check` | PASS |
| `npm run typecheck -w @dayframe/mobile` | PASS |
| `npm run test -w @dayframe/shared -- test/automatic-policy.test.ts` | PASS, 55 tests |
| `npm run test -w @dayframe/web -- src/lib/event-service.test.ts src/lib/review-mutation-service.test.ts src/lib/location/location-semantic-policy.test.ts src/lib/location/location-review-service.test.ts` | PASS, 124 tests |
| `npm run test -w @dayframe/mobile -- src/lib/reviewSyncStore.sqlite.test.ts src/lib/reviewSyncStore.test.ts src/lib/locationReviewDraft.test.ts src/lib/reviewPresentation.test.ts src/lib/placeSearch.test.ts` | PASS, 45 tests before the final two additional cases; final complete suite includes both |
| `npm run test -w @dayframe/mobile -- src/lib/reviewSyncStore.sqlite.test.ts src/lib/reviewPresentation.test.ts` | PASS, final 15 tests |
| `npm run validate:review-sync-sqlite` | PASS, original SQLite validator plus nine actual-store v5 SQLite transaction tests |
| `npm run validate:location-v2-sqlite` | PASS, WAL/schema/retry/isolation/retention/rollback/restart/contention |
| `swift test --package-path apps/mobile/modules/dayframe-background-execution` | PASS, four native ownership/expiry tests |
| `npx expo install --check` (mobile directory) | FAIL advisory: frozen Expo 56.0.19 family has newer recommended patches; no unrelated dependency changes |
| `pod install --deployment` (mobile iOS directory) | FAIL: three generated absolute-path-dependent prebuilt podspec checksums differ; lockfile preserved |
| `DATABASE_URL=postgres://dayframe:dayframe@localhost:54322/dayframe_pr186_fresh_test npm run validate:review-mutation-db` | BLOCKED/FAIL: Docker Postgres filesystem I/O before SQL validation |
| `DATABASE_URL=postgres://dayframe:dayframe@localhost:54322/dayframe_pr186_fresh_test npm run validate:location-v2-db` | BLOCKED/FAIL: same I/O, fresh-base validation not established |
| `DATABASE_URL=postgres://dayframe:dayframe@localhost:54322/dayframe_pr186_ordered_test npm run validate:location-v2-db` | BLOCKED/FAIL: same I/O, ordered-migration validation not established |
| `DATABASE_URL=postgres://dayframe:dayframe@localhost:54322/dayframe_pr186_ordered_test DAYFRAME_RUN_DB_INTEGRATION=1 npm run test -w @dayframe/web -- src/lib/event-service.postgres.integration.test.ts` | BLOCKED/FAIL: `global/pg_filenode.map: Input/output error`; cannot claim real Stop contention pass |
| `npx tsx scripts/measure-review-performance.ts` | PASS, actual desktop measurements below |

Initial full-suite runs exposed stale source-contract expectations for the intentionally replaced guards/rendering; those assertions were updated and the final full suite passes. No failures were hidden by skipping tests. The only default skip is the explicit Postgres integration switch, and its enabled run failed on infrastructure as recorded above.

Clean simulator command actually attempted:

```bash
EXPO_PUBLIC_DAYFRAME_API_BASE=https://dayframe-staging.vercel.app \
EXPO_PUBLIC_DAYFRAME_RELEASE_CHANNEL=preview \
xcodebuild -workspace apps/mobile/ios/Dayframe.xcworkspace -scheme Dayframe \
  -configuration Debug -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,id=D2D581C4-2003-4888-AFAB-32528B372EAC' \
  -derivedDataPath /tmp/dayframe-pr186-derived-data CODE_SIGNING_ALLOWED=NO clean build
```

**Local FAIL (65)**: missing `Pods-Dayframe.debug.xcconfig` after deployment-mode Pod installation stopped. The Mac had approximately 1.9 GiB free when checked. Full simulator UI/motion capture and signed build were not completed. Docker's existing container and a fresh isolated container attempt both returned filesystem/containerd I/O; no production database was substituted and no user services/data were reset.

**CI PASS:** [run 33332043685](https://github.com/kwabiwe/dayframe/actions/runs/33332043685), commit `a955f52187e6466e00660238d9f1a937f185950b`, passed both disposable PostGIS profiles and the clean unsigned Simulator build. Xcode 26.6 (`17F113`), CocoaPods 1.16.2; native job 19:51:55–20:13:56 UTC. The committed Pod/npm lockfiles remain unchanged. The successful isolated build supersedes the local build blocker for compile acceptance; it is not hands-on UI/device evidence. Expo's newer-patch advisory remains unresolved by design, and GitHub warned about the existing v4 actions' Node runtime deprecation.

Exact additional successful CI commands (synthetic service credentials only):

```bash
# Each profile runs in its own disposable service with DATABASE_URL set to:
# postgres://dayframe:dayframe@localhost:5432/dayframe_ci_test
npx tsx scripts/setup-validation-db.ts base
# In the second service:
npx tsx scripts/setup-validation-db.ts ordered
# In both services:
npm run validate:location-v2-db
npm run validate:review-mutation-db
DAYFRAME_RUN_DB_INTEGRATION=1 npm run test -w @dayframe/web -- src/lib/event-service.postgres.integration.test.ts

# On the isolated macOS runner, with the staging-only public env in the workflow:
gem install cocoapods -v 1.16.2 --no-document
# In apps/mobile/ios:
pod _1.16.2_ install
# From repository root:
xcodebuild -quiet -workspace apps/mobile/ios/Dayframe.xcworkspace \
  -scheme Dayframe -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$RUNNER_TEMP/dayframe-clean-derived-data" \
  CODE_SIGNING_ALLOWED=NO clean build
```

## Synthetic fixture safety and measurements

No production descriptions, coordinates, Health payloads or configuration were copied. `scripts/seed-review-performance-fixtures.ts` accepts only explicit synthetic `18600000-...` owner IDs, rejects any database/API configuration, writes a mode-0600 uniquely named temporary JSON bundle without overwriting, and removes only a matching owned bundle. It contains bootstrap plus evidence DTOs and does not add a production debug endpoint. It is not a staging database seeder.

Commands run successfully to create/remove a local bundle:

```bash
npx tsx scripts/seed-review-performance-fixtures.ts --workspace 18600000-0000-4000-8000-000000000002 --user 18600000-0000-4000-8000-000000000001 --profile 50
npx tsx scripts/seed-review-performance-fixtures.ts --workspace 18600000-0000-4000-8000-000000000002 --user 18600000-0000-4000-8000-000000000001 --profile 50 --remove
```

The same command with `DATABASE_URL=postgres://localhost/production` and `--profile 2` was rejected before writing, as intended. All four profiles were exercised by the measurement harness and parity tests.

Device: Mac14,3, 16 GiB; local Node v22.23.1 darwin/arm64; no network; 20 samples/profile; 250 unique historical peers; mixed Sleep/workout/trusted/unknown/commute Review; overlapping and non-overlapping windows; alternating 8/400-sample Location DTOs. Numbers below are milliseconds, **median / p95**.

| Items | Previous repeated preparation | Prepared once | Review SQLite read/parse | Evidence SQLite read/parse | Evidence bytes |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | 21.126 / 26.361 | 0.144 / 0.217 | 0.007 / 0.018 | 0.012 / 0.021 | 2553 |
| 13 | 151.625 / 155.118 | 0.157 / 0.160 | 0.023 / 0.031 | 0.888 / 1.090 | 335779 |
| 25 | 270.346 / 373.539 | 0.211 / 0.281 | 0.036 / 0.042 | 1.431 / 1.699 | 592686 |
| 50 | 562.268 / 659.534 | 0.361 / 0.482 | 0.071 / 0.080 | 3.477 / 3.752 | 1272025 |

These isolate JavaScript preparation and temporary on-disk SQLite JSON hydration, not production store/native rendering latency. Signed-build push-to-content, Back-start p95, swipe response, initial render, mounted-card count, prefetch start/stop, JS long tasks and local enqueue timing are **NOT RUN**. Keep the current list architecture until those measurements show a need to replace it.

## Deployment and physical-device acceptance

[Draft PR #186](https://github.com/kwabiwe/dayframe/pull/186) is open, with automatic merge disabled/not requested. Ready Preview `https://dayframe-gv1qs306p-dayframeworkshop.vercel.app` was verified by the Vercel API against commit `331956c908359011c377d6812bc87270bfe52393`. The branch Preview link is `https://dayframe-web-git-codex-pr186-review-aut-105097-dayframeworkshop.vercel.app`; it advances with later commits. The final handoff reports the final Ready URL/SHA separately.

Preview public/login pages loaded at 375×812 and 1280×900 without horizontal overflow or captured console errors. Anonymous `GET /api/bootstrap` returned HTTP 401 with `session_cookie_missing`. No authenticated mutation smoke test is claimed on this Preview.

The existing stable alias resolved to Ready Preview `https://dayframe-2xy4js23l-dayframeworkshop.vercel.app` (`dpl_5xpY29qcdnPfcNGbYbjAVnEkCguQ`, created 2026-08-25); it was not changed. The signed-in staging web page showed its Staging badge. That old deployment is not evidence for this branch.

Preview-scoped `vercel env pull` authenticated but could not retrieve fourteen sensitive environment values, including the database/auth/rollout identity needed for verification. Vercel admin UI required login; the browser safety check rejected initiating GitHub sign-in without explicit authorization. No workaround was used. The new Preview's mapping to staging Supabase and its operational Location rollout mode remain **unverified**; no mode or stable alias was changed. Repository fallback remains `v2_shadow` and automatic Location requires `v2_enabled`.

Supabase's existing sign-in was successfully reused. A metadata-only staging audit verified required columns across 13 feature tables, RLS on those tables, all 11 inspected time/event/receipt/Location indexes, and receipt owner uniqueness. No feature migration is needed. A separate pre-existing staging access-control finding blocks promotion; details were given privately to the owner and are intentionally not published in this public repository. No row data was queried and no permissions/migrations changed.

EAS preview build: **NOT RUN**; `npx --yes eas-cli@latest whoami` returned `Not logged in`. No signed build ID/URL, production/TestFlight build or OTA update exists for this task. Do not begin signed iPhone acceptance until the separate staging access-control finding is resolved, the exact Ready Preview is verified against staging Supabase and that Preview is manually promoted to the stable alias. Preview uses the same bundle identity and may replace TestFlight on the phone.

| Physical iPhone check | Result | Required evidence |
| --- | --- | --- |
| Timer Start/Switch/Stop/Edit/Delete, queued sync and refresh convergence | NOT RUN | Online/offline, rapid repeat, restart and exact-entry Stop |
| PR #184 reconnect recovery | NOT RUN | One recovery owner/pass; fixed icon slot; no dropped or prematurely settled intent |
| PR #185 timer background execution | NOT RUN | Immediate app switch, expiry/foreground retry; Review does not acquire timer assertion |
| Live Activities | NOT RUN | Start/edit/stop/background consistency without blocking timer completion |
| Review cache/outbox v4→v5 | NOT RUN | Upgrade with queued work, airplane mode, kill/relaunch, duplicate tap and eventual receipt replay |
| Complex Location corrections | NOT RUN | All eleven actions, both merge cards, disk failure, permanent conflict and selective restore |
| Location Evidence caching | NOT RUN | Warm/cold/offline cache, expiry/cancel/account replacement, 8/400-point payloads |
| HealthKit import/reprocess | NOT RUN | All enabled types, allowed overlaps, duplicate/revised Sleep and edited/cross-source safety |
| Location Intelligence V2 capture/replay | NOT RUN | Trusted/unknown stay, both commute tiers, boundary/gap/overlap edges, terminal decisions |
| Account/session isolation | NOT RUN | Logout/relogin/account change during queued/in-flight action, expired-session recovery |
| Calendar/Reports | NOT RUN | Unchanged Logged sum/Covered union after overlapping Health/stays/commutes |
| Native navigation/sheets/keyboard | NOT RUN | Back tap, swipe complete/cancel, rapid repeat, save/failure, text focus and keyboard geometry |
| Accessibility/motion | NOT RUN | VoiceOver, largest Dynamic Type, normal/Reduce Motion, Reduce Transparency, Light/Dark |
| Performance 2/13/25/50 | NOT RUN | Same signed staging build on comparable devices including iPhone 11 |

## Required owner tests before merge

1. Review the passing isolated base/ordered PostGIS jobs (Location, structural Review receipts and enabled Stop contention) and the final native CI result. Restore local Docker/disk before future local database/native runs; local infrastructure failures remain recorded but do not replace or negate the real CI database evidence. Do not treat mocked SQL as a replacement. A clean native build and hands-on checks are still required.
2. Resolve the separate staging access-control finding reported privately. Authorize or complete the required service sign-ins. Verify the exact PR Preview is Ready and uses the audited staging Supabase project; record rollout mode, then manually promote that exact URL to `dayframe-staging.vercel.app`. Build/install an EAS **preview** from the same code, verify staging API base and record build/device/iOS identities. Do not install production configuration for these checks.
3. Upgrade an app with pending v4 Review actions. Offline, exercise every strict resolving action. For merge confirm both source cards disappear only after local commit; kill/reopen before sync, reconnect, and retry a lost response. Expect one canonical operation/result. Fail local storage and expect both cards and draft to remain. Resolve one source on a second client, retry, and restore only the source still canonically open.
4. Exercise saved-radius ties in different arrival/input orders; baseline stays selected and alternatives remain bounded. Show nearby POIs for saved and unknown stays, use one-time with save off, explicitly save once, cancel/search/back rapidly, and verify no provider result becomes an engine signal.
5. Exercise independent start/stop widths and maximum single overlaps at 4:59.999, 5:00.000 and 5:00.001; touching, running and two separate sub-five-minute overlaps. Verify exact detected times and the final tables above. Test medium routes with 2 versus 3 samples, missing/different/same saved endpoints and >12-minute internal gaps.
6. Import/reprocess enabled Health workouts/Sleep over manual and Location entries. Check one event/entry per sample; revised same-source untouched Sleep reconciles safely; manual, edited, cross-source and ambiguous Sleep histories are not overwritten. Verify Calendar/Reports sum and union totals.
7. Repeat timer, connectivity, background and Live Activity rows above while Review has queued work; swap accounts and expire a session during dispatch. No old-owner mutation or stale callback may appear in the new account.
8. Load each synthetic profile into a verified staging test account/cache with a reviewed test-only ingestion method. Record cached content (<300 ms), Back-start p95 (<250 ms), immediate interactive swipe (including cancel), enqueue (<500 ms), mounted cards and prefetch cancellation, 25-item scrolling and no multi-second 50-item Back stall. Include iPhone 11. Desktop numbers do not satisfy these targets.
9. Repeat all changed transitions with keyboard open/closed, maximum Dynamic Type, VoiceOver, Reduce Motion and Reduce Transparency, and Light/Dark. Record PASS/FAIL per row, inspect runtime overlays/console and review results before any merge.

## Rollback and limitations

- Server: restore the prior known-good Vercel deployment/staging alias, or use the existing approved Location rollout control to remain in review/shadow while investigating. Do not delete entries, events, receipts or user decisions to roll back policy. No new Postgres schema rollback is needed.
- Mobile: preserve the v5 database and queued command bytes/UUIDs. Do not downgrade/delete the schema or install a v4-only reader over unresolved structural actions. Prefer a corrective preview retaining v5 support; drain/settle owned work before a binary rollback. Logout is an explicit account/privacy action, not a recovery shortcut.
- Review remains foreground-owned. iOS background assertions do not guarantee force-quit completion. POI lookup still needs connectivity; cached choices and their committed intent remain durable. Structural child cards come from canonical refresh, not optimistic fabrication.
- No list rewrite, redesign, new native module, Live Activity API change, Calendar/Reports implementation change, dependency upgrade or production mutation is included.

## Documentation impact

Product policy: PRD and product-model. Runtime/persistence: architecture, API, database, Location learning, Health pipeline and offline Review. Presentation: components and motion. Acceptance: regression checklist, validation matrix, tracker and this evidence note. Brand/style and hosting/release instructions were read; their visual tokens, ownership and deployment boundaries are unchanged, so those files need no edit. Older historical direct-only guidance is superseded explicitly in current canonical sources; no shipped acceptance is inferred from this branch.

The blocked local Postgres run exposed a recurring validation gap: the only existing CI workflow checked documentation. This PR adds a read-only-permission GitHub Actions matrix using the repository's existing PostGIS image, explicit synthetic credentials and an empty disposable service per base/ordered schema. No deployment credentials or production configuration enter that job. It runs both database validators and enables the real Stop contention test. The new setup helper refuses non-local/non-test/non-empty databases; its production-target rejection was executed successfully. Both profiles passed in [CI run 33331617641](https://github.com/kwabiwe/dayframe/actions/runs/33331617641) at `2ebba5abc587e5b45ae16d744301d5a91c18221a`, including all eleven complex actions and real Stop contention. Local Docker remains broken; database correctness acceptance is now established by isolated CI rather than that host.

The workflow also runs a clean unsigned Simulator build with staging-only public configuration on GitHub's documented [macOS 26 runner](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md), avoiding the local disk limit. It verifies the Pod dependency graph while tolerating only the three documented path-generated prebuilt checksums. The first run stopped in the newly added YAML checker because CocoaPods uses Symbol keys; the checker now explicitly permits only that extra safe scalar class, and local parsing passed. The second run identified runner CocoaPods 1.17.0 changing the lockfile generator version; the job installs/executes frozen 1.16.2 instead of weakening the graph check or changing the committed lock. The corrected native job passed in run 33332043685. PRs that change only documentation do not trigger this workflow; this implementation PR may rerun it after evidence-only commits because its overall diff includes application code.

## Changed files by area

### Shared

- `packages/shared/src/location/automaticPolicy.ts`
- `packages/shared/src/location/commute.ts`
- `packages/shared/src/location/index.ts`
- `packages/shared/src/location/placeMatcher.ts`
- `packages/shared/src/location/schemas.ts`
- `packages/shared/src/location/types.ts`
- `packages/shared/src/reviewMutations.ts`

### Server

- `apps/web/src/lib/event-service.ts`
- `apps/web/src/lib/location/location-ingest-service.ts`
- `apps/web/src/lib/location/location-replay-service.ts`
- `apps/web/src/lib/location/location-review-service.ts`
- `apps/web/src/lib/location/location-semantic-policy.ts`
- `apps/web/src/lib/review-mutation-service.ts`

### Mobile

- `apps/mobile/app/review.tsx`
- `apps/mobile/app/review/[id].tsx`
- `apps/mobile/src/components/location/LocationReviewCorrectionEditor.tsx`
- `apps/mobile/src/lib/locationReviewDraft.ts`
- `apps/mobile/src/lib/placeSearch.ts`
- `apps/mobile/src/lib/review.ts`
- `apps/mobile/src/lib/reviewPresentation.ts`
- `apps/mobile/src/lib/reviewSyncSchema.ts`
- `apps/mobile/src/lib/reviewSyncStore.ts`

### Tests and validators

- `.github/workflows/review-location-validation.yml`
- `apps/mobile/src/components/reviewActions.contract.test.ts`
- `apps/mobile/src/components/reviewOfflineFirst.contract.test.ts`
- `apps/mobile/src/lib/locationReviewDraft.test.ts`
- `apps/mobile/src/lib/placeSearch.test.ts`
- `apps/mobile/src/lib/review.test.ts`
- `apps/mobile/src/lib/reviewPresentation.test.ts`
- `apps/mobile/src/lib/reviewSyncStore.sqlite.test.ts`
- `apps/web/src/lib/event-service.test.ts`
- `apps/web/src/lib/location/location-review-quality.contract.test.ts`
- `apps/web/src/lib/location/location-semantic-policy.test.ts`
- `packages/shared/test/automatic-policy.test.ts`
- `packages/shared/test/location-v2.test.ts`
- `packages/shared/test/review-mutations.test.ts`
- `scripts/fixtures/review-performance.ts`
- `scripts/measure-review-performance.ts`
- `scripts/seed-review-performance-fixtures.ts`
- `scripts/setup-validation-db.ts`
- `scripts/validate-complex-review-mutations.ts`
- `scripts/validate-location-v2-db.ts`
- `scripts/validate-review-mutation-db.ts`
- `scripts/validate-review-sync-sqlite.sh`

### Docs

- `.codex/reference/api.md`
- `.codex/reference/components.md`
- `.codex/reference/database.md`
- `.codex/reference/health-review-pipeline.md`
- `.codex/reference/location-learning.md`
- `.codex/reference/motion.md`
- `.codex/reference/offline-review-mutations.md`
- `.codex/reference/product-model.md`
- `.codex/reference/validation-matrix.md`
- `docs/PRD.md`
- `docs/architecture.md`
- `docs/dayframe-regression-checklist.md`
- `docs/feature-fix-tracker.md`
- `docs/investigations/2026-08-30-review-automation-friction.md`
