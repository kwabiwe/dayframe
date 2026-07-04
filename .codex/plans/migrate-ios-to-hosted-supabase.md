# Feature: Migrate iOS To Hosted Supabase-Backed Dayframe

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils, types, schemas, and route handlers. Import from the right files and keep Dayframe's event-first invariant intact.

## Feature Description

Migrate the Expo iOS app from a local-development runtime into a hosted Dayframe runtime backed by Vercel API routes, Supabase Postgres, and Supabase Auth. The iOS app should no longer depend on a local Next.js server for normal use. It should log in to the hosted API, store the Dayframe app session token in SecureStore, sync timers and queued activity events to the hosted API, and keep iOS capture features functional: manual timers, quick actions, shortcuts/deep links, geofences, HealthKit sleep, and HealthKit workout/walking summaries.

Important architecture decision: the iOS app should remain an authenticated Dayframe API client. Do not make mobile write directly to Supabase tables. Supabase backs identity and Postgres, while the Vercel API preserves app sessions, workspace scoping, event normalization, review item creation, and sensitive-data handling.

## User Story

As an iOS Dayframe user
I want the mobile app to sign in to my hosted Supabase-backed Dayframe workspace and sync without a local dev server
So that I can use Dayframe on a real iPhone for timers, offline capture, location, and HealthKit during daily life.

## Problem Statement

The current mobile app has the correct broad API shape, but several details still make it local-first or incomplete for hosted use:

- `apps/mobile/src/lib/api.ts` falls back to `http://localhost:3000`, which is useful in Simulator but unsafe for production builds.
- The signed-out screen still says "Local auth" and defaults the email field to `test1@dayframe.local`.
- Supabase email confirmation responses can return `202` without a Dayframe app token, but mobile auth currently assumes every successful auth response contains `payload.token`.
- Mobile polls `/api/bootstrap` every second, which is expensive for a Vercel/Supabase hosted deployment.
- Offline queued events are not idempotent across timeout/retry boundaries and can sync later events after an earlier event fails.
- HealthKit sleep import exists, but HealthKit workout/walking import is only represented in shared/server schemas and is not implemented end to end.
- There is no EAS/TestFlight/internal distribution configuration that reliably injects the hosted API base and iOS capabilities.

## Solution Statement

Keep the hosted boundary as:

```text
iOS app -> Vercel Next.js API -> Supabase Auth/Postgres
```

Implement a production-safe mobile configuration layer, hosted-auth UX, email-confirmation handling, ordered and idempotent offline event sync, HealthKit workout import, server-side workout dedupe, hosted EAS build configuration, and a deployment/runbook validation path. Strengthen the database schema and event service where needed so mobile events can be safely retried without duplicate `activity_events`, `time_entries`, `review_items`, sleep segments, or workout rows.

## Feature Metadata

