# Feature: Dayframe Functionality Repair And UX Refinement

Historical status as of 2026-07-10: this plan is useful background for the repair/UX direction, but it is no longer the active work queue. Use `docs/feature-fix-tracker.md` for current `Next`, `Planned`, `Future`, `Watch`, and shipped status, and verify GitHub/TestFlight state before treating any item as complete.

Planning completed. Product answers were received before implementation.

Implementation branch: `codex/dayframe-repair-ux` from latest `origin/main`.

Resolved decisions:

- Hosted event/workout migration has been applied.
- Hosted web returned `POST /api/time-entries` 500 before this repair pass.
- Task title is optional.
- Category is optional and can be added while a timer is running.
- Existing projects can be converted into categories.
- Quick actions should prioritize pinned and most-used categories.
- Remove all legacy third-party timer-brand copy and code.
- Remove non-iOS mobile support.

Current repo state during planning:

- Current branch: `codex/ios-hosted-supabase`
- Current branch head: `b6db5aa feat: complete hosted iOS migration`
- Latest fetched `origin/main`: `563b5ba Merge pull request #3 from kwabiwe/codex/ios-hosted-supabase`
- Local `main`: `dcebfad`, behind `origin/main`
- Worktree status at planning time: clean

Before implementation, start a fresh branch from latest `origin/main` or fast-forward local `main` first.

## Understanding Summary

Dayframe is in a repair-first phase. The top priority is restoring manual time logging on both web and iOS after the hosted Supabase/Vercel migration. UX cleanup and product simplification matter, but they should not start until the web/mobile start-stop-create-entry flow is proven reliable against the hosted backend.

The key product direction is shifting from a project/client-centered user experience toward task/title/description plus custom categories. Projects/clients may remain internally for compatibility if approved, but should not remain primary user-facing concepts.

The mobile dashboard should become much quieter: logo/header, active timer, start task, quick category actions, and a Today summary. Location and HealthKit belong in onboarding and Settings, not on the dashboard.

Legacy third-party timer-brand code and copy should be removed completely unless there is a data-safety reason to stage its removal.

## Preliminary Technical Findings

These are planning findings, not final implementation conclusions:

1. Hosted schema drift is a strong candidate for the critical logging failure.
   - `apps/web/src/lib/event-service.ts` now inserts `client_event_id` into `activity_events` for all `processActivityEvent` calls.
   - `/api/time-entries` start/stop delegates to `processActivityEvent`.
   - `/api/events` also delegates to `processActivityEvent`.
   - If hosted Supabase has not run `supabase/migrations/202607030001_mobile_event_idempotency_and_workouts.sql`, web and mobile timer actions can both fail with a DB error such as missing `activity_events.client_event_id`.

2. The app still has project-gated timer assumptions.
   - `processActivityEvent` only inserts a `time_entries` row for `candidate.action === "start_timer"` when `candidate.projectId` exists.
   - `createManualEntry` requires `projectId` in TypeScript and inserts a project.
   - Web dashboard `CurrentTimerPanel` returns early when starting without a project and disables the play button if no project is selected.
   - Older `TimerPanel` also disables start without a project.
   - Mobile `startTimer(projectId, ...)`, quick actions, and custom start all require a project.
   - The DB schema allows `time_entries.project_id` to be null, so this is a code/UX constraint rather than a DB necessity.

3. New hosted accounts should get a seeded General client/category/project through `seedDefaultWorkspaceData`, but any provisioning failure or empty workspace would leave the UI unable to start timers under the current project-gated model.

4. There are no API or database integration tests covering `/api/time-entries` start/stop/manual flows. Existing tests cover shared normalization, mobile API queue/auth, HealthKit mapping, config guards, and local auth primitives.

5. Location permission handling is too coarse.
   - `requestLocationAccess()` returns only `foreground.status` or `background.status`.
   - It discards `granted`, `canAskAgain`, foreground-vs-background distinction, iOS `scope`, and iOS `accuracy`.
   - The current dashboard can therefore show "denied" after a partial or staged permission path, even if foreground permission was granted and background permission needs a separate explanation or Settings path.

