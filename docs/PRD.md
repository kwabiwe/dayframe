# Dayframe Product Requirements Document

## 1. Executive Summary

Dayframe is a category-first personal time tracker for iOS and web. The core user-facing model is simple:

- Task title or description
- Category
- Timer
- Review and edit

The product should make it fast to start a task, keep the active timer in sync across web and iOS, and turn mobile context from location, Apple Health, shortcuts, NFC-style actions, and offline usage into reviewable activity events. Ambiguous signals must stay reviewable until the user accepts, edits, or ignores them.

Dayframe is not a team billing tool. Clients and projects are not normal user-facing concepts. Existing client/project data may exist as legacy compatibility or migration input, but new product surfaces should prioritize categories, tasks, timers, daily summaries, and review.

## 2. Mission

Dayframe helps people understand where their time goes by combining intentional timers with privacy-conscious automatic context.

Core principles:

- Category-first: categories are the primary organizing concept.
- Task-first capture: titles and descriptions add context, but starting a timer should stay fast.
- Event-first: raw signals become `activity_events` before they become `time_entries`.
- Reviewable automation: trusted explicit actions may create entries immediately; uncertain signals become review items.
- Personal by default: optimize for one person's productivity, not team billing, approvals, seats, or invoices.
- Privacy by design: health and precise location data must be minimized, scoped, exportable, and deletable.
- Offline resilient: iOS capture should survive hours or days without a network connection.

## 3. Target Users

Primary users:

- Personal productivity user: wants a faithful record of focused work, admin, exercise, sleep, walks, chores, and recurring routines.
- Early tester/friend: accepts a beta tool but expects login, sync, timer control, and editing to be reliable.
- Quantified-self user: wants location and Apple Health summaries to enrich time tracking without manually entering everything.

Key needs:

- Start a task quickly from iOS or web.
- Add or change category and description while a timer is running.
- See today's time distribution without opening configuration screens.
- Review and correct automatic suggestions before they become trusted records.
- Keep health and location permissions understandable and out of the primary dashboard flow.

## 4. MVP Scope

### In Scope

Core product:

- Web and iOS manual timer start/stop with live active timer sync.
- Optional task title/description and optional category on timers and time entries.
- Category create, edit, archive, reorder, pin, color, and use flows.
- Compact category quick actions based on pinned and most-used categories.
- Active timer editing while the timer is running.
- Review/edit flow for time entries and automatic suggestions.
- Today chart/summary as a primary dashboard element.
- Calendar, List, Timesheet, and Reports on web where they help review and correction.

iOS dashboard:

- Header.
- Active timer.
- Start task.
- Compact category chips.
- Today chart/summary.

iOS settings and onboarding:

- Theme selection with immediate light/dark/system application.
- Profile/account controls and logout.
- Category management details that do not fit safely on the dashboard.
- Location permission setup.
- Apple Health permission setup and sync status.
- Device sync status and queued event controls.

Signals and automation:

- Trusted-place auto-start only when explicitly configured.
- Broad, unknown, or Home-like location signals go to review by default.
- Apple Health sleep and workout/walking summaries.
- Offline mobile queue with idempotent sync.
- Shortcut/NFC-style event capture through the event queue.

Hosted production:

- Vercel-hosted Next.js web app and API routes.
- Supabase Postgres as production database.
- Supabase Auth as production identity provider.
- Dayframe app sessions for web cookies and mobile bearer auth.
- Signup allowlist for personal/friends beta.

### Out of Scope

- Team time tracking, approvals, seats, roles, invoices, billing, or public SaaS workflows.
- Non-iOS mobile support.
- App Store optimization/review as an MVP blocker.
- Full calendar integration as a required MVP feature.
- AI classification as a required MVP feature.
- Native push notification system beyond basic local reminders or future hooks.
- Normal user-facing clients or projects.

## 5. User Stories

1. As a personal productivity user, I want to start a task from iOS or web, so that tracking does not interrupt my work.
   - Example: Tap a pinned "Writing" category chip and immediately queue/start the task.

2. As a user adding context, I want task title and category to be optional, so that I can start now and clean up details later.
   - Example: Start a timer with only "Draft PRD", then add category "Work" while it is running.

3. As a mobile user, I want a focused dashboard, so that the first screen helps me track today instead of manage settings.
   - Example: The dashboard shows header, active timer, start task, category chips, and Today summary only.

