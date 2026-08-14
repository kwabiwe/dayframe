# Vercel And Supabase Hosting

Dayframe uses separate hosted lanes:

- production: `https://dayframe-web.vercel.app` with production Supabase;
- staging: `https://dayframe-staging.vercel.app` with the `dayframe-staging` Supabase project.

The stable staging alias is deliberately promoted to one selected Vercel Preview deployment at a time. Ordinary branch Preview URLs use the same Preview-scoped staging credentials.

## Credentials Needed

Provide these values from Supabase and Vercel when you want the hosted deployment connected:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable public key, usually starting with `sb_publishable_`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: legacy Supabase anon JWT fallback if your project still uses legacy API keys.
- `DATABASE_URL`: Supabase Postgres pooled connection string. Use the pooler URL as provided by Supabase; do not add an SSL-mode query parameter if that prevents the Vercel deployment from connecting.
- `DAYFRAME_ALLOWED_SIGNUP_EMAILS`: comma-separated emails allowed to create accounts.
- `DAYFRAME_SESSION_TTL_SECONDS`: optional absolute app-session TTL, 60 seconds through 365 days; defaults to 30 days and applies equally to cookie and database expiry.
- `DAYFRAME_LOCATION_ROLLOUT_MODE`: server-authoritative `v1`, `v2_shadow`, `v2_review`, or `v2_enabled`; keep the fail-closed `v2_shadow` value unless the tracker decision/evidence explicitly approves another mode.
- `GEOAPIFY_API_KEY`: server-only Geoapify key used by the authenticated web
  place-search and Review map-tile routes. Never expose it through a
  `NEXT_PUBLIC_` variable.
- `EXPO_PUBLIC_DAYFRAME_API_BASE`: hosted Vercel URL for mobile builds.
- `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and `APNS_BUNDLE_ID`:
  server-only Apple provider-token credentials and the Dayframe app bundle ID.
- `CRON_SECRET`: server-only bearer value Vercel supplies to protected cron
  requests, including the Live Activity delivery reconciliation sweep.

Do not paste the Supabase service-role key into chat unless an admin-only backend task explicitly needs it. The current app does not need it for login/signup.

## Supabase Setup

1. Create a Supabase project.
2. Run the base Dayframe migration from `packages/db/migrations/001_init.sql`.
3. Run every hosted migration in `supabase/migrations/` in timestamp order.
   Live Activity delivery retries require
   `202608060003_live_activity_delivery_outbox.sql` and
   `202608120001_time_entry_place_label.sql` before the corresponding API
   is deployed.
4. In Auth settings, choose whether email confirmation is required.
   - For personal sideload/beta testing, disabling confirmation is simplest.
   - If confirmation is enabled, signup will return a “check your email” state and the user logs in after confirmation.

## Vercel Environment

Never copy production database or Supabase credentials into Vercel Preview. Preview must use the staging project; Production must use production. Set `NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV=staging` for Preview so signed-in web surfaces show the staging badge. Keep the variable absent in Production.

After changing Preview variables, create a new Preview deployment; existing deployments retain their original environment snapshot. Promote the selected deployment with:

```bash
vercel alias set <preview-deployment-url> dayframe-staging.vercel.app
```

Before promotion, confirm the deployment is a Preview, its schema is current, and login reaches the staging account. The alias is a deliberate single-PR test lane, not an automatic alias for every branch.

Vercel Authentication is disabled for this project because it intercepted the stable `.vercel.app` staging alias and native iOS cannot complete Vercel's interactive SSO flow. Dayframe's own provider authentication remains the application boundary: anonymous API requests fail closed, signups remain controlled by the configured allowlist/switch, and no database credentials are exposed to clients.

Create the Vercel project from the repository root so npm workspaces can install `packages/shared`. Keep the framework preset as Next.js, set the build command to `npm run build`, and use the default Next.js output from `apps/web/.next`.

Set these Vercel environment variables for Production and Preview:

```bash
DAYFRAME_AUTH_MODE=provider
DATABASE_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
DAYFRAME_ALLOWED_SIGNUP_EMAILS=you@example.com,friend@example.com
DAYFRAME_SIGNUPS_ENABLED=false
DAYFRAME_SESSION_TTL_SECONDS=2592000
DAYFRAME_LOCATION_ROLLOUT_MODE=v2_shadow
# Preview only; omit in Production.
NEXT_PUBLIC_DAYFRAME_DEPLOYMENT_ENV=staging
GEOAPIFY_API_KEY=...
APNS_KEY_ID=...
APNS_TEAM_ID=...
APNS_PRIVATE_KEY=...
APNS_BUNDLE_ID=com.layereight.dayframe
CRON_SECRET=...
```

If your Supabase project still uses legacy API keys, `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works. Prefer the publishable key for new Supabase projects.

