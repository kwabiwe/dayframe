# Location Intelligence V2

Status: pre-PR self-review and local validation complete on `codex/location-intelligence-v2`. Hosted Supabase, Vercel, TestFlight, physical-iPhone, and battery checks are `NOT RUN`, so production rollout is not approved by this work.

## Repository and preservation

- Repository: `kwabiwe/dayframe` (`git@github.com:kwabiwe/dayframe.git`).
- Branch: `codex/location-intelligence-v2`.
- Branch/base/merge-base: `958063dce9f29fd93e788b9043ac3ef25348c1f9`.
- `main` and `origin/main` were fetched and remained at the same commit; no rebase was required.
- Before further edits, the complete unstaged working tree was copied outside the repository to `~/Downloads/dayframe-location-v2-pre-pr-20260720.MY2o9I` with mode `0600`. Its patch is 432,687 bytes with SHA-256 `968b0c98b80841da714a702a30144dac76e0ec644a44699c160bc7432c8c4e7c`.
- Final pre-commit scope contains 86 source/config/test/documentation files. Modified areas are shared location contracts; the additive database schemas; server ingestion/replay/retention/review/query/export; mobile API/geofence/SQLite/native capture and review UI; web review/map UI; dependencies/config; validation scripts; and documentation.
- Local `.env` files, `.codex-dayframe-*.png`, `apps/mobile/.env.local`, `apps/mobile/ios/.xcode.env.local`, simulator screenshots, DerivedData, Pods build output, databases, archives, location exports, and credentials were excluded.

## Root cause

V1 reduced location evidence into recurrence clusters and inferred continuity from spatial recurrence plus long elapsed gaps. It did not own one ordered evidence journal or canonical server replay; the 20 iOS monitored regions could be mistaken for the useful place catalogue; raw retention was not operationally scheduled; precise evidence ownership was not consistently stronger than workspace membership; and mobile location edit/confirm could span two requests. A 75m Expo movement filter was also easy to interpret as a dwell timer even though iOS offers no such periodic-delivery guarantee.

These gaps could merge two visits to one venue across an intervening Home stay, allow nearby POIs to label Home, absorb a short stop into one journey, or partially apply a correction.

## Architecture trace

1. Expo standard updates become stable `standard_location` evidence; low accuracy and teleport-like samples are rejected or marked uncertain.
2. Saved-place geofence enter/exit/state events are evidence anchors; initial state and isolated exits cannot invent visits, and an exit can close only its matching place.
3. Native `CLVisit` callbacks are normalised as arrival/departure bounds rather than exact real-time positions.
4. Native significant-change callbacks are coarse movement anchors and never place identity by themselves.
5. Both native sources write serially to an atomic line-delimited Application Support queue with complete-file protection and backup exclusion; native callbacks make no API calls.
6. React Native reads the native queue only for the authenticated account and acknowledges a record only after durable SQLite import.
7. `dayframe-location-v2.db` stores account-isolated evidence, upload state, replay state, and derived segments with WAL, foreign keys, a 5s busy timeout, and serial mutations.
8. Mobile replays the pure shared engine over the complete ordered local journal for deterministic local state.
9. Pending evidence enters a bounded 100-item outbox; retries are idempotent, `413` shrinks a batch, retryable failures back off, and permanent invalid items do not block later evidence.
10. `POST /api/location/evidence` requires a Dayframe app session and validates a 512KiB/100-item batch.
11. The server inserts user/workspace-owned exact evidence in PostGIS plus one coordinate-free batch `activity_event` inside a transaction.
12. Canonical replay locks per user, reloads ordered evidence, and runs the same shared matcher/segmenter regardless of upload order.
13. Replay derives bounded stays and evidence-backed or explicitly endpoint-only commutes; route and straight-line distances remain distinct and no transport mode is guessed.
14. Semantic stay/commute summaries enter `activity_events` first and contain no coordinates, route points, geocoder objects, or private addresses.
15. Eligible V2 semantics create `review_items`, never direct ambiguous time entries.
16. `/api/bootstrap` returns the server rollout mode and owner-scoped review data; mobile persists its acknowledgement/cutover state.
17. Web queries resolve a request session and filter location reviews by workspace and user.
18. `GET /api/review/:id/location-evidence` returns one strict private/no-store `LocationReviewEvidenceDto` used by both clients.
19. Confirm, edit/change-place/record-once/save-place, split, merge, and ignore run through the atomic review service with user/event/review/segment locks.
20. Confirmation creates ordinary event-first `time_entries`; retries and concurrent resolution cannot duplicate them.
21. Mobile expires raw evidence after seven days. Vercel Cron calls a bearer-protected service-role route daily to delete expired server evidence and lineage while preserving derived summaries, accepted places, reviews, and confirmed entries.