6. HealthKit status handling is too coarse.
   - `getHealthImportStatus()` checks availability, but current import actions can surface raw native errors like "Authorization not determined".
   - The installed HealthKit package exposes `AuthorizationRequestStatus` values `unknown`, `shouldRequest`, `unnecessary`, and `AuthorizationStatus` values `notDetermined`, `sharingDenied`, `sharingAuthorized`.
   - HealthKit read permissions are privacy-sensitive: the app should use request status and import results carefully, and provide friendly simulator/device guidance.

7. Legacy third-party timer-brand references were present in code, docs, scripts, tests, seed data, session scopes, and settings UI.

8. Non-iOS mobile support was mostly Expo config/copy, not checked-in native platform code. There was a non-iOS object in `apps/mobile/app.json`, non-iOS health copy in docs/settings/seed, and a non-iOS font-family fallback in React Native styles.

## Root-Cause Investigation Plan For Time Logging

### Flow To Trace

Trace each path end to end:

- Web dashboard start/stop:
  - `apps/web/src/components/DashboardRealtime.tsx`
  - `POST /api/time-entries`
  - `resolveRequestSession()`
  - `processActivityEvent()`
  - `activity_events`
  - `time_entries`
  - `GET /api/bootstrap`
  - `getActiveEntry()`

- Web manual completed entry:
  - `ManualEntryDialog`
  - `POST /api/time-entries` with `mode: "manual"`
  - `createManualEntry()`
  - `activity_events`
  - `time_entries`

- Web edit/delete:
  - `PATCH /api/time-entries/[id]`
  - `DELETE /api/time-entries/[id]`
  - `updateTimeEntry()`
  - `deleteTimeEntry()`

- Mobile direct start/stop:
  - `apps/mobile/app/index.tsx`
  - `apps/mobile/src/lib/api.ts`
  - `POST /api/time-entries`
  - same server path as web

- Mobile queued event sync:
  - `enqueueEvent()`
  - `syncQueue()`
  - `POST /api/events`
  - `processActivityEvent()`
  - `clientEventId` dedupe

### Tables Involved

- `auth_sessions`
- `users`
- `workspaces`
- `workspace_members`
- `activity_events`
- `time_entries`
- `categories`
- `projects`
- `clients`
- `places`
- `review_items`
- `health_sleep_segments`
- `health_workouts`

### Auth/Session Checks

- Web pages: `resolvePageSession()` / `getOptionalPageSession()`
- API routes: `resolveRequestSession()`
- Provider mode: Supabase Auth verifies identity, Dayframe app session token lives in `auth_sessions`
- Web: `dayframe_session` HTTP-only cookie
- Mobile: bearer token from Expo SecureStore
- Ingest events: app session or scoped ingest token if `allowIngestToken`

### Diagnostic Steps

1. Confirm deployed Vercel is serving a commit that expects `client_event_id`.
2. Confirm hosted Supabase has applied all migrations:
   - base `packages/db/migrations/001_init.sql`
   - `supabase/migrations/202607020001_dayframe_rls.sql`
   - `supabase/migrations/202607030001_mobile_event_idempotency_and_workouts.sql`
3. Check hosted DB columns:
   - `activity_events.client_event_id`
   - `health_workouts.external_sample_id`
   - `health_workouts.provider`
   - `health_workouts.duration_seconds`
   - `health_workouts.distance_meters`
   - `health_workouts.energy_kcal`
   - `health_workouts.raw_payload`
4. Reproduce web start from hosted UI and inspect network:
   - Is `POST /api/time-entries` 201, 401, 400, or 500?
   - If 201, does `GET /api/bootstrap` return `activeEntry`?
   - If 500, inspect Vercel logs for DB column, FK, RLS, auth, or check constraint errors.
5. Reproduce mobile start from iOS:
   - Confirm `EXPO_PUBLIC_DAYFRAME_API_BASE` points to Vercel, not Supabase.
   - Confirm login stores a Dayframe token.
   - Inspect `POST /api/time-entries` response.
   - Confirm fallback queue is not hiding direct API failures.
6. Reproduce queued mobile event sync:
   - Queue start/stop offline.
   - Sync online.
   - Confirm `clientEventId` prevents duplicates.
7. Verify workspace provisioning:
   - New hosted user has one workspace.
   - Workspace has at least starter categories.
   - Under current code, workspace also needs at least one starter project until category-only starts are implemented.

### What Is Most Likely Failing

Most likely hosted-specific failure:

- Server code and hosted DB schema are out of sync. Missing `activity_events.client_event_id` would break web and mobile start/stop because both call `processActivityEvent()`.

