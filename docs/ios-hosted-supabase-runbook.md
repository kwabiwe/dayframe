# iOS Hosted Supabase Runbook

Dayframe mobile production and beta builds use this hosted path:

```text
iOS app -> Vercel Next.js API -> Supabase Auth and Postgres
```

The iOS app does not write directly to Supabase tables. It authenticates with Dayframe API routes, stores the Dayframe app session token in SecureStore, and sends that token as `Authorization: Bearer <token>`.

## Required Services

- Supabase project with Auth, Postgres, and PostGIS enabled.
- Vercel project deployed from the repository root.
- Expo/EAS project for iOS internal or production builds.
- Apple Developer account with HealthKit and background location capabilities available for the app identifier.

## Supabase Setup

1. Create the Supabase project.
2. Run `packages/db/migrations/001_init.sql`.
3. Run all files in `supabase/migrations/` in timestamp order.
4. In Supabase Auth, decide whether email confirmation is required.
   - For a personal beta, disabling confirmation is simplest.
   - If confirmation is enabled, iOS signup shows a confirmation message and the user logs in after confirming email.

Never put the Supabase service-role key in the iOS app, EAS public env, screenshots, docs examples, or chat. Dayframe mobile does not need it.

## Vercel Environment

Set these for Production and Preview:

```bash
DAYFRAME_AUTH_MODE=provider
DATABASE_URL=postgres://postgres.[project-ref]:[password]@[pooler-host]:6543/postgres
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
DAYFRAME_ALLOWED_SIGNUP_EMAILS=you@example.com,friend@example.com
DAYFRAME_SIGNUPS_ENABLED=false
```

If the Supabase project still uses legacy keys, `NEXT_PUBLIC_SUPABASE_ANON_KEY` can be used as a fallback. Prefer the publishable key for new projects.

Use the Supabase pooler connection string that succeeds in Vercel. Do not add an SSL-mode query parameter when the deployed pooler URL only works without it.

## EAS Environment

`EXPO_PUBLIC_DAYFRAME_API_BASE` must point at the Vercel URL, not the Supabase URL:

```bash
EXPO_PUBLIC_DAYFRAME_API_BASE=https://your-vercel-domain.vercel.app
```

This value is public and is bundled into the app. Do not use `EXPO_PUBLIC_` for secrets.

Recommended EAS environments:

- `development`: development client or simulator testing.
- `preview`: internal distribution against a hosted preview or production Vercel URL.
- `production`: production build against the production Vercel URL.

## iOS Capabilities

The native build must preserve:

- URL scheme: `dayframe`
- Background modes: `location` and `fetch`
- Location usage strings for foreground and background geofencing
- HealthKit entitlement
- HealthKit usage strings

HealthKit and background geofence behavior require a native iOS build and physical-device validation. Expo Go is not enough.

## Physical iPhone Smoke Test

1. Install a native preview/internal build.
2. Log in with an allowlisted hosted account.
3. Confirm bootstrap loads categories, places, entries, active timer, and review count.
4. Start a timer on iOS and confirm it appears on web.
5. Stop the timer on web and confirm iOS refreshes to the stopped state.
6. Disable network, queue a quick action and shortcut action, reconnect, then sync.
7. Enable location and verify known-place geofences are monitored.
8. Verify geofence enter/exit events create `activity_events` and review items unless an explicit trusted rule starts or stops a timer.
9. Request HealthKit permission and import sleep.
10. Import workouts/walks.
11. Confirm health imports create review items and audit rows through the hosted API.
12. Logout and confirm subsequent authenticated requests require login.

## Local Development Rollback

For Simulator/local development, point mobile at the local web API:

```bash
EXPO_PUBLIC_DAYFRAME_API_BASE=http://localhost:3000 npm run ios -w @dayframe/mobile
```

For a physical iPhone talking to a local Mac, use the Mac LAN IP:

```bash
EXPO_PUBLIC_DAYFRAME_API_BASE=http://192.168.x.x:3000 npm run ios -w @dayframe/mobile
```

Keep local development in `DAYFRAME_AUTH_MODE=dev` or `DAYFRAME_AUTH_MODE=local`. Hosted beta testing should use `DAYFRAME_AUTH_MODE=provider`.
