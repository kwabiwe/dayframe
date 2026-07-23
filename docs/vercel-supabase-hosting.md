# Vercel And Supabase Hosting

Dayframe production hosting uses Vercel for the Next.js web app/API routes and Supabase for Postgres plus Supabase Auth identity.

## Credentials Needed

Provide these values from Supabase and Vercel when you want the hosted deployment connected:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Supabase publishable public key, usually starting with `sb_publishable_`.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: legacy Supabase anon JWT fallback if your project still uses legacy API keys.
- `DATABASE_URL`: Supabase Postgres pooled connection string. Use the pooler URL as provided by Supabase; do not add an SSL-mode query parameter if that prevents the Vercel deployment from connecting.
- `DAYFRAME_ALLOWED_SIGNUP_EMAILS`: comma-separated emails allowed to create accounts.
- `GEOAPIFY_API_KEY`: server-only Geoapify key used by the authenticated web
  place-search route. Never expose it through a `NEXT_PUBLIC_` variable.
- `EXPO_PUBLIC_DAYFRAME_API_BASE`: hosted Vercel URL for mobile builds.

Do not paste the Supabase service-role key into chat unless an admin-only backend task explicitly needs it. The current app does not need it for login/signup.

## Supabase Setup

1. Create a Supabase project.
2. Run the base Dayframe migration from `packages/db/migrations/001_init.sql`.
3. Run the hosted security migration from `supabase/migrations/202607020001_dayframe_rls.sql`.
4. In Auth settings, choose whether email confirmation is required.
   - For personal sideload/beta testing, disabling confirmation is simplest.
   - If confirmation is enabled, signup will return a “check your email” state and the user logs in after confirmation.

## Vercel Environment

Create the Vercel project from the repository root so npm workspaces can install `packages/shared`. Keep the framework preset as Next.js, set the build command to `npm run build`, and use the default Next.js output from `apps/web/.next`.

Set these Vercel environment variables for Production and Preview:

```bash
DAYFRAME_AUTH_MODE=provider
DATABASE_URL=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
DAYFRAME_ALLOWED_SIGNUP_EMAILS=you@example.com,friend@example.com
DAYFRAME_SIGNUPS_ENABLED=false
GEOAPIFY_API_KEY=...
```

If your Supabase project still uses legacy API keys, `NEXT_PUBLIC_SUPABASE_ANON_KEY` also works. Prefer the publishable key for new Supabase projects.

For `DATABASE_URL`, the Supabase pooler string may work without an `sslmode` query parameter. Keep the value aligned with the connection string that actually succeeds in Vercel.

Optional integration tokens:

```bash
DAYFRAME_INGEST_TOKEN=...
```

## Web Place Search

For local development, create a Geoapify project/key and set
`GEOAPIFY_API_KEY` in the repository `.env`. The browser calls Dayframe's
authenticated `/api/place-search` route; only that server route calls
Geoapify. Do not add `NEXT_PUBLIC_GEOAPIFY_API_KEY`, print the key, include it
in screenshots, or send it in a response payload.

Add `GEOAPIFY_API_KEY` separately to both Vercel Preview and Production
environments. Adding or changing an environment variable only affects new
deployments, so redeploy the relevant Preview or Production deployment
afterwards. A preview without the key remains usable: search reports a
friendly unavailable state and the editor still supports Current location and
Advanced coordinates.

Geoapify search results must retain visible Geoapify and OpenStreetMap
attribution. If a MapLibre style is configured, its tile/provider attribution
must also remain visible.

## Auth Model

Supabase Auth owns identity and password verification. Dayframe provisions a matching `public.users` row with the Supabase user UUID, creates a personal workspace on first signup/login, and issues a Dayframe app session token stored in `auth_sessions`.

The web app uses an HTTP-only `dayframe_session` cookie. The mobile app receives the same Dayframe token as a bearer token and stores it in SecureStore.

For mobile builds, set `EXPO_PUBLIC_DAYFRAME_API_BASE` to the hosted Vercel URL so the iOS app syncs with production. Do not point mobile builds at the Supabase project URL, do not write directly to Supabase tables from iOS, and do not put service-role keys in EAS or app config.

See `docs/ios-hosted-supabase-runbook.md` for the iOS/EAS setup and physical-device validation checklist.

## Personal Beta Defaults

- Single-user/friends testing.
- Signups restricted by email allowlist.
- No billing.
- iOS-only mobile app.
- Health and location data stay in Dayframe-owned tables and should be exportable/deletable before a broader beta.