**Feature Type**: Enhancement / Deployment hardening / Mobile reliability
**Estimated Complexity**: High
**Primary Systems Affected**: `apps/mobile`, `apps/web` API/auth/event service, `packages/shared`, `packages/db`, `supabase/migrations`, docs/deployment config
**Dependencies**: Supabase project with Auth/Postgres/PostGIS, Vercel deployment, Expo/EAS iOS build, Apple Developer credentials for HealthKit/background-location capable builds

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/PRD.md` (lines 5-9) - Why: Defines the hosted Vercel/Supabase, iOS-only, offline-capable MVP goal.
- `docs/PRD.md` (lines 17-21) - Why: Product invariants: event-first, privacy by design, offline resilient.
- `docs/PRD.md` (lines 49-66) - Why: MVP scope requires web/mobile timers, review inbox, mobile offline queue, Supabase Postgres/Auth, and Dayframe mobile bearer sessions.
- `docs/PRD.md` (lines 70-79) - Why: iOS HealthKit/geofence scope and sideload/TestFlight-friendly deployment.
- `docs/PRD.md` (lines 203-228) - Why: Production auth/security configuration and hosted env vars.
- `docs/PRD.md` (lines 239-271) - Why: Mobile-facing API contract for auth, bootstrap, time entries, and events.
- `docs/PRD.md` (lines 301-314) - Why: Success criteria for hosted auth/sync, offline mobile events, HealthKit, and Vercel/Supabase deployment.
- `docs/vercel-supabase-hosting.md` (lines 3-16) - Why: Existing hosted architecture and required credentials.
- `docs/vercel-supabase-hosting.md` (lines 18-25) - Why: Supabase setup order, including base migration and hosted RLS migration.
- `docs/vercel-supabase-hosting.md` (lines 31-56) - Why: Vercel env vars, auth model, and mobile `EXPO_PUBLIC_DAYFRAME_API_BASE`.
- `docs/production-readiness.md` (lines 1-15) - Why: Production invariant and auth mode model.
- `docs/production-readiness.md` (lines 17-32) - Why: App bearer sessions versus ingest tokens for `/api/events`.
- `docs/production-readiness.md` (lines 65-92) - Why: Current geofence and HealthKit implementation notes and native-build constraints.
- `docs/dayframe-regression-checklist.md` (lines 26-32) - Why: Sync regressions to avoid.
- `docs/dayframe-regression-checklist.md` (lines 49-56) - Why: Required validation commands and mobile smoke tests.
- `.env.example` (lines 1-16) - Why: Existing local and production env defaults; update this for hosted mobile examples without committing secrets.
- `apps/mobile/package.json` (lines 6-12) - Why: Existing mobile scripts; add test/build scripts here if needed.
- `apps/mobile/package.json` (lines 13-33) - Why: Mobile dependencies include Expo Router, Location, TaskManager, SecureStore, HealthKit, AsyncStorage, and shared schemas.
- `apps/mobile/app.json` (lines 5-20) - Why: Current scheme, local bundle identifier, iOS background modes, location and HealthKit permission strings.
- `apps/mobile/app.json` (lines 31-40) - Why: Expo Router, Location, and HealthKit plugins are configured here.
- `apps/mobile/ios/Dayframe/Info.plist` (lines 25-47) - Why: URL schemes and local networking permissions currently generated in native iOS config.
- `apps/mobile/ios/Dayframe/Info.plist` (lines 48-66) - Why: Location strings and background modes currently present in the native project.
- `apps/mobile/ios/Dayframe/Dayframe.entitlements` (lines 5-6) - Why: HealthKit entitlement is already present.
- `apps/mobile/src/lib/api.ts` (lines 10-12) - Why: Current API base fallback and local storage keys.
- `apps/mobile/src/lib/api.ts` (lines 90-109) - Why: Bootstrap and auth-required behavior.
- `apps/mobile/src/lib/api.ts` (lines 112-119) - Why: Logout revokes Dayframe app session and clears SecureStore token.
- `apps/mobile/src/lib/api.ts` (lines 129-186) - Why: Offline queue write/read/sync path.
- `apps/mobile/src/lib/api.ts` (lines 189-211) - Why: Mobile start/stop/queued stop event contract.
- `apps/mobile/src/lib/api.ts` (lines 221-253) - Why: Auth response parsing and bearer auth header generation.
- `apps/mobile/app/index.tsx` (lines 75-98) - Why: Mobile auth/UI state and current local email default.
- `apps/mobile/app/index.tsx` (lines 100-122) - Why: Bootstrap load and AuthRequired handling.
- `apps/mobile/app/index.tsx` (lines 154-159) - Why: Current one-second hosted-unfriendly bootstrap polling.
- `apps/mobile/app/index.tsx` (lines 212-263) - Why: Direct timer start fallback into queued event.
- `apps/mobile/app/index.tsx` (lines 265-306) - Why: Queue sync and HealthKit sleep sync flow.
- `apps/mobile/app/index.tsx` (lines 308-329) - Why: Login/signup submit behavior.
- `apps/mobile/app/index.tsx` (lines 351-425) - Why: Signed-out UI still says local auth and local account.
- `apps/mobile/app/index.tsx` (lines 432-620) - Why: Authenticated mobile timer, sync, start-task, location, HealthKit, and review-count UI.
- `apps/mobile/src/lib/geofence.ts` (lines 18-43) - Why: Geofence TaskManager task is correctly defined at module top level and queues event-first payloads.
- `apps/mobile/src/lib/geofence.ts` (lines 45-81) - Why: Foreground/background permission and iOS 20-region cap implementation.
- `apps/mobile/src/lib/health.ts` (lines 38-72) - Why: Current HealthKit availability/status behavior.
- `apps/mobile/src/lib/health.ts` (lines 75-95) - Why: Current sleep permission request pattern.
- `apps/mobile/src/lib/health.ts` (lines 97-142) - Why: Anchored sleep import, local dedupe, and queued `health_sleep_import` events.
- `apps/mobile/src/lib/health.ts` (lines 144-169) - Why: Sleep sample mapping and dynamic HealthKit module load.
- `apps/mobile/src/lib/health.ts` (lines 171-175) - Why: iOS-native-build guard.
- `apps/mobile/src/lib/deepLinks.ts` (lines 6-39) - Why: Shortcut/deep link event queueing pattern.
- `apps/mobile/app/action/[verb].tsx` (lines 12-37) - Why: Expo Router action route queues shortcut events and returns home.
- `apps/web/src/app/api/auth/signup/route.ts` (lines 7-19) - Why: Signup returns `202` for email confirmation without setting a cookie/token.
- `apps/web/src/app/api/auth/login/route.ts` (lines 7-16) - Why: Provider/local auth returns the same Dayframe auth payload and cookie.
- `apps/web/src/lib/auth/supabase.ts` (lines 33-69) - Why: Supabase signup creates/provisions Dayframe user/workspace and may return email-confirmation payload.
- `apps/web/src/lib/auth/supabase.ts` (lines 72-93) - Why: Supabase password login returns Dayframe app session.
- `apps/web/src/lib/auth/supabase.ts` (lines 191-213) - Why: Server-side Supabase Auth client uses public/publishable key and does not persist Supabase sessions.
- `apps/web/src/lib/auth/supabase.ts` (lines 215-239) - Why: Signup allowlist and hosted signup enablement rules.
- `apps/web/src/lib/auth/local.ts` (lines 24-29) - Why: Mobile auth response shape expected when a token exists.
- `apps/web/src/lib/auth/local.ts` (lines 167-188) - Why: Dayframe app session token resolution and scopes.
- `apps/web/src/lib/auth/local.ts` (lines 226-240) - Why: App session token generation, hashing, and storage.
- `apps/web/src/lib/ingest-auth.ts` (lines 18-68) - Why: Request session resolution must accept mobile bearer app sessions in provider mode.
- `apps/web/src/app/api/bootstrap/route.ts` (lines 6-13) - Why: Mobile bootstrap must remain session-scoped through `resolveRequestSession`.
- `apps/web/src/app/api/time-entries/route.ts` (lines 6-49) - Why: Mobile timer start/stop posts become event-first operations.
- `apps/web/src/app/api/events/route.ts` (lines 6-14) - Why: Mobile/geofence/HealthKit queued events post to the event processor.
- `apps/web/src/lib/event-service.ts` (lines 11-20) - Why: Raw event input is parsed with session workspace/user defaults before normalization.
- `apps/web/src/lib/event-service.ts` (lines 23-56) - Why: `activity_events` insertion pattern.
- `apps/web/src/lib/event-service.ts` (lines 59-104) - Why: Event-derived timer start/stop entry creation.
- `apps/web/src/lib/event-service.ts` (lines 106-135) - Why: Review item creation for ambiguous events.
- `apps/web/src/lib/event-service.ts` (lines 137-164) - Why: Server-side HealthKit sleep segment audit/dedupe pattern to mirror for workouts.
- `apps/web/src/lib/queries.ts` (lines 150-170) - Why: Bootstrap shape consumed by mobile.
- `apps/web/src/lib/queries.ts` (lines 172-239) - Why: Bootstrap is assembled from session-scoped workspace data.
- `apps/web/src/lib/queries.ts` (lines 242-284) - Why: Normalization context for geofence/automation events.
- `packages/shared/src/index.ts` (lines 125-200) - Why: Event source/type/input schemas shared by web and mobile.
- `packages/shared/src/index.ts` (lines 333-353) - Why: Confidence per source, including health and geofence sources.
- `packages/shared/src/index.ts` (lines 391-403) - Why: Explicit mobile/shortcut starts become confirmed starts and close previous timers.
- `packages/shared/src/index.ts` (lines 406-455) - Why: Geofence enters route to auto-start only with rules, otherwise review.
- `packages/shared/src/index.ts` (lines 457-491) - Why: Geofence exits are conservative and review-first unless a stop rule exists.
- `packages/shared/src/index.ts` (lines 521-531) - Why: Health imports are high-confidence review items.
- `packages/db/migrations/001_init.sql` (lines 28-38) - Why: Dayframe app sessions table used by mobile bearer auth.
- `packages/db/migrations/001_init.sql` (lines 79-87) - Why: Devices table exists but mobile does not yet register/use stable device IDs.
- `packages/db/migrations/001_init.sql` (lines 140-155) - Why: `activity_events` schema needs an idempotency column for mobile queued retries.
- `packages/db/migrations/001_init.sql` (lines 226-250) - Why: Sleep/workout storage exists, but workouts need hosted dedupe/raw payload parity.
- `packages/db/migrations/001_init.sql` (lines 324-333) - Why: Existing workspace/time/event indexes to mirror for new indexes.
- `supabase/migrations/202607020001_dayframe_rls.sql` (lines 1-14) - Why: Supabase RLS helper scopes policies through `workspace_members`.
- `supabase/migrations/202607020001_dayframe_rls.sql` (lines 60-99) - Why: RLS policies are applied across workspace-scoped tables.
- `packages/shared/test/event-engine.test.ts` (lines 59-236) - Why: Existing Vitest style and coverage for event normalization.
- `apps/web/src/lib/auth/local.test.ts` (lines 13-58) - Why: Existing Vitest style for auth/session primitives.

### New Files to Create

- `apps/mobile/src/lib/config.ts` - Central mobile runtime config for `EXPO_PUBLIC_DAYFRAME_API_BASE`, URL normalization, and production safety checks.
- `apps/mobile/src/lib/config.test.ts` - Vitest coverage for API base normalization and localhost/HTTPS production guards.
- `apps/mobile/src/lib/api.test.ts` - Vitest coverage for auth response parsing, email-confirmation handling, and ordered queue retry behavior.
- `apps/mobile/src/lib/health.test.ts` - Unit coverage for HealthKit workout sample mapping and sleep/workout event payload shape.
- `apps/mobile/eas.json` or root `eas.json` - EAS profiles for development, preview/internal, and production builds. Confirm final location before implementation based on where EAS is run in this monorepo.
- `supabase/migrations/20260703XXXX_mobile_event_idempotency_and_workouts.sql` - Hosted migration adding mobile event idempotency and workout dedupe/raw payload fields.
- `docs/ios-hosted-supabase-runbook.md` - Operator runbook for Supabase, Vercel, EAS, and physical-iPhone validation.

Potential new files if implementation chooses to formalize device registration:

- `apps/mobile/src/lib/device.ts` - Stable install/device ID helper, only if the execution agent decides `devices` should be used now.
- `apps/web/src/app/api/devices/route.ts` - Authenticated device registration endpoint, only if `deviceId` is wired into mobile events now.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Supabase Password-based Auth](https://supabase.com/docs/guides/auth/passwords)
  - Specific section: email/password sign up and sign in.
  - Why: Confirms hosted provider mode behavior and email confirmation considerations.
- [Supabase JavaScript signUp reference](https://supabase.com/docs/reference/javascript/auth-signup)
  - Specific section: sign up with email and password.
  - Why: `apps/web/src/lib/auth/supabase.ts` calls `supabase.auth.signUp`.
- [Supabase JavaScript signInWithPassword reference](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
  - Specific section: email/password login.
  - Why: `apps/web/src/lib/auth/supabase.ts` calls `supabase.auth.signInWithPassword`.
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
  - Specific section: policies and `auth.uid()`.
  - Why: Hosted RLS is defense-in-depth for workspace-scoped user data.
- [Supabase Connect to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres)
  - Specific section: pooler connection strings.
  - Why: Vercel serverless API should use the right Supabase Postgres connection string.
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
  - Specific section: Production, Preview, Development environments.
  - Why: Hosted API needs `DAYFRAME_AUTH_MODE=provider`, `DATABASE_URL`, and Supabase public keys in Vercel.
- [Expo Environment Variables](https://docs.expo.dev/guides/environment-variables/)
  - Specific section: `EXPO_PUBLIC_` variables.
  - Why: Mobile build must inline `EXPO_PUBLIC_DAYFRAME_API_BASE`.
- [Expo EAS Environment Variables](https://docs.expo.dev/eas/environment-variables/)
  - Specific section: using env vars across EAS Build and Updates.
  - Why: Hosted API base must be set for development/preview/production iOS builds.
- [Expo app config](https://docs.expo.dev/versions/latest/config/app/)
  - Specific section: `ios.bundleIdentifier`, `scheme`, `plugins`.
  - Why: The current bundle identifier is `local.dayframe.app`; hosted builds need a real identifier and stable scheme.
- [Expo iOS capabilities](https://docs.expo.dev/build-reference/ios-capabilities/)
  - Specific section: EAS Build capability synchronization.
  - Why: HealthKit entitlement must be enabled for signed iOS builds.
- [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/)
  - Specific section: background location and geofencing.
  - Why: Dayframe uses background geofence monitoring through Expo Location.
- [Expo TaskManager](https://docs.expo.dev/versions/latest/sdk/task-manager/)
  - Specific section: long-running background tasks.
  - Why: Geofence task must remain top-level and available in native builds.
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
  - Specific section: local encrypted key-value storage and platform constraints.
  - Why: Mobile app stores the Dayframe app session token in SecureStore.
- [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/)
  - Specific section: internal build sharing.
  - Why: MVP does not require App Store launch; internal distribution/TestFlight-like use is acceptable.
- [React Native HealthKit installation](https://kingstinct-react-native-healthkit.mintlify.app/installation)
  - Specific section: Expo installation, config plugin, dev client requirement.
  - Why: HealthKit does not work in Expo Go and requires a native build.
- [Kingstinct React Native HealthKit GitHub](https://github.com/kingstinct/react-native-healthkit)
  - Specific section: HealthKit anchors and workout query APIs.
  - Why: Sleep import already uses anchored queries; workouts should use the same incremental pattern when available.

### Patterns to Follow

**Hosted Boundary**

Mobile should call Dayframe routes, not Supabase tables:

```ts
// apps/mobile/src/lib/api.ts
const response = await fetch(`${API_BASE}/api/events`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...(await authHeaders())
  },
  body: JSON.stringify({
    ...item,
    occurredAt: item.occurredAt.toISOString()
  })
});
```

**Bearer App Session**

Mobile bearer tokens are Dayframe app sessions, not Supabase access tokens:

```ts
// apps/mobile/src/lib/api.ts
async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
```

Server-side request resolution already accepts those tokens in provider mode:

```ts
// apps/web/src/lib/ingest-auth.ts
if (authMode === "provider") {
  if (appToken) {
    const session = await resolveLocalSession(appToken, "provider");
    return scopedSession(session, requiredScopes);
  }
}
```

**Event-First Writes**

All mobile signals must go through `processActivityEvent`:

```ts
// apps/web/src/app/api/events/route.ts
const result = await processActivityEvent(body, session);
return NextResponse.json(result, { status: 201 });
```

**Transactions For Derived Writes**

Follow `event-service.ts`: insert `activity_events`, then derive `time_entries`, `review_items`, and health audit rows inside one transaction.

**Conservative Automation**

Do not auto-start broad, unknown, or Home-like places without user-created rules. Follow `packages/shared/src/index.ts` geofence behavior.

**Sensitive Data**

Avoid logging raw HealthKit or precise-location payloads. Server logging should remain high-level, like existing auth route error logs.

**Testing Style**

Use Vitest `describe`, `it`, and `expect` as in `packages/shared/test/event-engine.test.ts` and `apps/web/src/lib/auth/local.test.ts`.

---

## IMPLEMENTATION PLAN

### Phase 1: Hosted Foundation

Establish production-safe configuration for iOS builds and confirm the hosted Supabase/Vercel path.

**Tasks:**

- Add/confirm hosted env examples for Vercel and Expo/EAS without committing secrets.
- Add EAS build profiles that inject `EXPO_PUBLIC_DAYFRAME_API_BASE`.
- Replace mobile localhost fallback with explicit config validation.
- Update docs with a physical-iPhone runbook.

### Phase 2: Hosted Auth And Session UX

Make mobile auth work correctly against provider-mode hosted API responses.

**Tasks:**

- Remove local-only defaults/copy from the signed-out screen.
- Handle signup email-confirmation payloads that do not include a Dayframe token.
- Keep the Dayframe app session token in SecureStore and continue sending it as `Authorization: Bearer`.
- Improve mobile API JSON/error parsing for hosted errors and network failures.

### Phase 3: Reliable Hosted Sync

Make mobile timer/event sync safe for Vercel/Supabase and offline retry conditions.

**Tasks:**

- Reduce hosted bootstrap polling and rely on local ticking for active timer duration.
- Preserve offline queue order when sync fails.
- Add idempotency for queued activity events.
- Add DB indexes and server handling so retried events do not duplicate derived entries/review items.

### Phase 4: iOS Capture Completeness

Finish required iOS functions for hosted use.

**Tasks:**

- Keep geofence task top-level and re-register geofences after hosted bootstrap when permissions are already granted.
- Add HealthKit workout/walking permission/import alongside sleep.
- Add server-side workout audit/dedupe storage.
- Keep shortcut/deep-link events event-first and queued until authenticated sync succeeds.

### Phase 5: Deployment And Beta Runbook

Make the result installable/testable outside local development.

**Tasks:**

- Document Supabase migrations, Vercel envs, EAS envs, Apple capabilities, and test-device steps.
- Validate local auth mode still works for development.
- Validate provider mode with hosted Vercel/Supabase.
- Validate a native iOS build on a physical device for HealthKit and background location.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. CREATE `docs/ios-hosted-supabase-runbook.md`

- **IMPLEMENT**: Document the hosted mobile operating model: iOS -> Vercel API -> Supabase Auth/Postgres. Include required Supabase setup, Vercel envs, EAS envs, Apple Developer capabilities, physical device validation, rollback to local dev, and a note that service-role keys never belong in the mobile app.
- **PATTERN**: Mirror `docs/vercel-supabase-hosting.md:1` and `docs/production-readiness.md:1`.
- **IMPORTS**: None.
- **GOTCHA**: Make the runbook clear that `EXPO_PUBLIC_DAYFRAME_API_BASE` points at Vercel, not Supabase.
- **VALIDATE**: `rg -n "EXPO_PUBLIC_DAYFRAME_API_BASE|DAYFRAME_AUTH_MODE=provider|service-role|HealthKit|EAS" docs/ios-hosted-supabase-runbook.md`

### 2. UPDATE `.env.example`

- **IMPLEMENT**: Add a commented hosted iOS example for `EXPO_PUBLIC_DAYFRAME_API_BASE=https://your-vercel-domain.vercel.app`. Keep localhost examples for local dev, but label them as dev-only.
- **PATTERN**: Existing production block at `.env.example:7`.
- **IMPORTS**: None.
- **GOTCHA**: Do not add real Supabase keys, Vercel URLs, session tokens, or personal email addresses beyond placeholders.
- **VALIDATE**: `rg -n "EXPO_PUBLIC_DAYFRAME_API_BASE|your-vercel-domain|localhost" .env.example`

