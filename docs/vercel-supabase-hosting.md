# Vercel And Supabase Hosting

Dayframe uses separate hosted lanes:

- production: `https://dayframe-web.vercel.app` with production Supabase in
  Frankfurt (`eu-central-1`);
- staging: `https://dayframe-staging.vercel.app` with the `dayframe-staging`
  Supabase project in Paris (`eu-west-3`).

The Vercel project Function Region is `fra1` (Frankfurt). Application compute
is intentionally kept in Europe, close to both databases, to avoid unnecessary
application-to-database latency. Production and Preview/staging remain separate
Supabase environments.

The project Function Region setting applies to newly created deployments.
Existing deployments retain the region they were built with until replaced by
a new deployment.

The stable staging hostname is deliberately pointed to one explicitly selected
Vercel Preview deployment at a time. Ordinary branch Preview URLs use the same
Preview-scoped staging credentials. Production remains
`https://dayframe-web.vercel.app`.

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
- `MAPKIT_JS_TEAM_ID`, `MAPKIT_JS_KEY_ID` and `MAPKIT_JS_PRIVATE_KEY`: server-only Apple MapKit JS key (the `.p8` text; one line with escaped newlines is fine) for the place and trip dialogs' Apple map. Preview uses the staging key, Production the production key. Optional: without all three the web keeps its MapLibre map.
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

After changing Preview variables, create a new Preview deployment; existing deployments retain their original environment snapshot. Point the stable staging hostname at the selected Preview with:

```bash
vercel alias set <preview-deployment-url> dayframe-staging.vercel.app
```

Before changing the staging alias, confirm the deployment is a Preview, its schema is current, and login reaches the staging account. `vercel alias set ... dayframe-staging.vercel.app` is the staging operation. Do not use `vercel promote`, which assigns a Production deployment. The alias is a deliberate single-PR test lane, not an automatic alias for every branch.

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
# Staging key on Preview, production key on Production.
MAPKIT_JS_TEAM_ID=...
MAPKIT_JS_KEY_ID=...
MAPKIT_JS_PRIVATE_KEY=...
APNS_KEY_ID=...
APNS_TEAM_ID=...
APNS_PRIVATE_KEY=...
# Production: com.layereight.dayframe. Preview (staging): com.layereight.dayframe.staging — the topic must
# be the app that registered the token, or APNs answers DeviceTokenNotForTopic (staging, 21–24 Oct 2026).
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
Authentication diagnostics use a coordinate-free route template, never the
requested XYZ values. Provider tile bodies are streamed through a hard 3 MB
limit and cancelled as soon as that limit is exceeded.

Add `GEOAPIFY_API_KEY` separately to both Vercel Preview and Production
environments. Adding or changing an environment variable only affects new
deployments, so redeploy the relevant Preview or Production deployment
afterwards. A preview without the key remains usable: search reports a
friendly unavailable state, place editing still supports Current location and
Advanced coordinates, and Review keeps its explicit tile-free evidence canvas.

### Apple MapKit JS (UI review, owner 29 Oct 2026)