4. As a user reviewing time, I want reviewable items to be visible from the Today summary, so that suggested time can be edited before it becomes trusted.
   - Example: Tap a review count in Today and edit a walking suggestion.

5. As an iOS user, I want Apple Health sleep and workout summaries imported, so that health activity can appear in my day timeline.
   - Example: A morning walk becomes a high-confidence review item without route metadata.

6. As a privacy-conscious user, I want location and health permissions in onboarding/settings, so that I understand what is enabled without cluttering the timer dashboard.

7. As a mobile user, I want offline actions to sync later, so that timers and captured events are not lost when the network is unavailable.

8. As the product owner, I want anonymized automation accuracy metrics, so that automatic rules can improve without collecting unnecessary personal detail.

## 6. Core Architecture And Patterns

High-level architecture:

- `apps/mobile`: Expo/React Native iOS app for manual timers, category quick actions, settings, geofences, Apple Health import, offline queue, and sync.
- `apps/web`: Next.js App Router web app and API routes for timer, review, reporting, category management, and auth.
- `packages/shared`: shared schemas, event normalization, palette/types, and state-machine behavior.
- `packages/db`: Postgres/PostGIS migrations, seed/setup scripts, and export utilities.
- `supabase/migrations`: hosted Supabase-specific RLS and production migrations.

Key patterns:

- Event-first ingestion: every signal becomes `activity_events`.
- Derived entries: `time_entries` are created from explicit or trusted high-confidence events.
- Review-first ambiguity: uncertain signals become `review_items`.
- Workspace scoping: every user data table is scoped by workspace and protected through app session checks and Supabase RLS.
- Mobile offline queue: iOS writes local queued events, then syncs to the API when available.
- Hosted-safe API configuration: mobile uses `EXPO_PUBLIC_DAYFRAME_API_BASE` for the Dayframe API, never direct Supabase table access.

## 7. Core Features

Manual timer:

- Start/stop from web and iOS.
- Live ticking duration.
- Separate queued/starting state until mobile start is confirmed by the server.
- Optional task title/description.
- Optional category selection and editing while running.
- Active timer sync across web and iOS within the foreground polling window.

Category model:

- Categories are the primary grouping and color source.
- Category chips are compact, pill-shaped, color-coded, and dashboard-safe.
- Category quick actions include pinned and most-used categories.
- Category management supports create, edit, archive, reorder, pin, and use.
- Historical client/project data should be migrated, hidden, or demoted behind compatibility tooling rather than becoming normal UX.

Today dashboard:

- Header.
- Active timer card.
- Start task card.
- Compact category chips.
- Today chart/summary.
- Clean zero-state chart when no tracked time exists.
- Reviewable item count included in Today summary and tappable for edit/review.

Settings:

- Pushed screen from a top-right settings/menu icon.
- Profile/account and logout.
- Theme selection: system, light, dark, applied immediately across the mobile app.
- Category management details.
- Device sync and queued event controls.
- Location and Apple Health permission controls.

Review and editing:

- Review items explain source, confidence, and suggested action.
- Users can edit category, title/description, start/stop time, place, and source context where appropriate.
- Deleting or ignoring suggestions must not delete unrelated raw events without an explicit data deletion action.

Privacy/data controls:

- Export workspace data.
- Delete time entries.
- Future full account/workspace deletion must hard-delete raw location and health payloads.
- Health workout payloads must strip route/location-like metadata before upload.

## 8. Technology Stack

Web:

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- `pg`
- `@supabase/supabase-js`
- Zod

Mobile:

- Expo
- React Native
- Expo Router
- Expo SecureStore
- AsyncStorage
- Expo Location / Task Manager
- Native Apple Health bridge
- `lucide-react-native` for consistent accessible icon buttons

Database/infrastructure:

- Supabase Postgres with PostGIS
- Supabase Auth
- Vercel web/API hosting
- npm workspaces monorepo

## 9. Security And Configuration

Authentication:

- Production uses `DAYFRAME_AUTH_MODE=provider`.
- Supabase Auth verifies identity and passwords.
- Dayframe provisions a matching app user/workspace and issues a Dayframe session token.
- Web stores the app token in an HTTP-only `dayframe_session` cookie.
- Mobile stores the app token in SecureStore and sends it as a bearer token.

Authorization:

- API routes resolve a `RequestSession`.
- Data is scoped by `workspace_id` and `user_id`.
- Supabase RLS policies mirror workspace membership as defense-in-depth.
- Integration tokens are separate from user sessions.

Required hosted environment variables:

```bash
DAYFRAME_AUTH_MODE=provider
DATABASE_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
DAYFRAME_ALLOWED_SIGNUP_EMAILS=you@example.com,friend@example.com
DAYFRAME_SIGNUPS_ENABLED=false
EXPO_PUBLIC_DAYFRAME_API_BASE=https://your-vercel-domain.vercel.app
```

Hosted database setup:

- Run `packages/db/migrations/001_init.sql` first.
- Then run every migration in `supabase/migrations/` in timestamp order.
- Keep `DATABASE_URL` aligned with the Supabase pooler URL that works in Vercel; do not require `?sslmode=require`.

## 10. API Requirements

Authentication:

- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Core app:

- `GET /api/bootstrap`
  - Returns active timer, entries, categories, places, review items, stats, dashboard data, settings data, and sync status needed by current web/iOS clients.

- `POST /api/time-entries`
  - Modes: start, stop, manual entry creation.
  - Must support category/task-first starts without client/project input.
  - Mobile may send `source: "mobile_app"`.

- `PATCH /api/time-entries/:id`
  - Edits category, place, title/description, start, stop, and review status.

- `DELETE /api/time-entries/:id`
  - Deletes an entry.

- `POST /api/events`
  - Ingests mobile, geofence, Apple Health, shortcut, NFC-style, and offline queued events.
  - Requires app bearer/cookie session or scoped ingest token.
  - Supports `clientEventId` idempotency for offline queue dedupe.

- `POST /api/review/:id`
  - Accept, edit, ignore, or create rule from review item.

- `GET /api/export`
  - Supports workspace JSON and time-entry exports.

Example event payload:

```json
{
  "source": "health_workout",
  "type": "health_workout_import",
  "clientEventId": "ios-2026-07-03-workout-0830",
  "occurredAt": "2026-07-03T08:30:00.000Z",
  "description": "Outdoor walk",
  "rawPayload": {
    "provider": "apple_health",
    "workoutType": "walking",
    "startedAt": "2026-07-03T08:30:00.000Z",
    "stoppedAt": "2026-07-03T09:10:00.000Z",
    "durationMinutes": 40
  }
}
```

## 11. Success Criteria

MVP success definition:

Dayframe is useful as the owner's daily personal tracker for at least two continuous weeks, with web/iOS manual tracking, Apple Health sleep/walk/workout capture, trusted-place automation, review correction, hosted login, and sync working reliably.

Functional requirements:

- User can sign up/log in through hosted Supabase Auth.
- Only allowlisted beta users can create accounts.
- Web and iOS share active timer state.
- Mobile can queue events offline and sync later without duplicates.
- Timer start/stop works on web and mobile.
- Trusted places can auto-start entries only when explicitly configured.
- Ambiguous location events appear in review.
- Apple Health sleep and workouts/walks appear as time entries or high-confidence review items.
- User can edit/delete entries.
- User can export data.
- Hosted deployment works on Vercel with Supabase database.

Quality indicators:

- No runtime error overlays during normal navigation.
- No React key/hydration warnings.
- Production build passes.
- Mobile typecheck/build path remains healthy.
- Sensitive raw data is not sent to analytics.
- UI changes have manual simulator/browser validation notes, not only lint/typecheck results.

User experience goals:

- Timer start/stop feels immediate.
- Mobile queued starts show a queued/starting state until confirmed by the server.
- Category chips are fast and safe to tap.
- Today summary is visible before settings/configuration content.
- Review items explain why they exist.
- Corrections are faster than manual re-entry.

## 12. Implementation Phases

### Phase 1: Hosted Auth And Deployment

Goal: make Dayframe accessible on Vercel with Supabase Auth.

Deliverables:

- Supabase Auth provider mode.
- Signup allowlist.
- Supabase RLS migrations.
- Vercel/Supabase hosting documentation.
- Hosted environment variable setup.

Validation:

- Login/signup work on Vercel.
- `/api/auth/me` resolves hosted user/workspace.
- Mobile can log in against hosted API.
- All `supabase/migrations` files have run in timestamp order after the base schema.

### Phase 2: Reliable Timer Sync And Offline Mobile