The implemented flow matches the intended event-first design. Remaining validation gaps are operational/device evidence, not known architecture mismatches.

## Self-review findings and corrections

- The initial two-state `v2_shadow`/`v2` contract could not express V1 fallback, review-only cutover, and future high-confidence enablement. It now has `v1`, `v2_shadow`, `v2_review`, and `v2_enabled`, with `v2_shadow` as the server default and a legacy `v2` request mapped to `v2_review` for older builds.
- Merely switching modes could have replayed shadow-era segments into user-visible reviews. Server mode is now authoritative and semantic emission requires a same-mode client acknowledgement; only final segments whose start is at or after that cutover can emit.
- V1 and V2 could otherwise both create semantics. Shadow retains V1 while emitting no V2 reviews/entries; review/enabled suppress V1 location semantics. Mode/idempotency tests cover these boundaries.
- The complete saved-place catalogue and the iOS top-20 monitored subset were conflated in one path. Matching now receives the full catalogue; only region monitoring is capped. A regression test proves place 21 still matches standard samples.
- Straight endpoint displacement could be described as a route. Commutes now require movement evidence for route distance and explicitly label endpoint-only fallback/uncertainty.
- A geofence exit could close an unrelated open stay. Exit handling now matches place identity and isolated exits cannot invent a stay.
- A row-count cleanup path could evict pending uploads. Capacity cleanup now removes only acknowledged or permanently rejected rows; the seven-day privacy boundary intentionally expires all old raw evidence and is documented.
- Concurrent SQLite writes reproduced `database is locked`. WAL, a 5s busy timeout, one rejection-safe mutation queue, and duplicate-sync coalescing were added with rollback/restart/contention tests.
- Native evidence could remain bound across logout/account change. Native signals plus local account data are cleared fail-closed before a different authenticated account is bound.
- The native test source initially had no executable test action. A Swift Package XCTest target now runs the production store/service sources and executes 10 tests.
- The native queue originally had a default count cap that could discard unimported evidence. Production no longer uses that cap; tests can inject a cap. Retention rewriting occurs on read/count/relaunch.
- Synthetic acceptance fixtures used family-style labels alongside coarse non-London coordinates, which made their provenance unnecessarily ambiguous during the privacy scan. They now use explicit synthetic `SHORT_STOP`, `ROUND_TRIP_HOME`, and intermediate-POI points on a London-relative line; no investigation address or route is committed.
- Retention existed only as SQL. `vercel.json`, a `CRON_SECRET`-protected route, advisory locking, service-only execution grants, bounded 5 x 10,000 deletion batches, non-2xx failures, and coordinate-free backlog logs make it operational.
- Workspace membership was too broad for precise evidence/review surfaces. Owner-validation triggers and user-plus-membership RLS policies now cover evidence, stays, commutes, lineage, feedback, and reviews.
- Legacy mobile review editing risked being forced through the V2 atomic path. The atomic option is explicit; non-V2 reviews keep their compatible manual-entry/dismiss behaviour and a regression test covers it.
- Primary Review copy repeated the same detected-stay explanation. Cards now prioritise visit/commute type, place, interval, duration, confidence/uncertainty, category, and actions; detailed evidence remains in the evidence view.
- The first simulator launch targeted an older installed `com.dayframe.app` binary that shares the legacy `dayframe` URL scheme, producing irrelevant missing-module errors. Validation was repeated with the canonical `com.layereight.dayframe` bundle and scheme after a clean Metro restart; the signed binary then loaded the V2 Review route without native-module/runtime errors.

## Deterministic segmentation and matching evidence

The shared suite orders by occurrence time/source precedence/stable ID and covers:

- 334m nearby `A -> B -> A` as three distinct stays, including completion inside the old three-hour gap.
- 168m A/B: remaining/passing at A does not create B; supported dwell at B does.
- sports centre -> Home -> sports centre: two sports stays, one Home stay, and separated movement.
- a saved 14-minute intermediate stop retained between two journeys.
- wrong-place exit, isolated exit, initial geofence state, completed/delayed visit support, contradiction, uncertain gaps, low accuracy, teleport rejection, duplicate and out-of-order input, endpoint-only commute fallback, route-vs-straight distance, MUM_HOME -> CHURCH -> MUM_HOME, and London BST/DST/local-day boundaries.
- deterministic overlap/priority/accuracy matching and a saved place outside the monitored top 20.

## Rollout proof