The place and trip dialogs draw Apple's map, the same map as the iPhone, when the server has a MapKit JS key. The
browser asks the authenticated `/api/mapkit-token` once per page; it signs a 30-minute ES256 token on the server,
locked to the page's own origin, and answers 404 when the three variables aren't all set, which keeps the MapLibre
map. MapKit JS loads from `https://cdn.apple-mapkit.com` (the web app sends no Content-Security-Policy today; one
added later must allow that CDN and Apple's map hosts). An authorisation or load failure falls back to MapLibre for
the rest of the page. The key comes from Certificates, Identifiers & Profiles › Keys (MapKit JS, tied to the Maps ID
`maps.com.layereight.dayframe.web`), one key for staging and one for production so each can be revoked alone. Adding
the variables needs a redeploy to take effect.

Geoapify search results must retain visible Geoapify and OpenStreetMap
attribution. The default Review map retains Geoapify, OpenMapTiles, and
OpenStreetMap attribution. An optional `NEXT_PUBLIC_DAYFRAME_MAP_STYLE_URL`
override remains supported only when its tile/provider attribution and CSP
requirements are also preserved.

## Auth Model

Supabase Auth owns identity and password verification. Dayframe provisions a matching `public.users` row with the Supabase user UUID, creates a personal workspace on first signup/login, and issues a Dayframe app session token stored in `auth_sessions`.

The web app uses an HTTP-only `dayframe_session` cookie. The mobile app receives the same Dayframe token as a bearer token and stores it in SecureStore.

For mobile builds, set `EXPO_PUBLIC_DAYFRAME_API_BASE` to the environment's Vercel URL: `dayframe-staging.vercel.app` for `preview`, and `dayframe-web.vercel.app` for `production`. Do not point mobile builds at the Supabase project URL, do not write directly to Supabase tables from iOS, and do not put service-role keys in EAS or app config. Preview uses the separate `com.layereight.dayframe.staging` identity and isolated App Group/keychain containers, so it can coexist with TestFlight/production on one device.

See `docs/ios-hosted-supabase-runbook.md` for the iOS/EAS setup and physical-device validation checklist.

### Forgot password (UIA-317)

Log in offers "Forgot password?" in provider mode. `POST /api/auth/password-reset` answers at once with the same "check your email" reply for any well-formed address, then (after the response, through Next's `after`) asks Supabase Auth (`resetPasswordForEmail`) to email a recovery link back to the same deployment's `/reset-password` page. Neither an account's cooldown, a delivery failure nor Supabase's timing changes the reply; failures are logged without the address. The page is a signed-out page (no app shell and no automatic redirect to Log in, like Log in and Sign up), so ending the visitor's own sessions never takes it away mid-reset. It reads the recovery session from the link's fragment, removes it from the address bar, and posts the new password to `POST /api/auth/password-reset/complete`. That route first makes sure the account has its Dayframe row (as a first sign-in would), then ends every Dayframe sign-in for the user (web and iPhone) — recording the reset time in the server-only `user_session_fences` table and revoking sessions in one transaction under the user row's lock — then sets the password through the recovery session, ends sign-ins again, and signs out the user's Supabase sessions (the recovery session's tokens could otherwise change the password again). Creating a session (log in or sign up) takes the same row's share lock and refuses one whose password check came at or before the recorded reset, so a sign-in with the old password that was still finishing cannot survive. Each step repeats safely: a failure returns an error and the same page can try again (a repeat password change counts as done; a sign-in service outage keeps the link usable). Dev and local auth answer 404.

Hosted prerequisite (owner, Supabase dashboard, per project): Authentication › URL Configuration › Redirect URLs must allow `https://dayframe-web.vercel.app/reset-password` (production) and `https://dayframe-staging.vercel.app/reset-password` (staging; add the Preview pattern if Previews are tested). Supabase sends any other redirect to the project's Site URL instead. The default "Reset Password" email template works as-is (implicit flow; the link carries the session in its fragment). Until the URLs are allowed, the email arrives but its link lands on the Site URL rather than the reset page.

Auth email delivery (owner decision, 12 Oct 2026: deferred). Both projects still send auth email (password reset, confirmation) through Supabase's built-in mailer (Supabase's own sender address). It only delivers to members of the Supabase organisation's team — the Dayframe signup allowlist does not change that, so a friend on the allowlist gets no reset or confirmation email until custom SMTP is set up — and it is rate-limited (a repeat request within the cooldown returns `over_email_send_rate_limit`, which the app hides behind its uniform reply) and its mail often lands in spam, so a reset can look as if it never arrived even when the auth logs show `mail.send` (staging, 12 Oct). The owner plans to move Dayframe to its own domain and may later self-host Supabase; custom SMTP from that domain (with branded templates) is set up then, in the Supabase Auth dashboard by the owner. Until then, check spam and the project's auth logs before treating a missing reset email as a code fault.

## Personal Beta Defaults

- Single-user/friends testing.
- Signups restricted by email allowlist.
- No billing.
- iOS-only mobile app.
- Health and location data stay in Dayframe-owned tables and should be exportable/deletable before a broader beta.

### Activity icon and starter schema prerequisite

The server that reads activity icons, seeds starter activities for new workspaces and serves `POST /api/categories/starters` requires `supabase/migrations/202610060001_category_icon_and_starter_key.sql` (local `packages/db/migrations/008_category_icon_and_starter_key.sql`) before its Preview or production deployment. It adds two nullable `categories` columns with format checks and a partial unique index on active `(workspace_id, starter_key)`; no existing row changes. Without it, category reads fail with an error naming this migration. Staging validation is not production authorization.

### Place role schema prerequisite

The server that reads Home and Work place roles requires `supabase/migrations/202610070001_place_role.sql` (local `packages/db/migrations/009_place_role.sql`) before its Preview or production deployment. It adds a nullable `places.role` column with a `home`/`work` check and a partial unique index on `(workspace_id, role)`; no existing row changes and nothing is backfilled. Every place-name read selects the column, so without it bootstrap, entries, Review, Reports, search, exports and integrations fail: bootstrap and place writes name this migration, other reads fail with a Postgres undefined-column error. Staging validation is not production authorization.

### Place archive schema prerequisite

The server with Archive place (location v3 PR 15) requires `supabase/migrations/202610210001_place_archive.sql` (local `packages/db/migrations/016_place_archive.sql`) before its Preview or production deployment. It adds nullable `places.archived_at` and `places.matching_starts_at`; no existing row changes and nothing is backfilled. Every place read filters on it, so without it bootstrap and the Places page fail, naming this migration. Apply it to staging before the Preview, then to production before the server change merges (migration → server → phone). Older servers and phones ignore the column; an older phone simply stops seeing places archived from the web.

### Password reset schema prerequisite

The server with Forgot password requires `supabase/migrations/202610120001_user_session_fences.sql` (local `packages/db/migrations/011_user_session_fences.sql`) before its Preview or production deployment. It adds the empty `user_session_fences` table (user id, reset time) with RLS on, no policies and every `anon`/`authenticated` grant revoked, so only the server can read or write it; no existing row changes. Every sign-in reads it, so without it every sign-in fails. Apply it to staging before the Preview, then to production before the server change merges. Older servers ignore the table.

### Owner-only event and entry writes (hosted RLS)

`supabase/migrations/202610170003_owner_only_event_entry_writes.sql` narrows the client write policies on `activity_events` and `time_entries`: workspace members still read each other's rows, but only a row's own user can insert, change or delete it, as the location tables already require. `202610170004_time_entry_tags_owner_writes.sql` (apply after it) does the same for `time_entry_tags` (only the entry's user adds or removes its tags) and fixes its earlier policies' always-true workspace comparisons. No server or client depends on it (the server connects as the tables' owner, which RLS does not apply to), so it can be applied at any time and in either order with deploys. It needs the owner's approval like any hosted migration; then apply both, in order, to staging, verify `pg_policies` shows "users can write own rows" and "workspace members can read" on both tables and "users can write own time entry tags" and "workspace members can read time entry tags" on `time_entry_tags` (check each policy's command and its `qual`/`with_check` expressions, and that RLS is still enabled, not only the names), then production and the same verification, and only then merge. Reverting is re-creating only these tables' old write policies ("workspace members can write" from `202607020001_dayframe_rls.sql`, "workspace members can write time entry tags" from `202607180001_tags.sql`) and dropping the new ones.

### Counts toward goal schema prerequisite

The server that reads each activity's "Counts toward goal" switch requires `supabase/migrations/202610110001_category_counts_toward_goal.sql` (local `packages/db/migrations/010_category_counts_toward_goal.sql`) before its Preview or production deployment. It adds `categories.counts_toward_goal boolean not null default true` and, in the same run only, sets it false for the Sleep starter and any activity named Sleep; no other row changes. Every category read selects the column, so without it bootstrap, `/api/categories` and Reports fail (bootstrap names this migration). Apply it to staging before the Preview, then to production before the server change merges. Staging validation is not production authorization.

### Named pattern index prerequisite

Named patterns on Today (location v3 PR 14) read the stays at each end of a logged Move by owner and client segment id. Apply `supabase/migrations/202610210002_stay_segment_owner_client_index.sql` (local `packages/db/migrations/017_stay_segment_owner_client_index.sql`, mirrored in `001_init.sql`) to staging before the Preview and to production before the server change merges. It only adds `idx_stay_segments_owner_client` (partial on a non-null client segment id); without it the read is slower, not wrong. No RLS change.

### Place geography index prerequisite

Places at scale (location v3 PR 16a) reads saved places near a point through `idx_places_geography`. Apply `supabase/migrations/202610210003_place_geography_index.sql` (local `packages/db/migrations/018_place_geography_index.sql`, mirrored in `001_init.sql`) to staging before the Preview and to production before the server change merges. It only adds a GiST expression index on `places`; without it the search is slower, not wrong. No RLS change.

Places search, sections and last visit (location v3 PR 16c) read each place's last visit and visits in the last 30 days through `idx_stay_segments_place_visits`. Apply `supabase/migrations/202610210004_stay_segment_place_visit_index.sql` (local `packages/db/migrations/019_stay_segment_place_visit_index.sql`, mirrored in `001_init.sql`) to staging before the Preview and to production before the server change merges. It only adds a partial btree index on `stay_segments`; without it the read is slower, not wrong. No RLS change.

Venue Place IDs (location v3 PR 8) add `stay_segments.venue_place_id` and `suggested_venue_place_id` (nullable text) and the partial GiST index `idx_stay_segments_venue_history`. Apply `supabase/migrations/202610210005_stay_segment_venue_place_ids.sql` (local `packages/db/migrations/020_stay_segment_venue_place_ids.sql`, mirrored in `001_init.sql`) to staging before the Preview and to production before the server change merges: the server writes and reads both columns, so it must not deploy first. Additive, no backfill, no RLS change (the owner policies on `stay_segments` cover them).

### Motion & Fitness schema prerequisite

The server that accepts Motion & Fitness evidence requires `supabase/migrations/202610050001_location_motion_activity.sql` (local `packages/db/migrations/007_location_motion_activity.sql`) before its Preview or production deployment, and production must have it before any phone build that sends `motion_activity` is installed. It only widens the `location_evidence` kind check and adds a coordinate-free check for motion rows. Staging validation is not production authorization.

### Sync recovery schema prerequisite

The bounded sync server requires `supabase/migrations/202609040001_health_sleep_resolution_link.sql` before its Preview or production deployment. It adds nullable, owner-scoped lookup provenance for logical Sleep resolution without backfilling existing events. Validate against the existing staging schema and clean ordered local setup (`packages/db/migrations/006_health_sleep_resolution_link.sql`). An exact Review receipt remains authoritative and replays without rewriting the canonical entry. Production application of this migration remains part of the separately approved release; staging validation is not production authorization.
