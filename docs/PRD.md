# Dayframe Product Requirements Document

## 1. Executive Summary

Dayframe is a personal time-intelligence product that combines manual task tracking with privacy-conscious automatic activity capture. It has two interfaces: an iOS mobile app that can read location and HealthKit signals, and a web app for timer control, review, reporting, category management, and longer-form analysis.

The core value proposition is to reduce manual time-tracking friction without losing user trust. Dayframe should capture manual timer actions, trusted-place automation, HealthKit sleep/workout summaries, and mobile offline activity signals, then sync them into a clear web/mobile timeline. Ambiguous or low-confidence signals should be reviewable instead of silently becoming incorrect time entries.

The MVP goal is to make Dayframe reliable for personal use and a small friends beta: hosted on Vercel, backed by Supabase Postgres/Auth, iOS-only for mobile, offline-capable for hours or days, and privacy-conscious around health and precise location data.

This PRD is deliberately stable product intent. `docs/feature-fix-tracker.md` is the source of truth for delivery, release, Watch, and decision state; `docs/architecture.md` is the source of truth for runtime/data ownership. Do not copy build numbers or active-branch snapshots into this document.

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

- ✅ Web and mobile manual timer start/stop with live active timer sync. Mobile Stop is accepted only after an exact, account-owned Stop intent is durable on device; server delivery is entry-scoped, idempotent, bounded, and safe to replay after relaunch.
- ✅ Description, category, place, source, confidence, and review status on time entries.
- ✅ Calendar, List, and Timesheet review views.
- ✅ Review inbox for ambiguous geofence/health/location suggestions.
- ✅ Auto-start for trusted places only.
- ✅ Conservative suggestions for broad/ambiguous places.
- ✅ HealthKit summaries for sleep and workouts/walks as automatic entries or reviewable high-confidence events, with real-device background behavior and mapping defaults still watched after TestFlight validation.
- ✅ Mobile activity-event fallback and offline Review mutation queues include durable storage, bounded retry, diagnostics, and idempotency. Real-device background/reconnect/conflict behaviour remains under Watch.
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
- ✅ Location Intelligence V2 implements an ordered temporary evidence journal, deterministic stay/commute segmentation, native iOS visit/significant-change anchors, private map review, and atomic correction actions. Its live server mode remains rollout-gated: the repository fails closed to `v2_shadow`, while `v2_review` and narrow `v2_enabled` require separately recorded operational approval and evidence.
- ❓ Automation outcome measurement is a decision item. Review outcomes are stored, but no dedicated anonymized analytics product or telemetry contract is approved.

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
   - On web, the idle/running timer, Add Time, Timeline List entry editor, and Calendar create/edit category pickers can create a category in place. Creation is an independent catalogue write: it previews an automatic Dayframe colour by default, lets the user optionally choose another colour from the canonical Dayframe palette, leaves the category unpinned, selects it in the current draft, and never submits, dismisses, starts, stops, restarts, or otherwise mutates the surrounding entry. The category remains available after the entry draft is discarded.

3. As a user moving between trusted places, I want Dayframe to auto-start known activities only for trusted locations, so that routine places save effort without creating noisy entries.
   - Example: Arriving at Gym starts a Gym/Health entry if explicitly configured as trusted.

4. As a privacy-conscious user, I want ambiguous location signals to become review items, so that Dayframe does not silently guess wrong.
   - Example: Town Centre creates a "Review visit" item instead of auto-starting.
   - Stay evidence should let me answer `Where were you?`, `What did you do?`, and `When?` in one correction flow. For an unknown visit, Dayframe automatically offers up to three Apple Maps points of interest within 750 metres as nearby—not inferred—places. When Apple results expose a shared site context, the list should prioritise that venue and a useful variety of destination types instead of three near-identical tenants or utilities; it must not claim popularity or certainty Apple does not provide. I can use a selected name once, explicitly save it for future location learning, choose an existing Dayframe place, search for another place, choose an existing category, and adjust the start/end time before one atomic confirmation. Commute evidence should show an honest approximate route with explicit Start and End markers, then ask only what I did and when.