### 3. CREATE `apps/mobile/src/lib/config.ts`

- **IMPLEMENT**: Export a normalized `DAYFRAME_API_BASE` and helper functions such as `normalizeApiBase(value)` and `assertUsableApiBase(value, options)`. Trim trailing slashes. In production-like builds, reject empty values, `localhost`, `127.0.0.1`, LAN IPs unless explicitly marked dev, and non-HTTPS URLs. In local dev, allow `http://localhost:3000`.
- **PATTERN**: Replace direct env usage from `apps/mobile/src/lib/api.ts:10`.
- **IMPORTS**: No new imports required if using `process.env.EXPO_PUBLIC_DAYFRAME_API_BASE`.
- **GOTCHA**: Expo inlines `EXPO_PUBLIC_*` at build time. Avoid reading secrets from this helper; the API base is public config.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`

### 4. CREATE `apps/mobile/src/lib/config.test.ts`

- **IMPLEMENT**: Unit test API base normalization, trailing slash removal, allowed local dev URLs, rejected production localhost, rejected missing production API base, and accepted hosted HTTPS Vercel URL.
- **PATTERN**: Follow Vitest style in `packages/shared/test/event-engine.test.ts:59`.
- **IMPORTS**: `describe`, `expect`, `it` from `vitest`; config helpers from `./config`.
- **GOTCHA**: Keep tests pure; do not mutate global `process.env` unless restoring it in the same test.
- **VALIDATE**: `npm run test -w @dayframe/mobile`

### 5. UPDATE `apps/mobile/package.json`

- **IMPLEMENT**: Add `"test": "vitest run"` to scripts. Add `vitest` to `devDependencies` only if workspace resolution does not already make root Vitest available consistently.
- **PATTERN**: Mirror scripts from `packages/shared/package.json:11` and `apps/web/package.json:10`.
- **IMPORTS**: Package metadata only.
- **GOTCHA**: Keep Expo/React Native dependency versions unchanged unless a test setup requires a narrow dev-only addition.
- **VALIDATE**: `npm run test -w @dayframe/mobile`

### 6. UPDATE `apps/mobile/src/lib/api.ts`

- **IMPLEMENT**: Replace the `API_BASE` constant with `DAYFRAME_API_BASE` from `./config`. Add a safe `readJsonResponse` helper that handles empty/non-JSON hosted errors. Add a discriminated auth response type:

```ts
type MobileAuthResult =
  | MobileAuthSession
  | {
      requiresEmailConfirmation: true;
      message: string;
      user: { id: string; email: string; name: string };
      workspace: { id: string; name: string };
    };
