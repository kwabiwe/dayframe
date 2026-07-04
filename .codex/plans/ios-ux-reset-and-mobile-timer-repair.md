# Dayframe iOS UX Reset And Mobile Timer Repair Plan

Planning status: approved and implemented in the follow-up repair pass.

Created from current branch `codex/dayframe-repair-ux` after fetching `origin`.

Implementation decisions received:

- Mobile start failures show a separate starting/queued state until server confirmation.
- Category chips start immediately.
- Uncategorized is not a visible category option.
- Active timers are editable while running.
- Foreground sync every 2 to 5 seconds is enough for now.
- Settings is a pushed screen from a top-right icon.
- Today keeps a blank chart zero-state without a misleading category slice.
- Reviewable items appear in Today and are tappable.
- Apple Health requests sleep and workout access together, then syncs automatically.
- Category create, edit, archive, reorder, pin, and use all ship now.
- `lucide-react-native` may be added for consistent, accessible iOS icons.

## 1. Understanding Summary

Dayframe needs a pause and reset on the iOS app before more implementation. The current iOS screen technically contains the right product ingredients, but it compresses dashboard, timer, categories, settings, sync, location, and health controls into one long surface. That makes the product feel crowded and unfinished, and it obscures the more serious functional issue: mobile timer start is not reliably giving the user a running timer against the hosted API.

The next implementation pass should be repair-first:

- Prove mobile start/stop works against hosted Vercel/Supabase.
- Preserve the event-first model: timer, health, location, shortcuts, and offline signals become `activity_events` before they create or close `time_entries`.
- Make the iOS product category/task-first: optional task title, optional category, no required project in primary flows.
- Move permissions, sync details, profile, logout, theme, and category management to Settings or onboarding.
- Keep the dashboard focused on logo/header, active timer, start task, quick category action, and Today.

## 2. Prompt And Repo Context Read

Read or checked:

- `AGENTS.md`
- `.codex/prompts/prime.md`
- `.codex/prompts/plan-feature.md`
- `.codex/prompts/commit.md`
- `.codex/PIV-LOOP-CHECKLIST.md`
- `.codex/reference/api.md`
- `.codex/reference/components.md`
- `.codex/reference/database.md`
- `.codex/reference/mobile-permissions.md`
- `.codex/reference/product-model.md`
- `.codex/reference/style.md`
- `.codex/reference/testing.md`
- `docs/PRD.md`
- `docs/dayframe-regression-checklist.md`
- `docs/ios-hosted-supabase-runbook.md`
- `docs/vercel-supabase-hosting.md`
- current mobile/web API, mobile UI, HealthKit, geofence, deep link, schema, and Supabase migration files.

Requested prompt note: the request mentions `prompts/commits.md`, but this repo currently has `.codex/prompts/commit.md` and no `prompts/commits.md` or `.codex/prompts/commits.md`.

Current git context:

- `origin/main`: `563b5ba Merge pull request #3 from kwabiwe/codex/ios-hosted-supabase`
- current branch: `codex/dayframe-repair-ux`
- current head: `739d406 fix: repair hosted timer and category-first iOS UX`
- worktree: clean before writing this plan file

## 3. Current UX Critique From Screenshots

The screenshots show a real information architecture problem, not just styling polish.

Dashboard issues:

- The dashboard is a long single page containing primary timer work and settings/admin work.
- The Today card appears too low, after quick actions and the large start form.
- The separate "Quick categories" section duplicates the category picker and consumes first-screen space.
- The Start task button is a large text button where a compact play affordance would fit the task.
- Category cards are too tall for a frequent-use timer app.
- The zero/near-zero Today chart can show a large donut and a category legend even when total time is `0m`, which reads as misleading.

Settings/permission issues:

- Profile, theme, categories, logout, sync, location, and health data live at the bottom of the dashboard.
- The location row can clip the action button off the right edge on iPhone-sized screens.
- Health controls expose implementation language and four separate buttons, which makes a single permission/sync task feel technical.
- Logout is correctly not top-level chrome now, but the profile/settings area is still not a separate destination.

Interaction quality issues:

- Button sizes vary without clear hierarchy.
- Long explanatory copy is mixed into the primary dashboard.
- Permission state copy is not yet modeled as a friendly product state machine.
- The page feels like a development control panel instead of a compact iOS productivity tool.

## 4. Current Implementation Map

Main files that matter:

- `apps/mobile/app/index.tsx`: one large HomeScreen containing auth, dashboard, timer, categories, settings, location, health, sync, theme, and logout.
- `apps/mobile/src/lib/api.ts`: hosted API client, app session token, direct timer actions, offline queue, queued event sync.
- `apps/mobile/src/lib/config.ts`: centralized API base config and hosted-safe URL guard.
- `apps/mobile/src/lib/health.ts`: HealthKit availability, permission, sleep import, workout import, metadata stripping.
- `apps/mobile/src/lib/geofence.ts`: Expo location permission flow, geofence task, event queueing.
- `apps/mobile/src/lib/deepLinks.ts`: shortcut/deep-link event queueing.
- `apps/web/src/app/api/time-entries/route.ts`: direct timer/manual API route.
- `apps/web/src/app/api/events/route.ts`: queued/ingested event route.
- `apps/web/src/app/api/bootstrap/route.ts`: mobile/web bootstrap data.
- `apps/web/src/lib/event-service.ts`: event-first transaction and derived time/review/health writes.
- `apps/web/src/lib/queries.ts`: bootstrap categories, entries, active timer, stats.
- `packages/shared/src/index.ts`: event schemas and normalization.
- `packages/db/migrations/001_init.sql`: local base schema.
- `supabase/migrations/*.sql`: hosted RLS, idempotency/workout columns, category pins/backfill.

## 5. Mobile Timer Start Root-Cause Plan

Known direct mobile start path:

1. `apps/mobile/app/index.tsx`
   - `customStart()` calls `startTimer(undefined, selectedCustomCategory?.id, trimmedDescription)`.
   - `quickStart(categoryId)` calls `startTimer(undefined, categoryId)`.
2. `apps/mobile/src/lib/api.ts`
   - `startTimer()` posts to `${DAYFRAME_API_BASE}/api/time-entries`.
   - Body is `{ mode: "start", source: "mobile_app", projectId, categoryId, description }`.
   - Auth uses `Authorization: Bearer <Dayframe app session token>` from SecureStore.
3. `apps/web/src/app/api/time-entries/route.ts`
   - Resolves `RequestSession`.
   - Converts source to `mobile_app`.
   - Calls `processActivityEvent()` with `type: "timer_start"`.
4. `apps/web/src/lib/event-service.ts`
   - Validates through `ActivityEventInputSchema`.
   - Inserts `activity_events`.
   - If candidate action is `start_timer`, closes prior active entry if needed and inserts a `time_entries` row.
5. `apps/web/src/app/api/bootstrap/route.ts`
   - `getBootstrapData()` returns `activeEntry` and entries for mobile refresh.

Immediate findings:

- Mobile and web direct timer start use the same server route.
- Mobile catches most non-auth direct start failures and falls back to an offline event, then tries queue sync. This can hide the original 500 and make the UI look like it ignored the action.
- Web stop showing up on mobile after a lag is expected with the current 30 second polling interval plus AppState refresh.
- `apps/mobile/src/lib/deepLinks.ts` still requires `projectId` for `action/start`; this is a category-first compatibility gap.

Most likely failure classes to verify before UX refactor:

- Hosted schema drift: Vercel code expects columns/indexes that hosted Supabase has not applied.
- Hosted deployment drift: simulator/mobile is pointing at a deployed Vercel build that is not the current branch.
- Direct start fails but fallback queue masks it.
- Mobile bearer token is missing/expired or resolves to a workspace without category/default data.
- `POST /api/time-entries` succeeds, but bootstrap refresh fails due to category pin or other query schema mismatch.
- Shortcut/deep-link starts remain project-gated even though direct timer starts are category-capable.

Smallest safe repair sequence:

1. Add a diagnostic reproduction before code changes:
   - Verify `EXPO_PUBLIC_DAYFRAME_API_BASE`.
   - Confirm mobile auth token exists.
   - Capture the exact `POST /api/time-entries` response status/body.
   - Inspect Vercel logs for the corresponding request.
   - Confirm hosted Supabase columns/indexes.
2. Adjust mobile start behavior:
   - Keep direct API first.
   - Show a clear "queued" or "failed" state when fallback queue is used.
   - Do not silently clear the task input if both direct and queued sync fail.
   - Add a local active/queued visual state if direct start succeeds but bootstrap is slow.
3. Add regression tests:
   - Direct mobile start success.
   - Direct mobile start 500 with queued fallback status.
   - Queue sync 201/200 duplicate handling.
   - Server start accepts category-only and uncategorized starts.
   - Deep-link start accepts category-only if approved.

## 6. Web Timer Route Comparison

Web direct start paths currently post to `/api/time-entries` too.

Important web files:

- `apps/web/src/components/DashboardRealtime.tsx`
- `apps/web/src/components/TimerPanel.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/app/api/time-entries/route.ts`

Current server test coverage confirms category-only direct API input is accepted at the route mock level in `apps/web/src/app/api/time-entries/route.test.ts`.

Remaining web risk:

- Some web UI still contains project/client compatibility concepts, especially entry edit forms, reports, and timeline labels.
- The API route test mocks `processActivityEvent()`, so it does not prove the actual DB transaction creates a time entry in hosted Supabase.
- Add either DB-backed integration coverage or a focused service test for `processActivityEvent()` with a category-only timer event.

## 7. Hosted Supabase And Deployment Checks

Current local schema and hosted migrations include:

- `activity_events.client_event_id`
- unique idempotency index on `(workspace_id, user_id, client_event_id)`
- `health_workouts` audit columns
- unique workout sample index
- `categories.is_pinned`
- category pin index
- project-to-category backfill migration

Current deployment artifacts:

- `apps/mobile/app.json` uses bundle identifier `com.dayframe.app`.
- `apps/mobile/eas.json` has `development`, `preview`, and `production` profiles.
- `.env.example` documents `EXPO_PUBLIC_DAYFRAME_API_BASE` as Vercel URL for hosted iOS builds.
- `docs/ios-hosted-supabase-runbook.md` says not to append an SSL-mode query parameter when the deployed pooler URL only works without it.

Before any hosted signoff, run Supabase checks similar to:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'activity_events'
  and column_name = 'client_event_id';

select indexname
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'idx_activity_events_client_event_id',
    'idx_health_workouts_external_sample',
    'idx_categories_workspace_pinned'
  );

select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'health_workouts'
  and column_name in (
    'external_sample_id',
    'provider',
    'duration_seconds',
    'distance_meters',
    'energy_kcal',
    'raw_payload'
  );
