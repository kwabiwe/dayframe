# Web authentication and report safety

## User-reported issue

- The public landing page can appear where an authenticated Dayframe view is expected, including reports of landing content inside authenticated chrome or an apparently random return to login.
- Reports can aggregate another member's personal time when two users belong to the same workspace.

## Current-main reproduction

Baseline: `origin/main` commit `116fff2b80e93bbbd5263e75132bafe71bfa5f58` on 2026-07-22.

- Dev, local and provider page sessions remained authenticated through hard refresh, Dashboard -> Timeline -> Reports -> `/`, two tabs and a throttled double reload. No happy-path shell/landing mismatch or unexpected login redirect reproduced.
- Missing, invalid, expired, revoked and logged-out sessions rendered anonymous state as expected.
- A valid synthetic local app-session cookie with an unavailable disposable Postgres database reproduced the authentication defect: `/` returned `200` and the landing page. The same request returns `500` after the fix, allowing Next.js error handling to own the failure.
- In a disposable PostGIS database, synthetic User A and User B shared one workspace. User A had 10 report minutes and User B had 20. Before the fix, both `/reports` responses showed 30 minutes. After the fix, User A shows 10 and User B shows 20.
- Current shell/dashboard polling received repeated `401` responses after session expiry but had no shared handling path. Non-OK responses were ignored independently by each caller.

## Root cause

1. Root layout and root page independently called an uncached optional-session resolver. The helper caught every exception and returned `null`, so database, SQL, configuration and programming failures were indistinguishable from an anonymous session. Two independently resolved values could also disagree within one server render.
2. Local session resolution updated `auth_sessions.last_used_at` on every read, amplifying writes from layout/page resolution and one-second client polling.
3. Shell, Dashboard/Timeline and timer/profile/workspace client requests had no single `401` policy.
4. All four report aggregates filtered `time_entries` by `workspace_id` and range, but not `user_id`. Category/place joins were not explicitly workspace-qualified.

## Decision and alternatives

- Use one module-level React `cache()` wrapper around request-bound optional page-session resolution. Both root layout and root page import that exact function. A global cross-request user cache was rejected.
- Return `null` only for no cookie or an `AuthError` with status `401`; rethrow everything else. Message matching and blanket catches were rejected.
- Validate the local session with a read, then conditionally touch `last_used_at` only when it is at least 10 minutes old. The update repeats revoked/expiry checks and includes a database-side age condition for concurrent requests. Extending session TTL was rejected.
- Use one client fetch wrapper that redirects once on a genuine `401`, does not redirect on login/signup, and leaves `500`/transient failures on their normal error path. A competing auth event bus was not added.
- Add `workspace_id` plus `user_id` to by-category, by-source, by-place and daily-series report queries, with workspace-qualified category/place joins.

## Files changed

- `apps/web/src/lib/auth/server.ts`
- `apps/web/src/lib/auth/local.ts`
- `apps/web/src/lib/client-auth-fetch.ts`
- `apps/web/src/lib/queries.ts`
- Root layout/page and authenticated client consumers for the shared session/401 paths.
- Focused auth, client-response, timestamp-throttle and report-isolation tests.
- This investigation and `docs/feature-fix-tracker.md`.

## Database impact

No migration added. No schema change. No production database was queried or modified. Session writes are reduced; report reads add the existing indexed/scoped `user_id` predicate.

## API compatibility

- Existing web cookie and mobile bearer app sessions are unchanged.
- Auth modes, cookie lifetime, session expiry/revocation, workspace switching, integration tokens and route shapes are unchanged.
- A browser API request that receives a genuine `401` now has one login redirect path. `500` responses are not treated as logout.
- Report response shape and visible design are unchanged; only personal data scope changes.

## Security/privacy impact

- Fixes a same-workspace personal-report data exposure.
- Unexpected authentication infrastructure failures are no longer downgraded to anonymous public content.
- Tests and documentation use synthetic identities and durations only. No cookies, token values, private addresses, location exports or HealthKit data are committed.

## Automated tests

- Untouched baseline: lint; all workspace typechecks; 37 web files/190 tests; 33 mobile files/237 tests; 5 shared files/94 tests; repository and web production builds; brand checks; `git diff --check`.
- Focused implementation check: 4 files/21 tests, web typecheck and web lint passed.
- Final full validation passed: repository lint; all workspace typechecks; 40 web files/208 tests; 33 mobile files/237 tests; 5 shared files/94 tests; repository and web production builds; brand checks; `git diff --check`; and the explicit web lint/typecheck/test/build sequence.

## Browser validation

- Baseline reproduction used an actual browser at 1440x900 and 390x844, plus local/dev/provider request checks and a throttled bootstrap reload.
- Final post-change validation used an actual browser with a disposable local PostGIS database and synthetic account. At 1440x900, hard/direct navigation across Dashboard, Timeline and Reports kept one authenticated shell in two concurrent tabs with no public landing content or horizontal overflow. At 390x844, Dashboard and Reports kept the authenticated shell with no horizontal overflow. Revoking the synthetic session produced one bootstrap `401` and a clean redirect to `/login`. Browser logs contained no warnings or errors.

## Not run

- Production Vercel deployment and logs.
- Production Supabase queries or migration actions.
- Real provider credential login against hosted Supabase.
- Mobile/TestFlight or physical-iPhone testing; no mobile code or contract changed.

## Remaining limitations

- A genuine `401` intentionally performs a full navigation to `/login`; Phase 0 does not redesign the login experience or add session-renewal UI.
- Provider identity/password verification still requires hosted Supabase smoke testing before merge; local provider-mode coverage validates the existing Dayframe app-session path only.

## Rollback

Revert this focused branch. No database rollback is required because no migration or data rewrite is included.

## PR

Draft PR from `codex/web-auth-report-safety` to `main`; link assigned after validation, commit and push.
