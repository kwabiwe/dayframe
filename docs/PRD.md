# Dayframe Product Requirements Document

## 1. Executive Summary

Dayframe is a personal time-intelligence product that combines manual task tracking with privacy-conscious automatic activity capture. It has two interfaces: an iOS mobile app that can read location and HealthKit signals, and a web app for timer control, review, reporting, category management, and longer-form analysis.

The core value proposition is to reduce manual time-tracking friction without losing user trust. Dayframe should capture manual timer actions, trusted-place automation, HealthKit sleep/workout summaries, and mobile offline activity signals, then sync them into a clear web/mobile timeline. Ambiguous or low-confidence signals should be reviewable instead of silently becoming incorrect time entries.

The MVP goal is to make Dayframe reliable for personal use and a small friends beta: hosted on Vercel, backed by Supabase Postgres/Auth, iOS-only for mobile, offline-capable for hours or days, and privacy-conscious around health and precise location data.

Current reality as of 2026-07-19: Dayframe is in an active internal TestFlight lane, with build `0.1.0 (57)` verified for KB testing after PR #84. Reusable Tags now span hosted storage, web/API, offline-capable mobile entry, native Calendar presentation, clean Description/tag state separation, a mobile `Add a tag` shortcut, a web tag picker, higher-contrast mobile autocomplete, solid tag iconography, and draft-only tap-to-remove editing, and remain under physical-device/authenticated-browser Watch. The native SwiftUI Calendar surface also remains under physical-device Watch for pinch smoothness, taps, accessibility settings, and frame pacing. The tracker in `docs/feature-fix-tracker.md` is the source of truth for what is `Done`, still under `Watch`, or planned next.

## 2. Mission

Dayframe helps people understand where their time goes by combining intentional timers with privacy-conscious automatic context from location and health signals.

Core principles:

- Trust first: automatic tracking must be explainable, editable, and easy to correct.
- Event-first: raw signals become activity events before they become time entries.
- Personal by default: optimize for one person's productivity, not team billing.
- Privacy by design: granular health and location data must be scoped, exportable, and fully deletable.
- Offline resilient: mobile capture should work when the network is unavailable.

## 3. Target Users

Primary users:

- Personal productivity user: wants a faithful record of focused work, admin, exercise, sleep, walks, chores, and recurring routines.
- Early tester/friend: accepts a beta-quality tool but expects login, sync, and editing to be reliable.
- Quantified-self user: wants location and HealthKit summaries to enrich time tracking without manually entering everything.

Technical comfort level:

- Primary user is technically comfortable enough to sideload an iOS app and configure hosted services during early use.
- Future testers should only need a hosted web URL and an iOS build/invite.

Key needs and pain points:

- Manual time tracking is easy to forget.
- Location apps show where time went but not task/category context.
- Health apps show sleep/workouts but do not connect that data to a productivity timeline.
- Fully automatic time tracking can be wrong, so corrections and review matter.

## 4. MVP Scope

### In Scope

Core Functionality:

- ✅ Web and mobile manual timer start/stop with live active timer sync.
- ✅ Description, category, place, source, confidence, and review status on time entries.
- ✅ Calendar, List, and Timesheet review views.
- ✅ Review inbox for ambiguous geofence/health/location suggestions.
- ✅ Auto-start for trusted places only.
- ✅ Conservative suggestions for broad/ambiguous places.
- ✅ HealthKit summaries for sleep and workouts/walks as automatic entries or reviewable high-confidence events, with real-device background behavior and mapping defaults still watched after TestFlight validation.
- ⚠️ Mobile offline queue exists, but failed-queue recovery, diagnostics, retry visibility, and conflict recovery still need hardening.
- ⚠️ Time-entry edit/delete/export paths exist, but full account/workspace deletion and stronger privacy controls for raw Health/location payloads remain future work.

Technical:

- ✅ Vercel-hosted web app and API routes.
- ✅ Supabase Postgres as production database.
- ✅ Supabase Auth as production identity provider.
- ✅ Dayframe app session token for web cookie and mobile bearer auth.
- ✅ Postgres/PostGIS schema for places, geofences, activity events, and time entries.
- ✅ Signup allowlist for personal/friends beta.

Integration:

- ✅ iOS HealthKit sleep and walking/workout summaries.
- ✅ iOS geofence monitoring for known places.
- ✅ Anonymized automation accuracy analytics.

Deployment:

- ✅ Hosted SaaS direction.
- ✅ No App Store requirement for MVP; the current lane is internal TestFlight.
- ✅ No monetization or billing.

### Out of Scope