- Default: `DAYFRAME_LOCATION_ROLLOUT_MODE=v2_shadow` in the root and web example environments; invalid/missing values also resolve safely to shadow.
- Remote control: bootstrap returns the server mode, so the server can return every installed V2 client to shadow without an iOS release.
- `v1`: V2 native/SQLite capture stops and clears; previous geofence semantics remain.
- `v2_shadow`: V2 evidence/segments persist for comparison, V1 remains active, and no V2 review item/time entry/auto-confirm is emitted.
- `v2_review`: V1 location semantics are suppressed and post-cutover V2 stays/commutes may create review items; ambiguous evidence cannot auto-confirm.
- `v2_enabled`: reserved for a later approved narrow policy; current unknown/ambiguous evidence remains review-first.
- Same-mode acknowledgement plus segment-start cutover prevents shadow backfill. Unique/idempotency constraints and locked replay prevent duplicate events, segments, reviews, and entries.

## Migration, RLS, and retention review

`supabase/migrations/202607200001_location_intelligence_v2.sql` is additive/idempotent and contains no local `auth` stubs. It adds required evidence, commute, link, feedback, review ownership, audit, constraint, trigger, PostGIS/time/idempotency index, RLS, and cleanup objects without deleting or rewriting V1 history. The base local schema mirrors the objects for new local databases.

Disposable local validation used only `127.0.0.1:54322` databases ending `_test`:

- `dayframe_v2_base_test`: complete current base schema.
- `dayframe_v2_upgrade_test`: original `958063d` base/RLS plus the V2 migration, applied twice.
- `dayframe_v2_ordered_test`: original base plus every Supabase migration in order and then V2. Test-only `auth.uid()` stubs existed only in this disposable database, never in the production migration.

Fresh, upgraded, second-apply, and ordered migration paths passed. Owner triggers reject cross-user review/event/segment/evidence/place/learned/parent/superseder/commute/link/feedback references. Two ordinary non-superusers in one workspace proved User A saw 2 evidence rows/1 review, User B saw 1 evidence row/0 reviews, and both cross-user link/review inserts failed. Authenticated users cannot execute retention; the service role deleted expired evidence and lineage while the derived stay/review remained.

Retention is scheduled by Vercel Cron at `17 3 * * *` UTC against `/api/cron/location-retention`. Vercel production supplies the `CRON_SECRET` bearer token; the route uses the database service credential to call the service-only cleanup function. It runs under an advisory lock and deletes at most 50,000 rows per invocation. Missing/wrong secrets fail closed, results are `no-store`, failures return non-2xx, and remaining backlog produces a coordinate-free warning in Vercel logs. Vercel Cron is production-only; this task tested the route/function locally but did not deploy or invoke the hosted schedule.

Retention removes expired points, route geometry, cached geocoder fields, and evidence links. It does not cascade into derived stays, saved/accepted places, reviews, or confirmed entries. Permanent event payload tests reject coordinate keys. Export is owner-scoped GeoJSON with `[longitude, latitude]`; Settings explains that evidence deletion does not delete confirmed time entries or saved places.

## Atomic review and map review

Confirm, edit/change-place and confirm, record once, save place and confirm, split, merge, and ignore once execute in one transaction. Tests prove duplicate retry safety, rollback with the review still open, owner assignment, save-place rollback, successful split lineage, merge into one review without creating time, incompatible merge rejection, and concurrent confirmation producing one entry. Merge locks both segments and requires compatible user/device/algorithm/place/learned identity, a maximum 30-minute gap, and no intervening stay; client adjacency is only an affordance and the server is authoritative.

Both clients consume `LocationReviewEvidenceDto`, including accepted/rejected counts, confidence/version, uncertainty bounds, evidence gaps, retained/expired state, route or endpoint-only geometry, place centres/radii, and a textual fallback. Mobile uses `react-native-maps`/Apple Maps; web loads MapLibre client-only. No public demo tiles are embedded. An authorised style URL must provide its own attribution and CSP hosts; otherwise the tile-free canvas remains usable. Controls are at least 44px.

Browser QA covered the real Review page shell at 1280x720 and 390x844 in the in-app browser. Page width matched viewport at 390px, visible controls met the 44px contract, and no console/runtime errors or overlays were present. A complete browser interaction through the evidence panel was not recorded because switching the local Next dev origin changed the dev cookie/session fixture; component/API/DTO tests cover the panel states, but this manual subcheck remains for independent review/staging.

## Automated validation (2026-07-20)

Passed:

```text
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:brand-assets
git diff --check
cd apps/mobile && npx expo install --check
npm run typecheck -w @dayframe/shared
npm run test -w @dayframe/shared
npm run typecheck -w @dayframe/mobile
npm run test -w @dayframe/mobile
npm run typecheck -w @dayframe/web
npm run test -w @dayframe/web
npm run build -w @dayframe/web
npm run validate:location-v2-sqlite
DATABASE_URL=postgres://dayframe:dayframe@127.0.0.1:54322/dayframe_v2_base_test npm run validate:location-v2-db
DATABASE_URL=postgres://dayframe:dayframe@127.0.0.1:54322/dayframe_v2_ordered_test npm run validate:location-v2-db
npx pod-install ios
xcodebuild test -quiet -scheme DayframeLocationVisits -destination 'platform=iOS Simulator,id=6933A99B-D5DE-486A-B040-006CC11AFEC4' -derivedDataPath /tmp/dayframe-location-visits-derived CODE_SIGNING_ALLOWED=NO
xcodebuild -workspace apps/mobile/ios/Dayframe.xcworkspace -scheme Dayframe -configuration Debug -destination 'platform=iOS Simulator,id=6933A99B-D5DE-486A-B040-006CC11AFEC4' -derivedDataPath /tmp/dayframe-location-v2-app-derived CODE_SIGNING_ALLOWED=NO clean build
xcodebuild -workspace apps/mobile/ios/Dayframe.xcworkspace -scheme Dayframe -configuration Debug -destination 'platform=iOS Simulator,id=6933A99B-D5DE-486A-B040-006CC11AFEC4' -derivedDataPath /tmp/dayframe-location-v2-app-derived build
```

Exact test results:

- shared: 5 files, 93 tests passed.
- mobile: 29 files, 214 tests passed.
- web: 36 files, 182 tests passed.
- total TypeScript/Vitest: 70 files, 489 tests passed.
- native Swift/XCTest: 10 tests passed in the executable `DayframeLocationVisits` scheme.
- SQLite validator: WAL, idempotent schema, duplicate import, offline outbox, partial retry, account isolation, seven-day retention, rollback, restart persistence, and lock contention passed.
- database validator on both fresh base and ordered schemas: ordered replay, duplicate ingest, shadow cutover, semantic idempotency, atomic rollback, concurrent retry, split, merge, incompatible-merge rejection, and V1 compatibility passed.

`npm audit --omit=dev --audit-level=moderate` reported 12 moderate advisories: PostCSS through Next and `uuid` through Expo/Xcode tooling. npm offers only `--force` breaking framework changes for the complete fix. No forced dependency rewrite was applied in this scoped branch.

## Native build and runtime

- CocoaPods installed 112 dependencies/111 pods and autolinked `DayframeLocationVisits`, SQLite, maps, and the existing Expo modules.
- The executable Swift package test scheme ran 10/10 tests: stable IDs, open visits, duplicate/acknowledgement, concurrent writes, trailing-record recovery, store recreation, significant-change serialization, retention, rewrite on relaunch, and restoration behaviour.
- A clean unsigned Debug build completed with `** CLEAN SUCCEEDED **` and `** BUILD SUCCEEDED **`.
- A locally signed Debug build completed with `** BUILD SUCCEEDED **`, installed on iPhone 17 / iOS 26.5, launched as canonical bundle `com.layereight.dayframe`, connected to a clean Metro instance, loaded the V2 Review route, and loaded the native visit module. No native-module/runtime error was emitted. Expected warnings said HealthKit authorisation was not determined on the fresh simulator.
- The first legacy-scheme launch accidentally opened an older installed `com.dayframe.app` development binary and showed missing modules. That result was discarded; the canonical bundle/scheme and clean Metro run above are the recorded result.

## Remaining limitations and human-only validation

All of the following are `NOT RUN`: physical iPhone foreground/background, locked phone, suspension, eligible relaunch, explicit force-quit limitation, Background App Refresh disabled, reduced precision, permission changes, Location Services cycle, reboot, hours-offline outbox/reconnect, duplicate retry on device, real 300-350m `A -> B -> A`, sports-centre round trip, nearby Home/school, 10-15m intermediate stop, long drive, mobile/web same-item parity, Dynamic Type, VoiceOver, Reduce Motion, and measured 24-hour battery impact.

Core Location remains opportunistic. Explicit force-quit prevents guaranteed relaunch/delivery; Background App Refresh, Always/Precise permission, system policy, reboot, and battery conditions can delay or stop signals. `CLVisit` is retrospective and significant-change points are coarse. No simulator or unit test is treated as proof of these device behaviours.

The hosted migration, production RLS/functions, `CRON_SECRET`, scheduled retention invocation/logs, production map style/CSP, Vercel deployment, TestFlight archive/upload, and cross-surface staging comparison also remain `NOT RUN`.

## Production hard stops

- Do not apply `202607200001_location_intelligence_v2.sql` to hosted Supabase from this PR-preparation task.
- Do not deploy this branch to Vercel production.
- Do not upload a TestFlight build.
- Do not change the production rollout from `v2_shadow` or enable `v2_review`/`v2_enabled`.
- Do not merge the draft until independent review and the authorised hosted-release sequence are complete.
- Roll back operationally by changing the server-controlled mode to `v2_shadow` or `v1`; do not destructively roll back the additive evidence tables or delete confirmed history.