5. As an iOS user, I want sleep and walk/workout summaries imported from HealthKit, so that health activity appears in my day timeline.
   - Example: Sleep from 23:20 to 06:45 creates a Sleep entry or high-confidence review item.

6. As a mobile user, I want offline capture to sync later, so that timers and geofence/health events are not lost when the network is unavailable.
   - Example: A walk captured offline syncs when the phone reconnects.
   - Example: I tap Stop and immediately force-quit; reopening still shows that exact timer stopped locally and safely retries the same event without stopping a newer timer.
   - Example: Review opens from the last account-owned snapshot, cached private Location Evidence remains usable for up to seven days, and Confirm, Dismiss, or a complete Edit-and-confirm disappears after its local SQLite commit while Dayframe retries the canonical server mutation later.
   - Place creation/change, split, merge, and one-time POI actions still require a bounded live connection; offline support must never substitute a different action or expose one account's cached Review/location evidence to another.

7. As a user reviewing time, I want Calendar, List, and Timesheet views, so that I can edit precise entries and understand daily/weekly totals.
   - Example: Resize/edit a time block, delete an accidental entry, and review weekly totals by category.

8. As the product owner, I want an explainable way to assess automation quality without exposing sensitive context.
   - Example: An owner-only accepted/ignored report may be appropriate, but external telemetry requires a separate privacy decision.

9. As an iOS user, I want navigation, gestures, sheets, list changes, and action feedback to transition consistently, so that every state change feels connected and understandable rather than jumpy.
   - Example: Swiping to delete an entry moves continuously into an animated list reflow and Undo state, including dismissal, restoration, failure, and Reduce Motion behaviour.

## 6. Core Architecture & Patterns

High-level architecture:

- `apps/mobile`: Expo/React Native iOS app for manual timers, geofences, HealthKit import, offline queue, and sync, with targeted Swift/SwiftUI native modules where a platform interaction needs native ownership.
- `apps/web`: Next.js App Router web app and API routes for timer/review/reporting/auth.
- `packages/shared`: shared schemas, event normalization, palette/types, and state-machine behavior.
- `packages/db`: ordered Postgres/PostGIS migrations, seed/setup scripts, import/export utilities.
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
- Contextual web category creation from timer, Add Time, Timeline List, and Calendar create/edit pickers without leaving or submitting the current draft.
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
- Stored Review outcomes that can support a future owner-approved quality report or privacy-reviewed analytics design.

Privacy/data controls:

- Export workspace data.
- Delete time entries.
- Future full account/workspace deletion must hard-delete raw location and health payloads.

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
- An owner-approved automation-quality report or privacy-reviewed analytics design.

Exact dependency versions live in the package manifests and lockfile rather than this PRD.

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

- `POST /api/categories`
  - Creates one workspace-scoped category. Name-only callers receive a deterministic Dayframe palette colour; callers may instead provide a canonical palette colour. Contextual picker creation remains unpinned, and active names are unique case-insensitively within the workspace.

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
- ✅ Mobile can queue events offline and sync later with retry and diagnostics; real-device reconnect/background/conflict behaviour remains under Watch before wider beta confidence.
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
- Review items explain why they exist and why automatic logging did not apply.
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
- ✅ Dedicated durable mobile Stop outbox with exact timer identity, original tap time, stable idempotency, and foreground/relaunch projection.
- ✅ Conflict handling for start/stop/switch events.
- ✅ Retry and auth-expiry behavior.

Validation:

- Start on mobile appears on web.
- Stop on web appears on mobile.
- Offline mobile events sync in order after reconnect.
- A locally accepted mobile Stop survives force-quit, remains scoped to its original timer/account, and clears silently after success, duplicate, or superseded acknowledgement.

### Phase 3: Health And Location MVP

Goal: turn iOS signals into useful personal time records.

Deliverables:

- ✅ HealthKit sleep summary import.
- ✅ HealthKit walking/workout summary import.
- ✅ Trusted-place auto-start.
- ✅ Broad/unknown geofence review suggestions.
- ✅ Learned-location evidence separates repeat place suggestions, significant one-off stays, and weak/pass-through noise.
- ✅ Learned-place details cache readable address/POI resolution and keep coordinates secondary.
- ✅ `location-v2.0` closes stays on accepted intervening-place evidence, sustained exits, or explicit gaps; preserves short saved-place endpoints; derives journeys from movement evidence; and exposes uncertainty instead of fabricating exact boundaries.
- ✅ Mobile and web consume one user-scoped `LocationReviewEvidenceDto` for map plus textual review, with atomic confirm, split, merge, place correction, record-once, one-time POI, and save-place actions. Unknown mobile stays use the native Apple POI boundary to load up to three nearby results, enrich a repeated distinctive site context with at most one bounded local search, prefer a varied destination slate over duplicate tenants and utilities, retain explicit search and map fallback, and default selection to a one-time name unless the user enables `Save for future visits`. This ranking remains a nearby aid rather than a popularity or exact-venue claim. A one-time choice stores only its trimmed name on the derived entry; it does not retain Apple identifiers, address, coordinates, or response payloads. Physical iPhone reliability and battery measurement are still mandatory before the rollout is considered settled.
- ⚠️ V2 rollout is server-authoritative: `v2_shadow` captures and replays without user-visible V2 semantics; `v2_review` permits review items only after a same-mode client acknowledgement; and `v2_enabled` applies the narrow automatic policy. It confirms completed, strong saved/approved-place stays with bounded continuity and completed `medium_high`/`high`, continuous, route-backed commutes whose two endpoints are saved Dayframe places. Unknown/ambiguous endpoints, weak or endpoint-only evidence, uncertain gaps, missing approved-place linkage, and confirmed-time overlaps remain Review-first. Existing Review or terminal decisions are never silently promoted on replay, and deleting an automatic commute prevents replay from recreating it. Shadow-era segments cannot be backfilled at cutover.
- ⚠️ Export path exists; account/workspace deletion and raw sensitive payload hard-deletion are still future work.

Validation:

- Sleep appears with correct duration/time window.
- Walking/workout entries have correct duration.
- Trusted place starts correctly.
- Unknown/broad places do not create silent incorrect entries.
- Two appearances at one venue separated by Home remain two stays; a 10–15 minute saved stop remains a journey endpoint; nearby saved places can remain explicitly ambiguous; and Europe/London local-day grouping remains correct across BST/DST.

### Phase 4: Product Polish And Beta Hardening

Goal: make the product comfortable for daily personal use and friends beta.

Deliverables:

- ✅ Review inbox improvements.
- ✅ Reports.
- ❓ Automation accuracy measurement remains a decision item; stored outcomes are not the same as a shipped analytics surface.
- ⚠️ Settings for permissions and export exist; deletion/privacy controls still need the next-phase work tracked in `docs/feature-fix-tracker.md`.
- ✅ Internal TestFlight build workflow is active; exact release evidence lives in the tracker and release reference.
- ⚠️ Native SwiftUI/UIKit Calendar behavior remains under physical-iPhone Watch for creation, taps, day/week navigation, refresh, pinch/vertical pan, and accessibility settings.

Validation:

- Owner can use Dayframe for two weeks without data loss.
- Friends can sign in and test without developer help once the wider-beta invite/support path is approved; the isolated hosted Preview lane already exists.
- If automation-quality measurement is approved, it reports accepted/ignored outcomes without raw Health or location context.

## 13. Future Considerations

- Calendar integration for work meeting hints.
- Home Assistant/local bridge integrations.
- Realtime sync through Supabase Realtime/WebSocket/SSE.
- More advanced rule learning from accepted/ignored suggestions.
- Account deletion UI with full raw health/location deletion.
- A separate staging iOS bundle/App Group/Keychain/APNs identity; the hosted staging environment already exists.
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
- `docs/architecture.md`
- `docs/documentation-governance.md`
- `docs/feature-fix-tracker.md`
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