- ❌ Team time tracking, approvals, seats, roles, or billable SaaS workflows.
- ❌ Non-iOS mobile support.
- ❌ App Store optimization/review as a launch blocker.
- ❌ Billing/subscriptions.
- ❌ Full calendar integration.
- ❌ AI classification as a required MVP feature.
- ❌ Native push notification system beyond basic local reminders or future hooks.

## 5. User Stories

1. As a personal productivity user, I want to start a timer from web or mobile, so that I can track focused work without switching tools.
   - Example: Start "Deep Work" on mobile, see the same active timer ticking on web.

2. As a user entering work context, I want to type an optional task description and choose an optional category, so that the final time entry has useful context.
   - Example: Type "Draft Supabase auth plan", choose "Work", stop timer later, and keep that description.

3. As a user moving between trusted places, I want Dayframe to auto-start known activities only for trusted locations, so that routine places save effort without creating noisy entries.
   - Example: Arriving at Gym starts a Gym/Health entry if explicitly configured as trusted.

4. As a privacy-conscious user, I want ambiguous location signals to become review items, so that Dayframe does not silently guess wrong.
   - Example: Town Centre creates a "Review visit" item instead of auto-starting.

5. As an iOS user, I want sleep and walk/workout summaries imported from HealthKit, so that health activity appears in my day timeline.
   - Example: Sleep from 23:20 to 06:45 creates a Sleep entry or high-confidence review item.

6. As a mobile user, I want offline capture to sync later, so that timers and geofence/health events are not lost when the network is unavailable.
   - Example: A walk captured offline syncs when the phone reconnects.

7. As a user reviewing time, I want Calendar, List, and Timesheet views, so that I can edit precise entries and understand daily/weekly totals.
   - Example: Resize/edit a time block, delete an accidental entry, and review weekly totals by category.

8. As the product owner, I want anonymized automation accuracy metrics, so that I can improve rules without collecting unnecessary personal detail.
   - Example: Track accepted vs ignored suggestions by source type, not raw coordinates.

9. As an iOS user, I want navigation, gestures, sheets, list changes, and action feedback to transition consistently, so that every state change feels connected and understandable rather than jumpy.
   - Example: Swiping to delete an entry moves continuously into an animated list reflow and Undo state, including dismissal, restoration, failure, and Reduce Motion behaviour.

## 6. Core Architecture & Patterns

High-level architecture:

- `apps/mobile`: Expo/React Native iOS app for manual timers, geofences, HealthKit import, offline queue, and sync, with targeted Swift/SwiftUI native modules where a platform interaction needs native ownership.
- `apps/web`: Next.js App Router web app and API routes for timer/review/reporting/auth.
- `packages/shared`: shared schemas, event normalization, palette/types, and state-machine behavior.
- `packages/db`: Postgres/PostGIS migrations, seed/setup scripts, import/export utilities.
- `supabase/migrations`: hosted Supabase-specific RLS and production policies.

Key patterns:

- Event-first ingestion: every signal becomes `activity_events`.
- Derived entries: `time_entries` are created from explicit or trusted high-confidence events.
- Review-first ambiguity: uncertain signals become `review_items`.
- Workspace scoping: every user data table is scoped by workspace and protected through app session checks and Supabase RLS.
- Mobile offline queue: mobile writes local queued events, then syncs to API when available.
- Hybrid iOS boundary: React Native owns authenticated data, API mutations, route state, and shared sheets. A native SwiftUI surface receives a serializable presentation model and emits semantic actions back to React Native; it does not create a parallel API, session, timer, or persistence layer.

## 7. Tools / Features

Manual timer:

- Start/stop from web and mobile.
- Live ticking duration.
- Description can be edited while running.
- Optional task description and category selection.
- Active timer sync across interfaces.

Timeline/review:

- Calendar view with time blocks.
- List view with chronological grouped entries and edit/delete/start-again actions.
- Timesheet view with weekly grouped totals.
- Review inbox for suggestions, ignored items, and rule creation.

Automation:

- Trusted-place auto-start.
- Geofence enter/exit event capture.
- Broad/unknown place review suggestions.
- HealthKit sleep and workout/walk summary import.
- Automation accuracy metrics based on accepted/ignored outcomes.

Privacy/data controls:

- Export workspace data.
- Delete time entries.
- Future full account/workspace deletion must hard-delete raw location and health payloads.

## 8. Technology Stack

Web:

- Next.js 16.2.9 App Router
- React 19.2.x
- TypeScript
- Tailwind CSS
- `pg`
- `@supabase/supabase-js`
- Zod

Mobile:

- Expo 56
- React Native 0.85
- Expo Router
- Expo Router Native Tabs backed by the iOS system tab controller
- Expo SecureStore
- AsyncStorage
- Expo Location / Task Manager
- `@kingstinct/react-native-healthkit`
- Swift/SwiftUI local Expo modules for targeted iOS surfaces; UIKit may be wrapped through SwiftUI when a system interaction such as continuous scroll-view zoom requires it.

Database/infrastructure:

- Supabase Postgres with PostGIS
- Supabase Auth
- Vercel web/API hosting
- npm workspaces monorepo

Optional/future:

- Supabase Realtime or another realtime channel for active timer updates.
- Sentry with PII scrubbing.
- Privacy-friendly analytics for automation accuracy.

## 9. Security & Configuration

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

Security scope:

- In scope: auth, signup allowlist, RLS migration, app sessions, export/delete groundwork.
- Out of scope for MVP: enterprise SSO, billing security, organization admin roles, formal compliance certification.

## 10. API Specification

Authentication:

- `POST /api/auth/signup`
  - Body: `{ email, password, name?, workspaceName? }`
  - Provider mode: creates Supabase Auth user, provisions Dayframe user/workspace, returns app session if confirmed.
  - If email confirmation is enabled: returns `202` with `requiresEmailConfirmation`.

- `POST /api/auth/login`
  - Body: `{ email, password }`
  - Provider mode: verifies credentials through Supabase Auth and returns Dayframe app session.

- `POST /api/auth/logout`
  - Revokes Dayframe app session and clears web cookie.

- `GET /api/auth/me`
  - Returns current user/workspace/session mode.

Core app:

- `GET /api/bootstrap`
  - Returns active timer, entries, categories, places, review items, stats, dashboard data, and legacy project/client compatibility data.

- `POST /api/time-entries`
  - Modes: start, stop, manual entry creation.
  - Mobile may send `source: "mobile_app"`.

- `PATCH /api/time-entries/:id`
  - Edits category/place/description/start/stop, with legacy project fields preserved for compatibility.

- `DELETE /api/time-entries/:id`
  - Deletes an entry.

- `POST /api/events`
  - Ingests mobile/geofence/HealthKit/NFC/shortcut events.
  - Requires app bearer/cookie session or scoped ingest token.

- `POST /api/review/:id`
  - Accept, ignore, or create rule from review item.

- `GET /api/export`
  - Supports workspace JSON and time-entry exports.

Example event payload:

```json
{
  "source": "health_workout",
  "type": "health_workout_import",
  "occurredAt": "2026-07-03T08:30:00.000Z",
  "description": "Outdoor walk",
  "rawPayload": {
    "provider": "healthkit",
    "workoutType": "walking",
    "startedAt": "2026-07-03T08:30:00.000Z",
    "stoppedAt": "2026-07-03T09:10:00.000Z",
    "durationMinutes": 40
  }
}
```

## 11. Success Criteria

MVP success definition:

Dayframe is useful as the owner's daily personal time tracker for at least two continuous weeks, with web/mobile manual tracking, iOS HealthKit sleep/walk/workout capture, trusted-place automation, review correction, and hosted login/sync working reliably.

Functional requirements:

- ✅ User can sign up/log in through hosted Supabase Auth.
- ✅ Only allowlisted beta users can create accounts.
- ✅ Web and mobile share active timer state.
- ⚠️ Mobile can queue events offline and sync later, but failed queue recovery and diagnostics need hardening before wider beta confidence.
- ✅ Trusted places can auto-start entries.
- ✅ Ambiguous location events appear in review.
- ✅ HealthKit sleep and workouts/walks appear as time entries or high-confidence review items; duplicate/overlapping Sleep remains a tracked investigation.
- ✅ User can edit/delete entries from web.
- ✅ User can export data.
- ⚠️ Full account/workspace deletion and raw payload hard-deletion controls are not complete yet.
- ✅ Hosted deployment works on Vercel with Supabase database.

Quality indicators:

- No runtime error overlays during normal navigation.
- No React key/hydration warnings.
- Production build passes.
- Mobile typecheck/build path remains healthy.
- Sensitive raw data is not sent to analytics.
- TestFlight release evidence is captured before KB is asked to test mobile changes.
- Calendar pinch/scroll interactions remain continuous under the fingers, preserve the focal point, and do not snap through a second layout path when the gesture ends.

User experience goals:

- Timer start/stop feels immediate.
- Review items explain why they exist.
- Timeline is readable and editable.
- Corrections are faster than manual re-entry.

## 12. Implementation Phases

### Phase 1: Hosted Auth And Deployment