Goal: make web/iOS timer state reliable.

Deliverables:

- Active timer sync path.
- Mobile queued/starting state.
- Offline event queue reconciliation.
- `clientEventId` dedupe.
- Conflict handling for start/stop/switch events.
- Retry and auth-expiry behavior.

Validation:

- Start on mobile appears on web.
- Stop on web appears on mobile.
- Start on web appears on mobile.
- Stop on mobile appears on web.
- Offline mobile events sync in order after reconnect.

### Phase 3: Category-First Daily Workflow

Goal: make the primary flow comfortable for daily use.

Deliverables:

- Focused mobile dashboard.
- Compact category chips.
- Category create/edit/archive/reorder/pin/use.
- Active timer editing while running.
- Today chart zero-state and reviewable item access.
- Separate Settings screen.
- Immediate theme application.

Validation:

- Mobile dashboard order is header, active timer, start task, category chips, Today chart/summary.
- No settings, permission cards, logout button, or sync chrome on the dashboard.
- Theme changes apply immediately across the mobile app.
- No clipped/off-screen controls in simulator.

### Phase 4: Health, Location, And Review

Goal: turn iOS signals into useful personal time records.

Deliverables:

- Apple Health sleep summary import.
- Apple Health walking/workout summary import.
- Route/location-like workout metadata stripped before upload.
- Trusted-place auto-start.
- Broad/unknown geofence review suggestions.
- Deletion/export path for sensitive data.

Validation:

- Sleep appears with correct duration/time window.
- Walking/workout entries have correct duration.
- Health permissions live in onboarding/settings.
- Trusted place starts correctly.
- Unknown/broad places do not create silent incorrect entries.

### Phase 5: Product Polish And Beta Hardening

Goal: make the product comfortable for personal/friends beta use.

Deliverables:

- Review inbox improvements.
- Reports and automation accuracy metrics.
- Settings for permissions, retention, and export/delete.
- TestFlight/sideload build workflow.

Validation:

- Owner can use Dayframe for two weeks without data loss.
- Friends can sign in and test without developer help.
- Accuracy metrics show accepted/ignored suggestion rates without raw sensitive payloads.

## 13. Future Considerations

- Calendar integration for work meeting hints.
- Home Assistant/local bridge integrations.
- Realtime sync through Supabase Realtime/WebSocket/SSE.
- More advanced rule learning from accepted/ignored suggestions.
- Account deletion UI with full raw health/location deletion.
- App Store release if sideloading is no longer sufficient.

## 14. Risks And Mitigations

1. Health/location privacy risk.
   - Mitigation: minimize raw payloads, strip workout route/location-like metadata, document retention, add export/delete controls, and avoid sensitive analytics payloads.

2. False automation risk.
   - Mitigation: auto-start trusted places only; route broad, unknown, and Home-like signals through review.

3. Background location reliability risk.
   - Mitigation: rely on iOS geofencing constraints, cap monitored regions, expose sync/review status, and avoid promising perfect tracking.

4. Hosted auth/data isolation risk.
   - Mitigation: Supabase Auth, signup allowlist, Dayframe session scoping, RLS migrations, and workspace membership checks.

5. Offline conflict risk.
   - Mitigation: keep event timestamps, process events transactionally, dedupe by `clientEventId`, close prior active timers on explicit starts, and surface ambiguous conflicts in review.

6. Product drift risk.
   - Mitigation: keep PRD, AGENTS, reference docs, regression checklist, and commit prompt aligned after every discovered drift.

## 15. Appendix

Related documents:

- `README.md`
- `docs/production-readiness.md`
- `docs/vercel-supabase-hosting.md`
- `docs/ios-hosted-supabase-runbook.md`
- `docs/dayframe-regression-checklist.md`

Key repository structure:

```text
apps/web       Next.js web app and API routes
apps/mobile    Expo iOS mobile app
packages/db    Postgres/PostGIS migrations and scripts
packages/shared shared schemas, types, event normalization
supabase       hosted Supabase migrations
```

Important assumptions:

- The first hosted version is personal/friends beta, not public SaaS.
- iOS is the only mobile platform for MVP.
- Supabase email confirmation may be disabled initially for easier sideload/beta testing.
- Apple Health summaries are sufficient for MVP; raw detailed samples should be minimized.
- Precise location can be stored for geotracking but must be fully deletable.
