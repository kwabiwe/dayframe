# Local Auth And Hosting Plan

Dayframe supports three auth modes:

```bash
DAYFRAME_AUTH_MODE=dev
DAYFRAME_AUTH_MODE=local
DAYFRAME_AUTH_MODE=provider
```

## Run Local Auth Mode

Local auth uses the existing Postgres database for users, workspaces and sessions.

```bash
cp .env.example .env
DAYFRAME_AUTH_MODE=local npm run db:up
DAYFRAME_AUTH_MODE=local npm run db:setup
DAYFRAME_AUTH_MODE=local npm run dev:web
```

Open `http://localhost:3000`. Logged-out users are redirected to `/login`.

## Create The First User

Use `/signup` in the web app, or call:

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "test1@dayframe.local",
    "password": "local-only-password",
    "name": "Local Test User",
    "workspaceName": "Local Test Workspace"
  }'
```

The password above is a local-only test value. Do not reuse it anywhere.

Signup creates:

- a `users` row with `password_hash`
- a `workspaces` row
- a `workspace_members` owner row
- a small default client/category/project set so the app can start timers immediately
- an `auth_sessions` row with a hashed session token

## Sessions And Logout

Web sessions use an HTTP-only `dayframe_session` cookie. Mobile sessions use the same app session token as a bearer token stored in Expo SecureStore.

Sessions are stored in `auth_sessions` with hashed tokens only, expiry, optional user agent, `last_used_at` and `revoked_at`.

To revoke all local sessions:

```sql
update auth_sessions set revoked_at = now() where revoked_at is null;
```

To remove expired/revoked sessions:

```sql
delete from auth_sessions where revoked_at is not null or expires_at < now();
```

## Mobile Local API

For Simulator, `localhost` usually points at the Mac, so this works:

```bash
EXPO_PUBLIC_DAYFRAME_API_BASE=http://localhost:3000 npm run ios -w @dayframe/mobile
```

For a physical iPhone, point the mobile app at your Mac's LAN IP:

```bash
EXPO_PUBLIC_DAYFRAME_API_BASE=http://192.168.x.x:3000 npm run ios -w @dayframe/mobile
```

The mobile app should log in through `/api/auth/login`; it should not use ingest tokens for normal user activity. In local auth mode, app sessions use the HTTP-only web cookie or `Authorization: Bearer <session-token>` for mobile. Ingest tokens remain for trusted bridge integrations such as a future Home Assistant bridge and should be sent with `x-dayframe-ingest-token`, not as the app Bearer token.

## Dev Mode

`DAYFRAME_AUTH_MODE=dev` is an unsafe local-only bypass. It uses `DAYFRAME_DEV_USER_ID` and `DAYFRAME_DEV_WORKSPACE_ID`, defaulting to the seeded demo user/workspace. Keep it for fast local development only.

Do not use dev mode for hosted testing.

## Provider Mode

`DAYFRAME_AUTH_MODE=provider` uses Supabase Auth for hosted identity and Dayframe app sessions for web/mobile API access.

Hosted defaults:

- Vercel for the Next.js web app/API routes.
- Supabase Postgres/Auth/PostGIS as the database and identity provider.
- Dayframe provisions a matching `public.users` row and personal workspace from the Supabase user UUID.
- The web app stores a Dayframe session in an HTTP-only `dayframe_session` cookie.
- Mobile stores the same Dayframe app session token in Expo SecureStore.
- Supabase RLS policies mirror `workspace_members`; see `supabase/migrations/202607020001_dayframe_rls.sql`.
- Keep integration tokens separate from user app sessions.

See `docs/vercel-supabase-hosting.md` for the deployment checklist.

## Secrets

Never commit:

- real user passwords
- session tokens
- ingest tokens
- Toggl API tokens
- Supabase service keys
- precise private addresses or raw personal location exports