Goal: make Dayframe accessible on Vercel with Supabase Auth.

Deliverables:

- ✅ Supabase Auth provider mode.
- ✅ Signup allowlist.
- ✅ Supabase RLS migration.
- ✅ Vercel/Supabase hosting documentation.
- ✅ Hosted environment variable setup.

Validation:

- Login/signup work on Vercel.
- `/api/auth/me` resolves hosted user/workspace.
- Mobile can log in against hosted API.

### Phase 2: Reliable Sync And Offline Mobile

Goal: make mobile/web timer state reliable.

Deliverables:

- ✅ Active timer sync path.
- ✅ Offline event queue reconciliation.
- ✅ Conflict handling for start/stop/switch events.
- ✅ Retry and auth-expiry behavior.

Validation:

- Start on mobile appears on web.
- Stop on web appears on mobile.
- Offline mobile events sync in order after reconnect.

### Phase 3: Health And Location MVP

Goal: turn iOS signals into useful personal time records.

Deliverables:

- ✅ HealthKit sleep summary import.
- ✅ HealthKit walking/workout summary import.
- ✅ Trusted-place auto-start.
- ✅ Broad/unknown geofence review suggestions.
- ✅ Learned-location evidence separates repeat place suggestions, significant one-off stays, and weak/pass-through noise.
- ✅ Learned-place details cache readable address/POI resolution and keep coordinates secondary.
- ⚠️ Export path exists; account/workspace deletion and raw sensitive payload hard-deletion are still future work.

Validation:

- Sleep appears with correct duration/time window.
- Walking/workout entries have correct duration.
- Trusted place starts correctly.
- Unknown/broad places do not create silent incorrect entries.

### Phase 4: Product Polish And Beta Hardening

Goal: make the product comfortable for daily personal use and friends beta.

Deliverables:

- ✅ Review inbox improvements.
- ✅ Reports and automation accuracy metrics.
- ⚠️ Settings for permissions and export exist; deletion/privacy controls still need the next-phase work tracked in `docs/feature-fix-tracker.md`.
- ✅ Internal TestFlight build workflow is active and verified through `0.1.0 (48)`.
- ⚠️ Native SwiftUI Calendar is in TestFlight build `0.1.0 (47)` and remains under physical-device Watch for pinch smoothness, entry/review taps, accessibility settings, and frame pacing.

Validation:

- Owner can use Dayframe for two weeks without data loss.
- Friends can sign in and test without developer help once the preview/pre-prod lane and wider-beta invite path are ready.
- Accuracy metrics show accepted/ignored suggestion rates.

## 13. Future Considerations

- Calendar integration for work meeting hints.
- Home Assistant/local bridge integrations.
- Realtime sync through Supabase Realtime/WebSocket/SSE.
- More advanced rule learning from accepted/ignored suggestions.
- Account deletion UI with full raw health/location deletion.
- Dayframe preview/pre-production lane with separate staging app/environment/TestFlight path.
- App Store release if sideloading is no longer sufficient.

## 14. Risks & Mitigations

1. Health/location privacy risk.
   - Mitigation: minimize raw payloads, document retention, add export/delete controls, avoid sensitive analytics payloads.

2. False automation risk.
   - Mitigation: auto-start trusted places only; route broad/unknown/Home signals through review.

3. Background location reliability risk.
   - Mitigation: rely on iOS geofencing constraints, cap monitored regions, expose sync/review status, and avoid promising perfect tracking.

4. Hosted auth/data isolation risk.
   - Mitigation: Supabase Auth, signup allowlist, Dayframe session scoping, RLS migration, and workspace membership checks.

5. Offline conflict risk.
   - Mitigation: keep event timestamps, process events transactionally, close prior active timers on explicit starts, and surface ambiguous conflicts in review.

## 15. Appendix

Related documents:

- `README.md`
- `docs/production-readiness.md`
- `docs/local-auth-and-hosting-plan.md`
- `docs/vercel-supabase-hosting.md`
- `docs/dayframe-regression-checklist.md`

Key repository structure:

```text
apps/web      Next.js web app and API routes
apps/mobile   Expo iOS mobile app
packages/db   Postgres/PostGIS migrations and scripts
packages/shared shared schemas, types, event normalization
supabase      hosted Supabase migrations
```

Important assumptions:

- The first hosted version is personal/friends beta, not public SaaS.
- iOS is the only mobile platform for MVP.
- Supabase email confirmation may be disabled initially for easier sideload/beta testing.
- HealthKit summaries are sufficient for MVP; raw detailed samples should be minimized.
- Precise location can be stored for geotracking but must be fully deletable.