```

Only call `SecureStore.setItemAsync` when a token exists.
- **PATTERN**: Existing `authenticate` at `apps/mobile/src/lib/api.ts:221`.
- **IMPORTS**: `DAYFRAME_API_BASE` from `./config`.
- **GOTCHA**: `POST /api/auth/signup` can return `202` and no token. Do not treat that as an authenticated session.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`

### 7. CREATE `apps/mobile/src/lib/api.test.ts`

- **IMPLEMENT**: Mock `fetch`, `expo-secure-store`, and AsyncStorage as needed. Test successful login stores token, email-confirmation signup does not store token and returns the confirmation result, `401` clears session, and queue sync preserves order when an earlier event fails.
- **PATTERN**: Existing auth expectations in `apps/web/src/lib/auth/local.test.ts:34`.
- **IMPORTS**: `describe`, `expect`, `it`, `vi` from `vitest`; API functions from `./api`.
- **GOTCHA**: Do not rely on a real Vercel/Supabase endpoint in unit tests.
- **VALIDATE**: `npm run test -w @dayframe/mobile`

### 8. UPDATE `apps/mobile/app/index.tsx`

- **IMPLEMENT**: Remove `test1@dayframe.local` as default state. Change signed-out copy from "Local auth" and "Create local account" to hosted-neutral Dayframe wording. Add UI state for `requiresEmailConfirmation` that shows the returned message and does not call `load()` until the user logs in. Keep the Dayframe visual system compact.
- **PATTERN**: Current auth state and submit flow at `apps/mobile/app/index.tsx:82` and `apps/mobile/app/index.tsx:308`.
- **IMPORTS**: Updated auth result type if exported from `api.ts`.
- **GOTCHA**: Do not expose Supabase internals as raw provider strings in the UI. User-facing text should say Dayframe account/sign in.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`

### 9. UPDATE `apps/mobile/app/index.tsx`

- **IMPLEMENT**: Replace one-second bootstrap polling with a hosted-friendly refresh strategy. Keep local `now` ticking every second for the active timer, but call `load({ silent: true })` on app foreground/focus, after successful sync, after timer actions, on pull-to-refresh, and on a slower interval such as 30 seconds while authenticated.
- **PATTERN**: Current `setInterval` polling at `apps/mobile/app/index.tsx:154`.
- **IMPORTS**: If using React Native `AppState`, import it from `react-native`.
- **GOTCHA**: Do not make the active timer appear frozen. `now` should still tick locally every second.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`