```

Also verify:

- Vercel Production and Preview use `DAYFRAME_AUTH_MODE=provider`.
- `DATABASE_URL` is the working Supabase pooler URL without the extra query parameter if that is what production requires.
- iOS hosted profiles point to Vercel, not Supabase.
- Native hosted builds reject localhost/LAN API bases in production.

## 8. Sync Recommendation

For the next repair phase, use a pragmatic near-real-time approach rather than Supabase Realtime.

Recommended MVP behavior:

- Direct mobile start/stop updates local UI immediately after a 201 response.
- Bootstrap reload happens right after start/stop and on app foreground.
- While dashboard is visible and authenticated, poll every 2 to 5 seconds only when:
  - an active timer exists,
  - a direct timer action just happened,
  - the queue has pending events, or
  - the app returned to foreground.
- Fall back to 30 to 60 second polling when idle.
- Show explicit "queued" status if offline fallback is used.
- Add manual pull-to-refresh as a backstop.

Defer Supabase Realtime for now because:

- The mobile app does not write directly to Supabase.
- Current auth model uses Dayframe app sessions, not Supabase client sessions in mobile API calls.
- Realtime auth/RLS/channel setup adds complexity before core start/stop is stable.
- Polling with optimistic local state is enough for a single-user personal tracker MVP.

Revisit Realtime later for multi-device live sync once timer correctness and hosted migrations are boring.

## 9. Proposed iOS Information Architecture

Use Expo Router to separate primary work from settings/admin work.

Recommended structure:

- Dashboard: first screen, timer-first.
- Settings: separate screen or modal route.
- Onboarding: first-run/permission education, skippable and revisitable.
- Review: optional later screen if mobile review becomes important.

Dashboard should contain:

- App header with logo/name and a compact settings icon/button.
- Active timer card.
- Start task card.
- Today summary card.
- Optional tiny queued/sync indicator only if something needs attention.

Settings should contain:

- Profile and account.
- Appearance.
- Categories.
- Sync.
- Permissions.
- Health data.
- Location.
- Account actions, including logout.

Do not keep settings sections at the bottom of the dashboard.

## 10. Proposed Dashboard Design

Target first screen hierarchy:

1. Header
   - Logo/name left.
   - Settings/profile icon right.
   - No sync text, mobile capture text, or logout in header.
2. Active timer
   - If no active timer: compact state, "No timer", short helper.
   - If active: task title or category, elapsed time, stop button, optional edit affordance.
3. Start task
   - Compact task input.
   - Small category chips in one horizontal row or two-row wrap.
   - Circular play/start button or compact icon+label action.
   - Title optional.
   - Category optional.
4. Today
   - Visible in the first viewport on common iPhones.
   - Zero state should not show a full donut with `0m` and `100%` category.
   - If no tracked time: use a compact empty state and total `0m`.
   - If active timer exists: include live elapsed contribution.

Remove the separate Quick categories section. Fold pinned/most-used category chips into Start task, or allow a quick-tap mode if approved.

## 11. Proposed Settings Design

Settings should be a focused utility screen, not a dashboard continuation.

Recommended sections:

- Profile
  - Name/email/workspace summary.
  - Logout.
- Appearance
  - System / Light / Dark segmented control.
- Categories
  - Existing categories.
  - Pin/unpin.
  - Create category.
  - Edit/archive later if approved.
- Sync
  - Queue count.
  - Last sync if available.
  - Sync now.
- Permissions
  - Location row.
  - Health data row.
- Health data
  - Connection state.
  - Last sync counts.
  - Sync now.
- Location
  - Foreground/background states.
  - Open Settings when native permission cannot be prompted again.

Implementation should use reusable settings components so future sections do not become one-off rows.

## 12. Health Data UX Plan

User-facing language:

- Use "Health data", "Apple Health", "Connect Apple Health", and "Sleep and workouts".
- Do not expose implementation terms in ordinary UI.
- Native usage strings may still mention the platform capability where iOS requires it.

Recommended flow:

- One primary button: "Connect Apple Health".
- Request sleep and workout read permissions together if product confirms.
- After permission is requested, automatically import sleep and workouts once.
- Provide a secondary "Sync now" action after connection.
- Show friendly states:
  - Not connected.
  - Ready to connect.
  - Connected.
  - Syncing.
  - Last synced with counts.
  - Needs iPhone/native build.
  - Access denied, open iOS Settings.
  - Unable to sync, try again.

Technical findings:

- Current library supports `requestAuthorization({ toRead: [...] })`, so sleep and workout read types can be requested in one call.
- Current import functions already use anchors for sleep and workouts.
- Workout metadata is already filtered to remove route/location/latitude/longitude-like keys before queueing.
- Current code stores workout rows through event-first sync plus `health_workouts` audit rows.

Implementation questions:

- Should sleep and workout be one combined permission, or separate toggles for privacy clarity?
- Should sync happen automatically immediately after connecting?
- Should recurring health sync happen only on app foreground for MVP, or also via background delivery later?

## 13. Location UX Plan

Location should be handled in onboarding/settings, not dashboard content.

Recommended state model:

- Checking.
- Unavailable.
- Not requested.
- Foreground prompt available.
- Foreground granted.
- Background prompt available.
- Always allowed.
- Reduced accuracy.
- Denied but can ask again.
- Denied and needs iOS Settings.

Recommended flow:

1. Ask for foreground location first.
2. Explain why background/Always is useful.
3. Ask for background/Always only after user intent.
4. If `canAskAgain` is false, show "Open Settings".
5. If foreground is granted but background is not, do not show generic "denied"; say what is actually allowed.

Current repair need:

- Replace a single status string with structured location status.
- Avoid row layouts where long copy and a button can push controls off-screen.

## 14. Compact Category And Start UX

Categories should act like quick classification, not like large project tiles.

Recommended component behavior:

- Use compact chips with color dot/swatch, category name, and selected state.
- Minimum touch size should be 44px high where practical.
- Prefer horizontal scroll or a two-row wrap with stable chip dimensions.
- Order chips by pinned first, then most-used/recent, then alphabetical fallback.
- Include an "Uncategorized" or "No category" option only if product wants it explicit.
- Let category be added/changed while timer is running.

Open behavior choice:

- Option A: tapping a category only selects it; play starts the timer.
- Option B: tapping a pinned category starts immediately when the task field is empty.
- Option C: long press or secondary play icon starts immediately.

Recommendation: start with Option A for clarity, then add quick-start affordance if the first-screen flow feels too slow.

## 15. Component System Proposal

Refactor from one large HomeScreen into small mobile components.

Suggested components:

- `AppHeader`
- `IconButton`
- `Card`
- `TimerCard`
- `StartTaskCard`
- `CategoryChip`
- `TodaySummaryCard`
- `SegmentedControl`
- `SettingsScreen`
- `SettingsSection`
- `SettingsRow`
- `PermissionRow`
- `SyncStatusRow`
- `HealthDataSettings`
- `LocationSettings`
- `EmptyState`

Data/state hooks to consider:

- `useMobileBootstrap`
- `useMobileTimerActions`
- `useOfflineQueue`
- `useHealthData`
- `useLocationPermission`
- `useThemePreference`

Icon note:

- Web has `lucide-react`.
- Mobile currently has `react-native-svg` but no `lucide-react-native` or Expo vector icon dependency.
- Before implementation, decide whether to add `lucide-react-native` for settings/play/stop icons, or keep text-only controls for this pass.

## 16. Web/Mobile Consistency Plan

Keep these concepts consistent:

- Primary user-facing model: task/description plus optional category.
- Starting a timer never requires a project.
- Category colors use the shared palette.
- Active timer labels use category/task before legacy project/client data.
- Today summaries prioritize category and source/place over legacy project/client.
- Permission and sync copy is friendly and product-level.

Web cleanup to inspect after mobile repair:

- Entry edit forms that still require or foreground project.
- Timeline labels that show project/client before category.
- Reports that still prioritize legacy breakdowns.
- Settings copy that uses technical health language.
- Deep-link/shortcut start path that still requires project id.

## 17. Legacy Third-Party Timer-Brand Removal Strategy

Do not reintroduce legacy third-party timer-brand language in product copy, docs, seeds, tests, scripts, env vars, or UI.

Implementation strategy:

- Keep generic external import infrastructure only if it is provider-agnostic and useful later.
- Do not add brand-specific integration hooks unless product explicitly reintroduces them.
- Validate with a hidden repository search before signoff.
- Avoid putting the literal legacy brand terms into new committed docs unless the file is explicitly documenting a removal checklist.

Preferred product copy:

- "manual timer"
- "task tracking"
- "time entries"
- "activity events"
- "imports" only when generic

## 18. Projects/Clients Compatibility Plan

Current product direction says projects/clients are legacy/internal compatibility.

Recommended near-term behavior:

- Keep DB columns and existing data.
- Keep API compatibility for legacy fields.
- Do not require a project for any start/manual timer flow.
- Convert existing project names into categories only through an approved, additive migration.
- Hide or demote project/client controls in primary mobile UI.
- On web, prioritize categories and keep legacy project/client views only where needed for old data.

Questions before implementation:

- Should old projects remain visible anywhere in web navigation?
- Should project/client reports remain as "legacy" sections, or be hidden behind an advanced/compatibility area?
- Should deep links with only `categoryId` be valid start links?
- Should category edit/archive/reorder ship now, or only create/pin?

## 19. iOS-Only Recommendation

MVP should remain iOS-only.

Current state:

- Mobile native config is iOS-focused.
- `apps/mobile/app.json` has an iOS bundle identifier and no checked non-iOS native project.
- EAS profiles are under `apps/mobile/eas.json`.
- Shared React Native code can still technically run in other environments, but product/support posture should be iOS-only.

Recommendation:

- Keep iOS-only copy and docs.
- Do not add non-iOS permission states or support promises.
- Keep platform guards for safety in tests/dev, but show "iOS native build required" rather than treating other platforms as supported.

## 20. Repo Impact Map

Expected implementation files after plan approval:

- Split/refactor:
  - `apps/mobile/app/index.tsx`
  - likely new `apps/mobile/app/settings.tsx`
  - likely new `apps/mobile/app/onboarding.tsx` later
  - likely new `apps/mobile/src/components/*`
  - likely new `apps/mobile/src/hooks/*`
- Timer repair:
  - `apps/mobile/src/lib/api.ts`
  - `apps/mobile/app/index.tsx` or new timer hook/components
  - `apps/mobile/src/lib/deepLinks.ts`
  - `apps/web/src/lib/event-service.ts` if service-level test exposes a gap
  - `apps/web/src/app/api/time-entries/route.ts` only if contract changes
- Health/location:
  - `apps/mobile/src/lib/health.ts`
  - `apps/mobile/src/lib/geofence.ts`
  - `apps/mobile/app.json` only if usage strings need copy changes
- Tests:
  - `apps/mobile/src/lib/api.test.ts`
  - `apps/mobile/src/lib/health.test.ts`
  - add tests for mobile state helpers if extracted
  - `apps/web/src/app/api/time-entries/route.test.ts`
  - add service/db tests if practical
- Docs/reference after implementation:
  - `docs/dayframe-regression-checklist.md`
  - `.codex/reference/components.md`
  - `.codex/reference/mobile-permissions.md`
  - `.codex/reference/testing.md`

## 21. Data And Migration Risks

Known safe columns/migrations already exist in this branch:

- activity event idempotency.
- workout audit columns.
- category pin column and index.
- project-to-category backfill.

Risks before future implementation:

- Hosted Supabase may not have all migrations applied even if repo has them.
- Category edit/archive/reorder may require new columns or API behavior.
- Deep-link category-only starts may need schema and test updates but likely no DB migration.
- Health sync cadence/background delivery may require native config or plugin capability checks.
- Dropping or hiding projects/clients too aggressively can strand old data in reports/entries.
- Any permission refactor must avoid losing background geofence registration.

Migration posture:

- Prefer additive changes.
- Do not drop legacy project/client columns.
- Do not delete imported or historical data.
- Add hosted schema checks before deployment.

## 22. Tests And Validation Plan

Automated commands after implementation:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run typecheck -w @dayframe/mobile
npm run test -w @dayframe/mobile
```

Focused tests to add or update:

- Mobile direct start success.
- Mobile direct start failure with explicit queued state.
- Mobile stop success and queued fallback.
- Queue sync sends `clientEventId`.
- Queue duplicate response clears event safely.
- Server start accepts no project.
- Server manual entry accepts no project.
- Deep-link start accepts category-only if approved.
- Health workout payload strips route/location-like metadata.
- Combined health authorization status mapping if implemented.
- Location permission state reducer.
- Today zero-state summary helper.

Manual validation:

- iPhone simulator dashboard at 390x844 and 430x932.
- Settings screen at 390x844 and 430x932.
- No horizontal overflow, clipped action buttons, or hidden logout.
- Mobile login against hosted API.
- Mobile start appears on web.
- Web stop appears on mobile within the expected sync window.
- Mobile offline start/stop queues clearly and syncs later.
- Health data states on native build.
- Physical iPhone Health data permission and import.
- Location foreground/background states on native build.
- Pull-to-refresh and app foreground refresh.

Hosted validation:

- Confirm deployed Vercel commit.
- Confirm Supabase columns/indexes.
- Confirm `DATABASE_URL` pooler URL behavior.
- Confirm EAS preview/production use Vercel API base.
- Confirm production/native build does not fall back to localhost.

## 23. Proposed Implementation Phases

Phase 1: Reproduce and repair mobile start.

- Capture exact mobile direct start response.
- Verify hosted schema and deployed Vercel commit.
- Make failures visible.
- Tighten timer sync refresh behavior.
- Add direct and queued timer regression tests.

Phase 2: Split dashboard and settings IA.

- Introduce Settings route/screen.
- Remove permission/profile/sync/settings content from dashboard.
- Add settings entry in header.
- Keep logout in profile/settings.
- Preserve all existing functionality behind the new route.

Phase 3: Redesign dashboard components.

- Compact header.
- Timer card.
- Start task card with category chips and play action.
- Today summary with proper zero state.
- Remove separate quick category cards.

Phase 4: Permission UX refinement.

- Health data connection flow.
- Location structured states.
- Friendly copy and Settings handoff.
- Native-device validation.

Phase 5: Web/mobile consistency cleanup.

- Deep-link category-first support.
- Demote legacy project/client UI where safe.
- Sweep user-facing copy.
- Update docs/reference/checklists based on what actually shipped.

## 24. Plan File Name And Outline

This plan lives at:

```text
.codex/plans/ios-ux-reset-and-mobile-timer-repair.md
```

It should be the source for the next execute step after approval. The implementation should not combine all phases into one large unreviewable change. Phase 1 should land as the first atomic repair.

## 25. Clarifying Questions Before Implementation

Timer and start behavior:

1. When mobile start fails, do you want the UI to immediately show a queued timer as running, or show a separate "queued start" status until sync confirms?
2. Should tapping a category chip start immediately, or only select the category before pressing play?
3. Should an uncategorized timer be a visible option, or should the app silently use no category when none is selected?
4. Should the active timer card allow editing task/category while running in this phase?
5. Is a 2 to 5 second foreground sync window acceptable for web-to-mobile stop visibility, or do you want true realtime sooner?

Dashboard and settings:

6. Should Settings be a pushed full screen, a modal sheet, or a tab-like route?
7. Should Today show a donut only after there is tracked time, or always show a tiny empty chart?
8. Should Review count be visible on the dashboard, or only in Settings/Review?
9. Are category chips enough for quick actions, or do you still want a separate "start now" affordance for pinned categories?

Health data:

10. Should "Connect Apple Health" request sleep and workouts together?
11. After connecting, should the app auto-sync immediately?
12. For MVP, should health imports sync only on manual/foreground actions, or should I plan background delivery now?

Location:

13. Should onboarding ask for foreground location only first, then ask for Always later from Settings?
14. Should location onboarding be skippable?
15. Should "Always" access be required for place automation, or should foreground-only still provide limited suggestions?

Categories and compatibility:

16. Should category edit/archive/reorder ship in this pass, or only create/pin/use?
17. Should old projects remain visible anywhere on web for now?
18. Should Shortcuts/deep links be updated so `categoryId` alone can start a task?

Dependencies:

19. May I add `lucide-react-native` for iOS icon buttons, matching the web icon family, or should I avoid new dependencies in this pass?

## 26. Meta Reasoning And Rule Updates To Consider Later

After implementation, consider updating repo guidance with these more specific rules:

- iOS dashboard changes require an IA check: dashboard, settings, onboarding, or review.
- Settings/permission content must not be appended to dashboard as a shortcut.
- Health data UI must use product language externally and reserve native implementation terms for code/native usage strings.
- Mobile timer changes must include direct API and queued fallback regression tests.
- Deep-link/shortcut start behavior is part of the timer regression matrix.
- Any hosted deploy signoff must include Supabase schema checks and Vercel commit confirmation.
- Mobile visual QA should include dashboard top, Today card, Settings top, Settings permissions, and long permission copy on 390x844 and 430x932.

The key product judgment: make the iOS app feel like a calm daily time tool first, and treat permissions/sync/admin as supporting systems that are easy to reach but never allowed to crowd the main timer.
