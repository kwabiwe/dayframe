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
- Apple Developer account with HealthKit, background location, Push Notifications,
  App Groups, and Keychain Sharing available for the app and Live Activity
  extension identifiers.

## Supabase Setup

1. Create the Supabase project.
2. Run `packages/db/migrations/001_init.sql`.
3. Run all files in `supabase/migrations/` in timestamp order.
4. In Supabase Auth, decide whether email confirmation is required.
   - For a personal beta, disabling confirmation is simplest.
   - If confirmation is enabled, iOS signup shows a confirmation message and the user logs in after confirming email.

Never put the Supabase service-role key in the iOS app, EAS public env, screenshots, docs examples, or chat. Dayframe mobile does not need it.

## Vercel Environment

`docs/vercel-supabase-hosting.md` is the canonical Vercel environment inventory. Do not maintain a second partial list here. iOS depends on that runbook's provider-auth/database/signup settings plus the server-only Geoapify, session TTL, rollout, APNs, and cron variables when their features are enabled.

Preview must use the staging Supabase project and `NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV=staging`; production must use production Supabase and omit the staging marker. Use the Supabase pooler connection string that succeeds in Vercel. If the project still uses legacy API keys, `NEXT_PUBLIC_SUPABASE_ANON_KEY` remains a fallback, but new projects should use the publishable key.

## EAS Environment

`EXPO_PUBLIC_DAYFRAME_API_BASE` must point at the Vercel URL, not the Supabase URL:

```bash
EXPO_PUBLIC_DAYFRAME_API_BASE=https://your-vercel-domain.vercel.app
```

This value is public and is bundled into the app. Do not use `EXPO_PUBLIC_` for secrets.

Recommended EAS environments:

- `development`: development client or simulator testing.
- `preview`: internal distribution against the stable staging Vercel URL only.
- `production`: production build against the production Vercel URL.

Dayframe's checked-in profiles enforce these hosted targets:

- `preview` -> `https://dayframe-staging.vercel.app` and release channel `preview`;
- `production` -> `https://dayframe-web.vercel.app` and release channel `production`.

APNs environment is a signing property, not an API-environment property:

- the checked-in Xcode `Staging` configuration uses development provisioning and
  APNs Sandbox for direct Xcode installs against staging;
- EAS `preview` is an internal Ad Hoc distribution, so Apple signs it with the
  production APNs entitlement even though its API is staging;
- EAS `production` is App Store distribution and uses production APNs.

Do not pass `APS_ENVIRONMENT` as a shell override. `npm run check:ios-config`
asserts the checked-in lanes. After a signed build, also verify the actual app
and embedded extension:

```bash
node scripts/check-ios-build-config.mjs --signed-app /path/to/Dayframe.app
```

This distinction follows Apple's rule that `aps-environment` comes from the
provisioning profile and Expo's documented Ad Hoc internal-distribution model;
forcing a sandbox value into an Ad Hoc build produces a configuration/profile
mismatch rather than a valid sandbox preview.

A hosted preview build fails at startup if its API base is missing rather than silently falling back to production. Preview builds show a visible `STAGING` badge. Promote the intended PR deployment to the stable staging alias before building or testing the physical iPhone.

Preview and production currently share the `com.layereight.dayframe` iOS bundle identity. Installing a preview build may therefore replace the installed TestFlight/production app and reuse bundle-scoped device state. A separate `Dayframe Staging` identity is deferred; until then, treat each preview install as a deliberate replace-and-test cycle and confirm the visible badge and API base before mutating data.

## iOS Capabilities

The native build must preserve:

- URL scheme: `dayframe`
- Background modes: `location` and `fetch`
- Location usage strings for foreground and background geofencing
- HealthKit entitlement
- HealthKit usage strings
- App Group `group.com.layereight.dayframe` on both
  `com.layereight.dayframe` and
  `com.layereight.dayframe.DayframeLiveActivity`
- Keychain access group
  `$(AppIdentifierPrefix)com.layereight.dayframe.shared` on both targets

HealthKit and background geofence behavior require a native iOS build and physical-device validation. Expo Go is not enough.

In Certificates, Identifiers & Profiles, enable the App Group and Keychain
Sharing capabilities on both identifiers, then regenerate or refresh both
development and distribution provisioning profiles. The containing app writes
the allowlisted API base and app-session credential to the shared Keychain item.
The extension writes its fallback event to an atomically updated file in the
shared App Group. Existing private Keychain and `UserDefaults` values migrate on
first host-app access; they are removed only after the shared write succeeds.
The credential uses `AfterFirstUnlockThisDeviceOnly`, so a Lock Screen action
after a reboot cannot submit until the phone has been unlocked once, but the
shared queued event remains available for later reconciliation.

Relevant platform references:

- [Apple: Configuring App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups/)
- [Apple: Configuring Keychain Sharing](https://developer.apple.com/documentation/xcode/configuring-keychain-sharing)
- [Apple: `aps-environment`](https://developer.apple.com/documentation/bundleresources/entitlements/aps-environment)
- [Expo: Internal distribution](https://docs.expo.dev/build/internal-distribution/)
- [Expo: App extensions](https://docs.expo.dev/build-reference/app-extensions/)

## Live Activity Provider And Retry Setup

Apply `supabase/migrations/202608060003_live_activity_delivery_outbox.sql`
to staging before deploying the matching API. Configure the Preview Vercel
environment with `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`,
`APNS_BUNDLE_ID=com.layereight.dayframe`, and `CRON_SECRET`. Never expose these
through `EXPO_PUBLIC_` variables.

Every timer mutation persists the newest desired Live Activity state before its
first APNs attempt. Retryable network, 429, and 5xx failures stay pending with
bounded exponential backoff and `Retry-After` support. Authenticated timer-state
reconciliation supplies the normal retry cadence; the protected daily Vercel
cron is a durable sweep within the current Hobby-plan scheduling limit.
Permanent request/configuration failures stop retrying, while 410 and invalid or
unregistered device-token responses invalidate the token. Per-token revisions,
monotonic payload timestamps, and APNs collapse IDs prevent an older queued
state from superseding a newer one.

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
12. With the app backgrounded, tap Lock Screen Stop and confirm staging web
    becomes idle without the app opening.
13. Repeat with the app force-terminated after it has been opened and the device
    unlocked once. Confirm the event reaches staging; then repeat offline and
    confirm the host later drains exactly one queued event.
14. Logout and confirm subsequent authenticated requests require login.

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