Most likely product-model failure after schema is fixed:

- Time logging remains project-gated in UI and service logic, which conflicts with the desired category/task-first model and can produce "request succeeded but no active timer" behavior if a project is missing or intentionally omitted.

### Smallest Safe Fix Before UX Refactor

1. Make the hosted DB and deployed code agree.
2. Add integration coverage for `/api/time-entries` start/stop/manual.
3. Add server behavior that can create a timer with `categoryId` and/or description even when `projectId` is null, if approved.
4. Keep project/client fields in the DB for compatibility while making category/task the visible UX.
5. Improve client error display so web/mobile shows actionable API errors instead of silently falling back or refreshing into "No timer."

## Clarifying Questions

### Critical Logging Repair

1. On hosted web, what exact network response do you see for `POST /api/time-entries`: 401, 400, 500, or 201 with no active timer?
2. Do the Vercel logs show a database error, especially a missing `client_event_id` column?
3. Has `supabase/migrations/202607030001_mobile_event_idempotency_and_workouts.sql` been applied to the hosted Supabase project?
4. When testing mobile, was the build pointed at the Vercel URL through `EXPO_PUBLIC_DAYFRAME_API_BASE`?
5. Is logging broken for an existing seeded/demo account, a newly-created hosted account, or both?

### Task And Category Model

1. Should a task title/description be required to start a timer, or optional?
2. Should a category be required to start a timer, or optional?
3. Should there be a default category such as "General"?
4. Should quick actions be based on pinned categories, most-used categories, manual order, or a hybrid?
5. Should selecting a category start immediately, or prefill the Start task card and wait for title confirmation?
6. Should old projects become categories, be hidden, or be preserved internally only?
7. What should happen to existing data that references projects/clients?
8. Should `time_entries.project_id` remain nullable for compatibility?
9. Do you want tags to remain user-facing, or should categories absorb that role for now?

### Projects And Clients

1. Should the web `/projects` page become a Categories page?
2. Should clients disappear completely from navigation/search/reports now?
3. Should reports keep project/client breakdowns as legacy/internal sections, or remove them from the UX immediately?
4. Should places and automation rules map to categories only, or retain optional hidden project mappings internally?

### Mobile Dashboard

1. Should the Today card summarize by category, place, or both?
2. Do you want review count on the dashboard, or only in Settings/Review?
3. Should recent entries be editable on mobile in this phase, or only viewable?
4. Should dashboard quick actions start immediately, or open a task-title prompt?

### Onboarding And Permissions

1. Should onboarding be mandatory on first login or skippable?
2. Should location and HealthKit be opt-in steps that can be skipped and revisited in Settings?
3. Should Dayframe request foreground location first, then explain background/Always before the second prompt?
4. Should HealthKit sleep and workouts be requested together or as separate toggles?
5. Should simulator show a special "real iPhone required" state instead of regular permission controls?

### Theme

1. Should theme be stored locally per device/browser, in the user profile, or both?
2. Should mobile support `system`, `light`, and `dark`, matching web?
3. If stored in profile, should web and mobile sync the preference automatically?

### Non-iOS Mobile

1. Do you want non-iOS mobile support removed from Expo config now, or left as unsupported scaffold?
2. Are you comfortable with docs and UI saying "iOS only" everywhere for mobile?
3. Should non-iOS health seed/settings rows be removed with non-iOS copy?

### Legacy Timer-Brand Removal

1. Is there any existing personal imported data in production that needs a preservation/export path before removing importer tables or refs?
2. Should generic external import tables remain for future imports, or should all external import scaffolding be removed too?
3. Should legacy brand-style copy be replaced with "manual timer" everywhere, including PRD history?

## Proposed UX Direction

### Mobile Dashboard

Keep the first screen focused:

- Header:
  - Dayframe logo
  - compact sync/account/settings affordance
- Active timer card:
  - current task title/description
  - category chip
  - elapsed time
  - stop button
- Start task card:
  - title/description input
  - quick category chips
  - Start button
- Today summary card:
  - total tracked today
  - simple donut/progress by category
  - optional review count row if it does not crowd the primary flow

Remove from dashboard:

- Location permission card
- HealthKit card
- Raw permission errors
- Project/client language

### Mobile Onboarding

Suggested lightweight flow:

1. Welcome:
   - "Track what you are doing, then review your day."
2. Account:
   - Sign in or create account.