### 10. UPDATE `packages/db/migrations/001_init.sql`

- **IMPLEMENT**: Add local-schema support for mobile event idempotency and workout dedupe. Recommended columns:
  - `activity_events.client_event_id text`
  - unique index on `(workspace_id, user_id, client_event_id)` where `client_event_id is not null`
  - `health_workouts.external_sample_id text`
  - `health_workouts.workout_type text`
  - `health_workouts.duration_seconds integer`
  - `health_workouts.distance_meters double precision`
  - `health_workouts.energy_kcal double precision`
  - `health_workouts.raw_payload jsonb not null default '{}'`
  - unique index on `(workspace_id, provider, external_sample_id)` if adding `provider`, or `(workspace_id, external_sample_id)` if keeping provider out of the table.
- **PATTERN**: Existing `health_sleep_segments` dedupe at `packages/db/migrations/001_init.sql:226`.
- **IMPORTS**: SQL only.
- **GOTCHA**: Keep this migration idempotent with `add column if not exists` and `create index if not exists` because the base migration is reused for local setup.
- **VALIDATE**: `npm run db:setup`

### 11. CREATE `supabase/migrations/20260703XXXX_mobile_event_idempotency_and_workouts.sql`

- **IMPLEMENT**: Add the same hosted schema changes from Task 10 for existing Supabase projects. Include indexes. If a new table is created, add RLS policies; if only adding columns/indexes to existing RLS-enabled tables, no policy change is needed.
- **PATTERN**: Existing hosted migration style at `supabase/migrations/202607020001_dayframe_rls.sql:60`.
- **IMPORTS**: SQL only.
- **GOTCHA**: Do not disable RLS. Do not add policies that allow cross-workspace access.
- **VALIDATE**: `psql "$DATABASE_URL" -f supabase/migrations/20260703XXXX_mobile_event_idempotency_and_workouts.sql`

### 12. UPDATE `packages/shared/src/index.ts`

