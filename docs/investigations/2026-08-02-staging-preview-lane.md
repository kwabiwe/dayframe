# Dayframe staging preview lane

## Decision

Dayframe uses a separate Supabase project for pre-merge testing. Production remains `https://dayframe-web.vercel.app`; the selected Preview deployment is promoted to `https://dayframe-staging.vercel.app`. Branch Preview deployments and the stable alias use staging Supabase credentials only.

## Safety boundary

- Production Vercel variables and production Supabase were not changed.
- Vercel Preview uses the staging transaction pooler, project URL and publishable key.
- The legacy production anon key was removed from Preview to prevent cross-project authentication mistakes.
- Preview location semantics remain `v2_shadow`.
- Staging uses a separate Auth user and workspace.
- Database migrations must pass on staging before production rollout.
- The stable alias points to one explicitly selected PR deployment at a time.
- Vercel Authentication is disabled so native iOS can reach the stable alias; Dayframe provider authentication remains mandatory for application and API data.

## Mobile contract

The EAS `preview` profile targets `https://dayframe-staging.vercel.app`; `production` remains fixed to `https://dayframe-web.vercel.app`. Preview release-channel configuration must include an explicit API base, and staging builds show a visible badge.

## Provisioning evidence

On 2026-08-02 the empty staging project accepted the base schema and every hosted migration through `202608010001_health_sleep_session_reconciliation.sql`. Verification found 36 public tables, 60 RLS policies, 88 indexes, `time_entries.user_edited_at`, and the Review mutation receipt table. Both the transaction and session pooler connections passed without exposing credentials.

## Promotion and validation

1. Complete automated validation on the PR branch.
2. Confirm the Vercel Preview deployment is Ready and uses staging environment variables.
3. Smoke-test staging login and initial workspace provisioning.
4. Promote that deployment to `dayframe-staging.vercel.app`.
5. Confirm the alias is reachable by browser and native iOS without an interactive Vercel protection barrier.
6. Build the internal mobile preview and verify its diagnostics report the staging API.
7. Test web/mobile start, stop, edit, refresh, persistence and logout against the staging workspace.
8. Merge only after review. Apply new migrations to production before deploying schema-dependent production code.

## Hosted evidence

PR #153 deployed successfully, was merged to `main` as `6e93855`, and `dayframe-staging.vercel.app` was assigned to its Ready Preview deployment. The first anonymous request reproduced a Vercel SSO redirect. Project-level Vercel Authentication was then disabled, after which the stable `/login` route returned the Dayframe page with HTTP 200 and anonymous `/api/bootstrap` returned HTTP 401. The post-merge production Vercel deployment completed successfully; production `/login` returned HTTP 200 and anonymous `/api/bootstrap` returned HTTP 401. Production application authentication and Supabase configuration remain separate from staging.

## Remaining evidence

- Hosted staging login and first workspace provisioning.
- Physical-iPhone internal preview build and cross-surface smoke test.
- Light/Dark, narrow layout and accessibility review of the staging badge.
- Separate staging iOS bundle identity; deferred and tracked outside this PR. Until then, preview installation may replace the TestFlight/production app.