For `DATABASE_URL`, the Supabase pooler string may work without an `sslmode` query parameter. Keep the value aligned with the connection string that actually succeeds in Vercel.

Optional integration tokens:

```bash
DAYFRAME_INGEST_TOKEN=...
```

APNs delivery uses a durable per-token outbox. Timer mutations enqueue the
newest state before the immediate provider request. Network failures, 429, and
5xx responses retry with bounded backoff and `Retry-After`; permanent failures
stop, and invalid/expired tokens are invalidated. Authenticated timer-state
reads reconcile due rows promptly. `vercel.json` adds a protected daily sweep,
which is the highest cron frequency available on this project's current Hobby
plan; do not silently change that schedule without checking the Vercel plan.
Diagnostics include status, sanitized Apple reason, APNs request ID, and counts,
but never device tokens, provider keys, or session credentials.

## Web Place Search And Review Maps

For local development, create a Geoapify project/key and set
`GEOAPIFY_API_KEY` in the repository `.env`. The browser calls Dayframe's
authenticated `/api/place-search`, `/api/map-style`, and `/api/map-tiles/*`
routes; only those server routes call Geoapify. Do not add
`NEXT_PUBLIC_GEOAPIFY_API_KEY`, print the key, include it in screenshots, or
send it in a response payload. Review map tiles are private browser-cacheable
and require the normal Dayframe session; the style response contains only a
relative same-origin tile template and the required provider/data attribution.

Add `GEOAPIFY_API_KEY` separately to both Vercel Preview and Production
environments. Adding or changing an environment variable only affects new
deployments, so redeploy the relevant Preview or Production deployment
afterwards. A preview without the key remains usable: search reports a
friendly unavailable state, place editing still supports Current location and
Advanced coordinates, and Review keeps its explicit tile-free evidence canvas.

Geoapify search results must retain visible Geoapify and OpenStreetMap
attribution. The default Review map retains Geoapify, OpenMapTiles, and
OpenStreetMap attribution. An optional `NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL`
override remains supported only when its tile/provider attribution and CSP
requirements are also preserved.

## Auth Model

Supabase Auth owns identity and password verification. Dayframe provisions a matching `public.users` row with the Supabase user UUID, creates a personal workspace on first signup/login, and issues a Dayframe app session token stored in `auth_sessions`.

The web app uses an HTTP-only `dayframe_session` cookie. The mobile app receives the same Dayframe token as a bearer token and stores it in SecureStore.

For mobile builds, set `EXPO_PUBLIC_DAYFRAME_API_BASE` to the environment's Vercel URL: `dayframe-staging.vercel.app` for `preview`, and `dayframe-web.vercel.app` for `production`. Do not point mobile builds at the Supabase project URL, do not write directly to Supabase tables from iOS, and do not put service-role keys in EAS or app config. Preview and production currently share one iOS bundle identity, so installing a preview build may replace the existing TestFlight/production app; a separate staging identity is deferred.

See `docs/ios-hosted-supabase-runbook.md` for the iOS/EAS setup and physical-device validation checklist.

## Personal Beta Defaults

- Single-user/friends testing.
- Signups restricted by email allowlist.
- No billing.
- iOS-only mobile app.
- Health and location data stay in Dayframe-owned tables and should be exportable/deletable before a broader beta.