- **IMPLEMENT**: Add `clientEventId: z.string().trim().min(1).max(160).optional()` to `ActivityEventInputSchema`. Add any shared HealthKit workout mapping helpers that can be tested without importing native modules. Keep `health_workout_import` as the event type and `health_workout` as the source.
- **PATTERN**: Shared event schema at `packages/shared/src/index.ts:188`.
- **IMPORTS**: Existing Zod import.
- **GOTCHA**: Do not require `clientEventId`; older integrations and manual routes should still work.
- **VALIDATE**: `npm run test -w @dayframe/shared`

### 13. UPDATE `apps/mobile/src/lib/api.ts`

- **IMPLEMENT**: Include the queued event `localId` as `clientEventId` when posting to `/api/events`. Change `syncQueue()` so the first non-auth failure stops the loop and preserves the failed item plus all later items in order. Treat an idempotent duplicate success from the server as success and remove the queued item.
- **PATTERN**: Queue shape at `apps/mobile/src/lib/api.ts:72` and sync loop at `apps/mobile/src/lib/api.ts:155`.
- **IMPORTS**: None beyond existing API/config imports.
- **GOTCHA**: Do not drop later queued events when an earlier one fails. Offline timer start/stop ordering matters.
- **VALIDATE**: `npm run test -w @dayframe/mobile`

### 14. UPDATE `apps/web/src/lib/event-service.ts`

- **IMPLEMENT**: Make `processActivityEvent` idempotent when `clientEventId` is present. Inside the transaction, before deriving entries/review items, check for an existing `activity_events` row matching `workspace_id`, `user_id`, and `client_event_id`. If it exists, return its `eventId` and normalized candidate without creating duplicate derived rows. Otherwise insert `client_event_id` with the event and continue existing behavior.
- **PATTERN**: Current transactional flow at `apps/web/src/lib/event-service.ts:21`.
- **IMPORTS**: No new external imports.
- **GOTCHA**: Idempotency must cover all derived side effects, not just the raw event insert.
- **VALIDATE**: `npm run typecheck -w @dayframe/web`

### 15. UPDATE `apps/web/src/app/api/events/route.ts`

- **IMPLEMENT**: Return a stable JSON shape for idempotent retries, for example `{ eventId, candidate, duplicate?: true }`. Keep status `201` for new events; `200` is acceptable for duplicate replays if callers only require `response.ok`.
- **PATTERN**: Existing response at `apps/web/src/app/api/events/route.ts:13`.
- **IMPORTS**: None.
- **GOTCHA**: Mobile `syncQueue()` should only rely on `response.ok`, not exact status.
- **VALIDATE**: `npm run typecheck -w @dayframe/web`

### 16. UPDATE `apps/web/src/lib/event-service.ts`

- **IMPLEMENT**: Add server-side `health_workout_import` handling similar to sleep. Insert into `health_workouts` with workspace/user, external sample ID, workout type, start/stop, duration/distance/energy summary fields, source device if available, and raw payload. Use `on conflict do nothing` for dedupe.
- **PATTERN**: Sleep insert at `apps/web/src/lib/event-service.ts:137`.
- **IMPORTS**: Existing helpers are enough; add small local string/number parsing helpers if needed.
- **GOTCHA**: Workout imports should still create review items through `normalizeActivityEvent`; the audit row is not a confirmed time entry by itself.
- **VALIDATE**: `npm run typecheck -w @dayframe/web`

### 17. UPDATE `apps/mobile/src/lib/health.ts`

- **IMPLEMENT**: Add HealthKit workout/walking import alongside sleep. Add permission request for workout reads. Use anchored queries if the installed HealthKit version exposes `queryWorkoutSamplesWithAnchor`; otherwise use the documented workout query API with local seen-ID dedupe. Queue each workout as:

```ts
{
  source: "health_workout",
  type: "health_workout_import",
  occurredAt: new Date(startedAt),
  description: "Workout walking",
  rawPayload: {
    provider: "healthkit",
    externalSampleId,
    workoutType,
    startedAt,
    stoppedAt,
    durationSeconds,
    distanceMeters,
    energyKcal,
    sourceName
  }
}
```

- **PATTERN**: Sleep import at `apps/mobile/src/lib/health.ts:97`.
- **IMPORTS**: Existing dynamic HealthKit import; maybe shared workout mapping helpers from `@dayframe/shared`.
- **GOTCHA**: HealthKit APIs differ by library version. Read installed package typings before coding. Keep raw payload minimal and avoid heart-rate/routes unless explicitly requested.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`

### 18. CREATE `apps/mobile/src/lib/health.test.ts`

- **IMPLEMENT**: Test pure mapping helpers for sleep and workout sample payloads. Validate that workout events use source `health_workout`, type `health_workout_import`, ISO times, stable external sample IDs, and no raw precise route data.
- **PATTERN**: Shared HealthKit stage tests at `packages/shared/test/event-engine.test.ts:208`.
- **IMPORTS**: `describe`, `expect`, `it` from `vitest`; pure mapping helpers from `./health` or `@dayframe/shared`.
- **GOTCHA**: Do not import the native HealthKit module in tests.
- **VALIDATE**: `npm run test -w @dayframe/mobile`

### 19. UPDATE `apps/mobile/app/index.tsx`

- **IMPLEMENT**: Add HealthKit workout/walking UI actions/status next to sleep. Keep the surface compact: one HealthKit panel can show sleep and workout status/actions. After import, call `syncAndReload()` so hosted review items appear.
- **PATTERN**: Current HealthKit panel at `apps/mobile/app/index.tsx:597`.
- **IMPORTS**: New HealthKit functions/status types from `@/lib/health`.
- **GOTCHA**: Keep HealthKit unavailable errors friendly for Simulator/Expo Go, but do not claim support outside native iOS builds.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`

### 20. UPDATE `apps/mobile/src/lib/geofence.ts`