3. Starter categories:
   - Use default categories or edit a small starter list.
4. Location, optional:
   - Explain known-place suggestions.
   - Request foreground first.
   - Request background/Always only after a second explanation.
5. HealthKit, optional:
   - Explain sleep/workout summaries.
   - Request sleep and workout read access.
6. Finish:
   - Land on dashboard.

### Mobile Settings

Proposed structure:

- Account
  - name/email
  - workspace/account info
  - logout
- Categories
  - create/edit/delete/archive categories
  - color
  - quick-action pin/order if approved
- Permissions
  - Location
  - HealthKit sleep
  - HealthKit workouts
  - open iOS Settings when needed
- Appearance
  - system/light/dark
- Data
  - sync status
  - export link/status if supported
  - privacy notes
- About/Diagnostics
  - API base
  - app/build version
  - queue count

### Permission State Model

Location state should preserve:

- platform support: iOS native, simulator/unsupported, unavailable
- foreground status: `undetermined`, `granted`, `denied`
- background status: `undetermined`, `granted`, `denied`
- `canAskAgain`
- `granted`
- iOS `scope`: `whenInUse`, `always`, `none`
- iOS `accuracy`: `full`, `reduced`
- location services enabled/disabled if checked

Derived product states:

- unknown/checking
- unavailable
- promptable foreground
- foreground granted
- promptable background
- always granted
- denied but askable
- denied and needs Settings
- restricted/unavailable where native APIs surface that as non-askable denied/unavailable
- reduced accuracy with explanation

HealthKit state should preserve:

- platform/native availability
- request status: `unknown`, `shouldRequest`, `unnecessary`
- authorization status where meaningful: `notDetermined`, `sharingDenied`, `sharingAuthorized`
- sample import outcome
- simulator/native module unavailable errors

Derived product states:

- unavailable
- native build required
- promptable
- permission requested
- ready to sync
- denied or not available, with Settings guidance where possible
- sync failed with friendly copy
- synced with count and timestamp

## Data/UX Direction For Categories Over Projects/Clients

Recommended staged approach:

1. Immediate repair:
   - Keep DB schema.
   - Allow timer entries with `category_id` and no `project_id`, if approved.
   - Keep existing project/client data readable.

2. UX simplification:
   - Rename "Projects" navigation to "Categories" or "Settings > Categories."
   - Make category the primary selector in web and mobile timer UI.
   - Show task title/description first.
   - Remove clients/projects from dashboard, timer, mobile quick actions, landing copy, search placeholders, and Settings copy.

3. Compatibility:
   - Keep `projects` and `clients` tables initially.
   - Keep nullable `time_entries.project_id`.
   - Preserve old entries and reports by category.
   - Optionally add a migration or script later to convert project names into categories or archive projects.

4. Later cleanup:
   - After data policy is approved, remove or hide project/client creation and eventually remove tables only if no compatibility/export need remains.

## Legacy Timer-Brand Removal Strategy

Search found legacy timer-brand references in:

- root `package.json`
- `packages/db/package.json`
- importer script under `packages/db/scripts`
- importer mapping module under `packages/shared/src`
- `packages/shared/src/index.ts`
- `packages/shared/test/event-engine.test.ts`
- `packages/db/seed.sql`
- `apps/web/src/app/settings/page.tsx`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/auth/local.ts`
- `apps/web/src/lib/ingest-auth.ts`
- `README.md`
- `AGENTS.md`
- `docs/PRD.md`
- `docs/production-readiness.md`
- `docs/local-auth-and-hosting-plan.md`
- `.env.example`
- `apps/web/.env.example`
- landing/settings copy

Recommended removal:

1. Remove commands and env vars:
   - root importer command
   - db workspace importer command
   - importer API token env var
   - importer workspace env var

2. Remove importer code:
   - delete the legacy importer script
   - delete the legacy importer mapping module
   - remove export from `packages/shared/src/index.ts`
   - remove importer mapping test

3. Remove app copy/scopes:
   - remove importer session scopes
   - remove settings row
   - remove landing/README/PRD copy

4. Database decision:
   - Remove seeded integration provider row for the legacy timer brand.
   - Ask before dropping generic external import tables because they may be useful for future imports and exports.
   - If production contains provider data for the legacy timer brand, decide whether to preserve as historical external refs or purge via a deliberate migration.

## Repo Impact Map

### Critical Timer Repair

- `apps/web/src/app/api/time-entries/route.ts`
- `apps/web/src/app/api/time-entries/[id]/route.ts`
- `apps/web/src/app/api/events/route.ts`
- `apps/web/src/lib/event-service.ts`
- `apps/web/src/lib/queries.ts`
- `apps/web/src/lib/ingest-auth.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/auth/local.ts`
- `apps/web/src/lib/auth/supabase.ts`
- `packages/shared/src/index.ts`
- `packages/db/migrations/001_init.sql`
- `supabase/migrations/*`

### Web UX

- `apps/web/src/components/DashboardRealtime.tsx`
- `apps/web/src/components/TimerPanel.tsx`
- `apps/web/src/components/TimeReviewViews.tsx`
- `apps/web/src/components/EntityForms.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/components/TimelineRail.tsx`
- `apps/web/src/components/TimeAllocationPie.tsx`
- `apps/web/src/app/projects/page.tsx`
- `apps/web/src/app/reports/page.tsx`
- `apps/web/src/app/settings/page.tsx`
- `apps/web/src/app/globals.css`

### Mobile UX And Permissions

- `apps/mobile/app/index.tsx`
- new mobile route files if Settings/onboarding are split out
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/src/lib/api.ts`
- `apps/mobile/src/lib/geofence.ts`
- `apps/mobile/src/lib/health.ts`
- `apps/mobile/src/lib/deepLinks.ts`
- `apps/mobile/app.json`
- `apps/mobile/eas.json`

### Data, Seed, Docs

- `packages/db/seed.sql`
- `packages/db/scripts/setup.ts`
- `packages/db/scripts/export-workspace.ts`
- `.env.example`
- `apps/web/.env.example`
- `apps/mobile/.env.example`
- `README.md`
- `AGENTS.md`
- `.codex/reference/*`
- `docs/PRD.md`
- `docs/dayframe-regression-checklist.md`
- `docs/vercel-supabase-hosting.md`
- `docs/ios-hosted-supabase-runbook.md`
- `docs/production-readiness.md`

## Migration And Data Compatibility Risk

High risks:

- Hosted schema drift can break all timer writes.
- Removing project/client UX before allowing category-only writes can make logging impossible.
- Removing legacy importer code without deciding what to do with existing provider rows could orphan historical refs.
- Changing entry model can break reports, search, timeline grouping, quick actions, and review acceptance.
- Permission UX can hide real native-state problems if only dashboard cards are removed.

Medium risks:

- Mobile offline queue may duplicate events if `clientEventId` is not stable across retries.
- HealthKit imports may expose raw system errors or route/location metadata if mapping is bypassed.
- Theme storage may diverge between web and mobile if local-only on one and profile-backed on the other.
- Removing non-iOS config may affect Expo prebuild or package assumptions if done abruptly.

Compatibility recommendation:

- Keep DB tables/columns nullable and backward-compatible in the first implementation pass.
- Add new category-first behavior without deleting project/client data.
- Add migrations only for additive columns/indexes initially.
- Use archival/hiding before destructive deletes.
- Only drop tables or data after explicit approval.

## Test And Validation Plan

### Automated Tests To Add

- Web API/db integration:
  - `POST /api/time-entries` start with project.
  - `POST /api/time-entries` stop.
  - `POST /api/time-entries` manual entry.
  - start with category and no project, if approved.
  - unauthorized requests return 401.
  - hosted/provider app session works.

- Event service:
  - timer start creates both `activity_events` and `time_entries`.
  - timer stop closes the active entry for the current user/workspace only.
  - duplicate `clientEventId` returns duplicate and does not create a second entry.
  - category-only start behavior.

- Mobile API:
  - start timer payload can be category-first if approved.
  - direct start/stop errors are surfaced clearly.
  - queue preserves order and sends `clientEventId`.

- Permissions:
  - location mapper covers `undetermined`, foreground-only, always, denied askable, denied settings, reduced accuracy.
  - HealthKit mapper covers unavailable, should request, unnecessary, denied/not determined, simulator/native module unavailable, sync errors.

- No legacy timer-brand references:
  - CI check or test that a hidden-file repo search has no legacy timer-brand matches outside an intentional changelog entry if approved.

### Validation Commands

Run after implementation:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run db:up
npm run db:setup
npm run prebuild:ios -w @dayframe/mobile -- --clean
```

Targeted checks:

```bash
npm run test -w @dayframe/mobile
npm run test -w @dayframe/web
npm run test -w @dayframe/shared
rg --hidden -n "<legacy timer-brand pattern>" --glob '!node_modules/**' --glob '!apps/mobile/ios/Pods/**'
rg -n "localhost:3000|127.0.0.1" apps/mobile/src apps/mobile/app.json apps/mobile/eas.json docs .env.example
```

Hosted manual smoke:

1. Login/signup with allowlisted user.
2. Confirm `/api/auth/me` resolves user/workspace.
3. Confirm `/api/bootstrap` returns categories and active timer.
4. Start web timer.
5. Confirm `activity_events` row exists.
6. Confirm `time_entries` active row exists.
7. Stop web timer.
8. Confirm `stopped_at` is set.
9. Start mobile timer.
10. Confirm web active timer updates after refresh.
11. Stop mobile timer.
12. Queue mobile event offline and sync online.
13. Confirm duplicate sync does not duplicate rows.
14. Create manual completed entry.
15. Edit category/title.
16. Delete entry.

Permission manual smoke:

1. Fresh simulator/native build: location unknown/undetermined state displays friendly copy.
2. Foreground grant shows while-in-use state.
3. Background denial shows actionable "open Settings" state.
4. HealthKit on simulator/native-unavailable shows "real iPhone/native build required" copy.
5. HealthKit on real iPhone requests sleep and workout read access without raw native errors.
6. HealthKit denied state does not claim sync is available.

UI smoke:

1. Web dashboard desktop and phone widths.
2. Mobile dashboard at iPhone 15-ish dimensions.
3. Web Settings, profile, account menu, search, notifications, help.
4. Mobile Settings and onboarding.
5. Theme system/light/dark on web and mobile.

## Proposed Plan File Outline

This file is the proposed plan artifact:

` .codex/plans/dayframe-functionality-repair-ux-refinement.md`

Implementation should be split into follow-up execution plans or phases:

1. Repair hosted time logging.
2. Add regression tests around timer/event/session flows.
3. Move timer model toward category/task-first with approved decisions.
4. Clean mobile dashboard.
5. Add onboarding and mobile Settings.
6. Fix location/HealthKit permission state handling.
7. Remove legacy timer-brand references.
8. Decide non-iOS support posture and update config/docs.
9. Restore/sync theme setting.
10. Update agent docs and regression checklists.

## Meta-Reasoning: Future Drift Prevention

### AGENTS.md Updates

Recommended updates:

- Remove legacy timer-brand wording and commands.
- State "category/task-first UX" as the current product rule.
- Clarify that projects/clients are legacy/internal compatibility until explicitly revived.
- Add a hard rule: never change timer/event/session flows without adding or running start/stop/manual-entry validation.
- Add permission guidance: location and HealthKit belong in onboarding/settings, not dashboard.
- Add iOS-only mobile posture once approved.

### .codex/reference Updates

Recommended files:

- Add `.codex/reference/database.md` for schema/migration/RLS conventions.
- Expand `.codex/reference/api.md` with required timer route tests and error-shape expectations.
- Expand `.codex/reference/components.md` with dashboard/settings/onboarding patterns.
- Expand `.codex/reference/testing.md` with a mandatory "core timer matrix."
- Add `.codex/reference/mobile-permissions.md` for Expo Location and HealthKit state mapping.
- Add `.codex/reference/product-model.md` for task/category-first UX decisions.

### .codex/prompts Updates

Recommended updates:

- Update planning prompt to always require a "core flow regression matrix" for timer/auth/sync changes.
- Update execute prompt to require checking latest `origin/main` before implementation.
- Update commit prompt to include `git status`, focused diff/stat review, and regression-test summary.
- Add a remove-integration prompt for deleting integrations safely across code/docs/env/tests/seed/migrations.

### Tests And Validation Checklist Updates

Recommended additions:

- API integration tests for `/api/time-entries`.
- Event-service tests with a real test DB or transaction rollback.
- Mobile permission mapper unit tests.
- HealthKit friendly error-state tests.
- No legacy timer-brand repo search check.
- No-localhost-production mobile config check.
- Hosted migration checklist with explicit column/index verification.
- Mobile dashboard smoke checklist.
- Mobile Settings/onboarding smoke checklist.