- **IMPLEMENT**: Add a helper such as `refreshGeofencesForPlaces(places)` that checks existing permissions and starts monitors without re-prompting. Keep `TaskManager.defineTask` at module top level. Keep the 20-region cap and priority/smaller-radius sort.
- **PATTERN**: Current top-level task and cap at `apps/mobile/src/lib/geofence.ts:18` and `apps/mobile/src/lib/geofence.ts:62`.
- **IMPORTS**: Existing Expo Location/TaskManager imports.
- **GOTCHA**: Do not send raw coordinates in background event `rawPayload`; place ID and radius are enough.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`

### 21. UPDATE `apps/mobile/app/index.tsx`

- **IMPLEMENT**: After hosted bootstrap loads authenticated places, call the non-prompting geofence refresh when background location permission is already granted. Keep the explicit "Enable" action for first-time permission requests.
- **PATTERN**: Current `enableLocation` at `apps/mobile/app/index.tsx:280`.
- **IMPORTS**: New geofence helper from `@/lib/geofence`.
- **GOTCHA**: Avoid permission prompts on every app load.
- **VALIDATE**: `npm run typecheck -w @dayframe/mobile`

### 22. UPDATE `apps/mobile/app.json` OR CREATE `apps/mobile/app.config.ts`

- **IMPLEMENT**: Configure hosted iOS build identity and environment-aware variants. At minimum, replace `local.dayframe.app` for production with a real reverse-DNS bundle identifier, keep `scheme: "dayframe"`, preserve `UIBackgroundModes`, preserve HealthKit plugin config, and add any required SecureStore plugin config if using `requireAuthentication` later.
- **PATTERN**: Existing app config at `apps/mobile/app.json:1`.
- **IMPORTS**: Config only.
- **GOTCHA**: If converting to `app.config.ts`, make sure Expo still sees the same name, slug, plugins, typed route experiment, permissions, and assets. Do not break existing native project expectations.
- **VALIDATE**: `npm run ios:prebuild -- --clean`

### 23. CREATE `apps/mobile/eas.json` OR root `eas.json`

- **IMPLEMENT**: Add EAS profiles:
  - `development`: development client, internal distribution, hosted preview API base or local override.
  - `preview`: internal distribution, hosted Vercel preview/production API base.
  - `production`: production distribution, hosted production API base.

Example env key:

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_DAYFRAME_API_BASE": "https://your-vercel-domain.vercel.app"
      }
    }
  }
}
```

- **PATTERN**: Mobile scripts in `apps/mobile/package.json:6`.
- **IMPORTS**: Config only.
- **GOTCHA**: Do not commit real private endpoints if the deployment is private. Placeholder values are okay; actual values can be configured in EAS environment variables.
- **VALIDATE**: `cd apps/mobile && npx eas build:configure --non-interactive`

### 24. UPDATE `docs/vercel-supabase-hosting.md`

- **IMPLEMENT**: Cross-link the new iOS runbook. Clarify that mobile builds use the Vercel URL as `EXPO_PUBLIC_DAYFRAME_API_BASE` and do not require Supabase service-role keys or direct Supabase table access.
- **PATTERN**: Existing auth model at `docs/vercel-supabase-hosting.md:50`.
- **IMPORTS**: None.
- **GOTCHA**: Keep the hosting doc concise; put detailed mobile validation in the new runbook.
- **VALIDATE**: `rg -n "ios-hosted-supabase|EXPO_PUBLIC_DAYFRAME_API_BASE|service-role" docs/vercel-supabase-hosting.md`

### 25. VERIFY local development still works

- **IMPLEMENT**: Run local DB setup and local mobile type/tests. If config guards block local dev, adjust `config.ts` to allow localhost only in local/dev mode.
- **PATTERN**: Local auth/mobile instructions in `docs/local-auth-and-hosting-plan.md:67`.
- **IMPORTS**: None.
- **GOTCHA**: The migration must not make Simulator development impossible.
- **VALIDATE**:

```bash
npm run db:up
npm run db:setup
npm run test -w @dayframe/mobile
npm run typecheck -w @dayframe/mobile
```

### 26. VERIFY hosted provider auth and mobile API smoke path

- **IMPLEMENT**: Against a Vercel deployment with `DAYFRAME_AUTH_MODE=provider`, test signup/login, bootstrap, start timer, stop timer, queue sync, and logout from the iOS app. Use an allowlisted email. If Supabase email confirmation is enabled, verify the mobile confirmation state and subsequent login after confirming.
- **PATTERN**: Hosted setup in `docs/vercel-supabase-hosting.md:31`.
- **IMPORTS**: None.
- **GOTCHA**: Do not paste real credentials or tokens into logs, docs, screenshots, or commits.
- **VALIDATE**:

```bash
EXPO_PUBLIC_DAYFRAME_API_BASE=https://your-vercel-domain.vercel.app npm run ios -w @dayframe/mobile
```

### 27. RUN full repository validation

- **IMPLEMENT**: Run the broad checks after all changes.
- **PATTERN**: `docs/dayframe-regression-checklist.md:49`.
- **IMPORTS**: None.
- **GOTCHA**: Do not claim mobile native behavior passed unless a native iOS build/device was actually used.
- **VALIDATE**:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

### 28. RUN native iOS validation

- **IMPLEMENT**: Use a native development/internal build on a physical iPhone. Validate login, hosted bootstrap, start/stop sync with web, queue offline then reconnect, shortcut deep links, geofence permission/monitoring, HealthKit sleep import, HealthKit workout/walking import, review item creation, and logout/session revocation.
- **PATTERN**: Native constraints in `docs/production-readiness.md:77` and `docs/production-readiness.md:92`.
- **IMPORTS**: None.
- **GOTCHA**: HealthKit and background geofencing cannot be fully validated in Expo Go.
- **VALIDATE**:

```bash
cd apps/mobile && npx eas build --profile preview --platform ios
```

---

## TESTING STRATEGY

### Unit Tests

- `apps/mobile/src/lib/config.test.ts`: API base normalization and production guard behavior.
- `apps/mobile/src/lib/api.test.ts`: hosted auth payloads, email-confirmation signup, 401 session clearing, ordered offline queue retry, idempotent replay success handling.
- `apps/mobile/src/lib/health.test.ts`: pure HealthKit sleep/workout mapping and event payload shape.
- `packages/shared/test/event-engine.test.ts`: extend for `clientEventId` schema compatibility and any shared workout mapping helpers.

### Integration Tests

- Local API/database integration through `npm run db:setup`, `npm run dev:web`, and mobile pointing at localhost.
- Hosted provider-mode smoke test through Vercel URL with Supabase Auth/Postgres.
- Event idempotency smoke test: post the same queued event with the same `clientEventId` twice and verify only one `activity_events` row and one derived review/entry side effect.
- HealthKit workout server ingest smoke test: post a representative `health_workout_import` payload to `/api/events` and verify `activity_events`, `review_items`, and `health_workouts` rows.

### Edge Cases

- Signup allowlist denies an unlisted email.
- Supabase email confirmation enabled: signup returns `202`, mobile stores no token, user can later log in after confirmation.
- Session expired/revoked: API returns 401, mobile clears SecureStore token and shows signed-out state.
- Hosted API base missing in production build: app fails clearly before making localhost requests.
- Offline queue contains start then stop; first event fails, stop is not sent out of order.
- Network timeout after server persisted event; retry with same `clientEventId` does not duplicate derived rows.
- Broad geofence and Home geofence remain review-first.
- HealthKit unavailable on Simulator or Expo Go shows unavailable state without crashing.
- Duplicate HealthKit sleep/workout samples are deduped locally and server-side.
- Vercel/Supabase error responses are shown without assuming JSON shape.

---

## VALIDATION COMMANDS

Execute every command that applies to the implementation scope. Do not claim a command passed if it was not run.

### Level 1: Syntax & Style

```bash
npm run lint
npm run typecheck
npm run typecheck -w @dayframe/mobile
```

### Level 2: Unit Tests

```bash
npm run test -w @dayframe/shared
npm run test -w @dayframe/web
npm run test -w @dayframe/mobile
npm run test
```

### Level 3: Database/API Integration

```bash
npm run db:up
npm run db:setup
npm run dev:web
```

Manual API smoke examples, using throwaway test credentials only:

```bash
curl -i https://your-vercel-domain.vercel.app/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"allowlisted@example.com","password":"test-password"}'
```

```bash
curl -i https://your-vercel-domain.vercel.app/api/bootstrap \
  -H 'Authorization: Bearer <dayframe-app-session-token>'
```

### Level 4: Build

```bash
npm run build
npm run ios:prebuild
```

Hosted iOS dev run:

```bash
EXPO_PUBLIC_DAYFRAME_API_BASE=https://your-vercel-domain.vercel.app npm run ios -w @dayframe/mobile
```

EAS internal/preview build:

```bash
cd apps/mobile && npx eas build --profile preview --platform ios
```

### Level 5: Manual iPhone Validation

- Install the native iOS build on a physical iPhone.
- Log in with an allowlisted hosted account.
- Confirm `/api/bootstrap` loads hosted projects, places, active timer, entries, and review count.
- Start a timer on iOS; verify it appears on web.
- Stop the timer on web; verify mobile reflects the stopped state after refresh/poll.
- Turn off network, queue a quick action and shortcut action, reconnect, sync, and verify ordered event processing.
- Enable location, start geofences for known places, and verify enter/exit events become `activity_events` and review items unless trusted rules say otherwise.
- Request HealthKit permission, sync sleep, and verify sleep review/audit rows.
- Sync workouts/walks and verify workout review/audit rows.
- Logout and confirm the hosted session is revoked for subsequent mobile requests.

---

## ACCEPTANCE CRITERIA

- [ ] iOS production/preview builds do not default to `http://localhost:3000`.
- [ ] iOS app authenticates against hosted provider-mode Dayframe API and stores only the Dayframe app session token in SecureStore.
- [ ] Signup email-confirmation responses are handled without attempting to store an undefined token.
- [ ] Web and mobile share hosted active timer state.
- [ ] Mobile direct timer actions still attempt immediate API sync and queue only on recoverable failures.
- [ ] Offline queue sync is ordered and idempotent.
- [ ] Retried queued events do not duplicate `activity_events`, `time_entries`, `review_items`, sleep segments, or workout rows.
- [ ] Geofence task remains top-level and hosted place data can refresh monitored regions.
- [ ] HealthKit sleep and workout/walking summaries queue event-first and sync to hosted review/audit rows.
- [ ] Broad/unknown/Home-like geofence signals remain review-first unless user rules say otherwise.
- [ ] EAS/internal iOS build path is documented and can inject the hosted API base.
- [ ] Supabase/Vercel setup docs cover required env vars and do not require mobile service-role keys.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build` pass.
- [ ] Physical iPhone smoke test validates hosted login, sync, geofence, HealthKit, queue, and logout.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order.
- [ ] Each task validation passed immediately after implementation.
- [ ] Supabase hosted migration applied to the target project.
- [ ] Vercel Production and Preview env vars configured.
- [ ] EAS env/profile configured for hosted API base.
- [ ] Mobile unit tests added and passing.
- [ ] Shared/web tests updated and passing.
- [ ] Full repo validation passing.
- [ ] Native iOS build tested on physical iPhone.
- [ ] Docs updated with final hosted URL placeholders, no secrets.
- [ ] No generated QA screenshots or local `.codex` artifacts staged unless explicitly requested.

---

## NOTES

- "Using Supabase" for mobile should mean using the hosted Dayframe API backed by Supabase, not direct Supabase table writes from iOS.
- Do not add Supabase service-role keys to mobile, docs examples, EAS env, or Vercel client-visible env.
- If a future implementation wants mobile to use Supabase Auth directly, add a backend session-exchange endpoint that turns a Supabase user/session into the existing Dayframe app session token. Do not replace the current Dayframe app session flow without updating web/mobile together.
- Keep HealthKit payloads minimal. Do not import raw workout routes, heart-rate streams, or precise location samples unless a future product decision explicitly asks for them.
- The riskiest parts are HealthKit workout API differences, iOS background geofence behavior on physical devices, and event idempotency around derived side effects.

## Report

- **Summary**: Move iOS from local dev server assumptions to hosted Vercel API backed by Supabase Auth/Postgres, while completing mobile auth, sync reliability, HealthKit workout import, geofence refresh, and EAS deployment setup.
- **Plan File**: `.codex/plans/migrate-ios-to-hosted-supabase.md`
- **Complexity**: High, because it touches mobile runtime config, auth UX, database schema, event processing side effects, native iOS capabilities, and hosted deployment.
- **Key Risks**: HealthKit native API/version differences, physical-device-only validation, Supabase email-confirmation flow, Vercel/Supabase env drift, and avoiding duplicate events after offline retries.
- **Confidence Score**: 8/10 for one-pass implementation if the execution agent validates the referenced docs and tests on a physical iPhone before declaring completion.
