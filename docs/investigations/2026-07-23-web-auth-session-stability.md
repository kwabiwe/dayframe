# Web Auth And Session Stability

Date: 2026-07-23

Branch: `fix/web-auth-session-stability`

Base: `76f49c79e30cba92aaafb5c1b84787c7cfce94cd` (`origin/main`, merged PR #98)

## Scope

This is the focused post-overhaul authentication stability fix requested after Phases 0–6. It is not Phase 7. The work is limited to web login/logout/session handling, safe authentication diagnostics, bootstrap reconciliation, focused tests, and the reusable guardrails exposed by the incident.

No production deployment, merge, database migration, mobile implementation, or unrelated redesign is part of this branch.

## Reported Symptoms

1. The hosted web app appeared to log a user out at random.
2. After valid login credentials, the form briefly returned to an empty editable state before a separate loading screen appeared and the Dashboard loaded.

## Exact Current-Main Reproduction

The reproduction used an optimized production build from the exact base commit, `DAYFRAME_AUTH_MODE=local`, Chromium, and synthetic accounts in a disposable local Postgres database.

### Logout without an explicit action

Current main rendered `/logout` as a Next.js `Link` in the Profile & workspace popover and Settings, while `GET /logout` revoked the matching `auth_sessions` row, cleared `dayframe_session`, and redirected.

The unsafe request was reproduced in the production build:

- opening Profile without choosing Log out caused an RSC/prefetch `GET /logout`;
- the matching session changed from active to revoked;
- the next authenticated bootstrap failed and the browser returned to Login;
- opening Settings did the same once its logout link entered the prefetch/render path;
- the cookie disappeared as part of the GET response.

This proves that the apparently random logout was a deterministic side effect of rendering/discovering a prefetchable state-changing link. No user click was required.

### Login transition

Current main passed an async function to `<form action={submit}>` with uncontrolled inputs. After the successful action, React reset those controls. The code called `window.location.assign("/")` and then immediately ran `finally { setIsSubmitting(false) }`, restoring an idle Login button before the document navigation completed.

That sequence reproduced the reported cleared-form flash and also left `/login` in navigation history.

### Bootstrap amplification

With an authenticated visible page, current main emitted 10 `/api/bootstrap` requests in a 10-second observation window. `PersistentTimerBar` already advanced elapsed time locally every second, so those authenticated server requests did not own the visible ticking.

## Root Causes

### Random logout

The root cause was the combination of:

1. session revocation on `GET /logout`;
2. user-facing Next.js links to that route;
3. production prefetch/RSC discovery;
4. a subsequent genuine session `401` redirect.

Disabling prefetch on individual links would not make the route safe. The state-changing GET itself had to be removed.

### Login flicker

The root cause was the form-action/uncontrolled-input reset plus restoring idle state before full-document navigation. It was not caused by the session TTL.

## Implemented Design

### Logout request

- One shared `SignOutControl` is used by Profile, the Settings account row, and Privacy and troubleshooting.
- It is an accessible native form/button with `POST /logout`.
- A ref gates duplicate submissions and the control changes to `Signing out…`.
- `POST /logout` idempotently revokes only the current session, expires `dayframe_session`, and returns `303 Location: /login?signedOut=1`.
- The relative `Location` deliberately preserves the current hostname and cookie scope.
- `GET /logout` returns `405 Allow: POST` and does not inspect, revoke, clear, or redirect a session.
- `/api/auth/logout` remains unchanged for existing API/mobile consumers.
- A source contract fails if a user-facing `href="/logout"` returns.

### Session reasons and client behavior

Local app sessions now resolve to one typed reason:

- `session_cookie_missing`
- `session_invalid`
- `session_expired`
- `session_revoked`
- `session_valid`

API auth failures may include the safe public code. Server diagnostics contain only the reason, pathname, method, deployment environment, cookie-present boolean, timestamp, and a random request-correlation ID. They do not contain tokens, hashes, cookies, email, user/workspace IDs, or Supabase credentials.

Only a structured session-related `401` triggers client login replacement, and repeated responses share one redirect gate. An unstructured credential `401`, a scope `403`, and a server/database `500` do not trigger logout. Missing required scope is now `403 insufficient_scope`; integration-token fallback uses a typed error rather than message matching.

Optional page sessions still turn only typed missing/invalid/expired/revoked conditions into anonymous state. Database and configuration errors continue to propagate.

### TTL

`DAYFRAME_SESSION_TTL_SECONDS` is now resolved once when the auth module loads.

- Absent value: `2,592,000` seconds (30 days).
- Minimum: 60 seconds.
- Maximum: `31,536,000` seconds (365 days).
- Blank, zero, negative, non-numeric, non-finite, fractional, or out-of-range values fail with an explicit configuration error.
- The same resolved value feeds the database expiry timestamp and cookie `maxAge`.

The current session remains an absolute, fixed-expiry session. The reproduction used the default 30-day lifetime; no reproduced row expired unexpectedly. Fixed expiry did not cause the reported logout, so sliding renewal was not introduced. If a later product requirement calls for sliding sessions, it needs a separate security/design decision covering renewal bounds, concurrent tabs, provider lifetime, revocation, and stolen-token exposure.

### Reconciliation

Authenticated bootstrap reconciliation now runs:

- on initial client mount;
- after mutations, with the existing forced refresh;
- on window focus;
- when the document becomes visible;
- every 30 seconds while visible.

The local timer display still ticks every second. Start and stop remain optimistic and mutation-gated, and a second tab catches up within the foreground interval without creating another active entry.

Measured production-build traffic:

- before: 10 bootstrap requests in 10 seconds;
- after: 1 initial request in a 10.5-second observation and then requests at 30-second boundaries, plus explicit focus/visibility/mutation refreshes.

### Login state machine

`AuthForm` now has explicit `idle`, `submitting`, `opening`, `error`, and `email-confirmation` states.

- The native form uses `onSubmit` with `preventDefault`, so Enter and click share one path.
- Email/password/name/workspace controls are controlled and disabled while busy.
- A ref rejects duplicate Enter/click attempts.
- Failed login restores the form with useful input retained.
- The password exists only in component memory and is never persisted or logged.
- Success cannot return to idle: it renders `Opening Dayframe…` and uses one `window.location.replace("/")`.
- The root Suspense fallback and successful transition use the same branded `AppLoadingState`.

## Motion Contract

- Trigger: a valid login submission or explicit sign-out submit.
- Owner: `AuthForm` owns login status; `SignOutControl` owns sign-out pending state; the browser owns the final document replacement.
- Entrance/update/exit: login swaps the form for the embedded branded loading state; root Suspense uses the same visual; sign-out changes button copy in place before the 303 navigation.
- Surrounding layout: the auth card dimensions remain bounded and no unrelated page content reflows.
- Interruption: duplicate submit is ignored; an auth/network error returns to the populated form; sign-out remains an idempotent POST.
- Async rollback: login errors restore editable controls and announce the error. A transient bootstrap failure preserves the current page/data and retries later.
- Reduce Motion: no new spatial animation or timed delay is introduced; state changes remain announced and visually legible.

## Files Changed

Runtime:

- `apps/web/src/app/logout/route.ts`
- `apps/web/src/app/api/auth/me/route.ts`
- `apps/web/src/app/api/events/route.ts`
- `apps/web/src/app/layout.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/components/AppLoadingState.tsx`
- `apps/web/src/components/AppShell.tsx`
- `apps/web/src/components/AppShellRuntime.tsx`
- `apps/web/src/components/AuthForm.tsx`
- `apps/web/src/components/SettingsForms.tsx`
- `apps/web/src/components/SignOutControl.tsx`
- `apps/web/src/lib/api-errors.ts`
- `apps/web/src/lib/auth/local.ts`
- `apps/web/src/lib/auth/server.ts`
- `apps/web/src/lib/client-auth-fetch.ts`
- `apps/web/src/lib/ingest-auth.ts`
- `apps/web/src/lib/session.ts`

Focused tests:

- `apps/web/src/app/api/auth/login/route.test.ts`
- `apps/web/src/app/logout/route.test.ts`
- `apps/web/src/components/AuthSessionStability.contract.test.ts`
- `apps/web/src/components/SettingsForms.contract.test.ts`
- `apps/web/src/lib/api-errors.test.ts`
- existing local-session, auth-server, client-auth-fetch, ingest-auth, and integration route tests

Documentation:

- this investigation
- `docs/feature-fix-tracker.md`
- `docs/dayframe-regression-checklist.md`
- `.codex/reference/validation-matrix.md`

## API And Mobile Impact

There is no route removal and no breaking mobile payload change.

- `/api/auth/logout` remains POST-compatible.
- Existing error `status` and `error` fields remain; session failures gain an additive safe `code`.
- Missing scope is corrected from `401` to `403`.
- App-session bearer tokens continue through the same resolver.
- Mobile typecheck and unit tests are included because the additive auth-response behavior sits on a shared web API boundary.

## Database Impact

No migration, schema, RLS, hosted data, or production database change is required.

The session query now reads the existing expiry/revocation columns so it can distinguish invalid, expired, and revoked rows. Revocation adds `revoked_at is null` and `returning id` to make repeated POSTs observably idempotent.

All reproduction accounts, sessions, timer entries, expiry fixtures, and database-outage work used unmistakably synthetic records in a disposable local database.

## Security And Privacy Review

- Logout is no longer CSRF-prone through a prefetchable safe-method route.
- No token, token hash, cookie, access token, email, user ID, workspace ID, location, or HealthKit data is logged.
- Public reason codes reveal only the minimum session state needed for correct browser behavior.
- Database/configuration failures are not downgraded to anonymous state.
- Scope failures no longer look like expired authentication.
- The relative post-logout redirect avoids changing hostname and losing host-scoped cookie context accidentally.
- Absolute fixed expiry is unchanged; no speculative sliding lifetime expands token exposure.

## Automated Validation

Focused auth/session suite:

- 11 test files, 65 tests: PASS.

Web suite:

- `npm run lint -w @dayframe/web`: PASS.
- `npm run typecheck -w @dayframe/web`: PASS.
- `npm run test -w @dayframe/web`: 60 files, 354 tests: PASS.
- `npm run build -w @dayframe/web`: PASS.

Complete required-command pass:

- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm run test`: 98 files, 685 tests: PASS.
  - mobile: 33 files, 237 tests;
  - web: 60 files, 354 tests;
  - shared: 5 files, 94 tests.
- `npm run build`: PASS.
- `npm run check:brand-assets`: PASS.
- `git diff --check`: PASS.
- `npm run typecheck -w @dayframe/mobile`: PASS.
- `npm run test -w @dayframe/mobile`: 33 files, 237 tests: PASS.

## Local Production-Browser Validation

Environment: optimized Next.js build, Chromium, synthetic local account, disposable Postgres, `1440x900` and `390x844`.

PASS:

- current-main Profile and Settings prefetch logout reproduction;
- wrong password retains email and password, then correct password succeeds;
- click submission, slow-network pending state, one successful navigation, and Back/Forward;
- direct `/login` while authenticated and hard refresh;
- one continuous branded login/loading transition with frame evidence;
- Profile open, Settings open, and troubleshooting expansion issue no `/logout` request after the fix;
- explicit sign-out revokes once, clears the cookie, preserves the host, and reaches `/login?signedOut=1`;
- `GET /logout` returns 405 with no `Set-Cookie` and no change in revoked-row count;
- two tabs remain authenticated until actual sign-out, then the other tab redirects on reconciliation;
- an explicit expired-row fixture produces `session_expired` and one login redirect;
- a real temporary disposable-database outage leaves the app visible, produces a server error rather than a login redirect, and recovers after database restoration;
- timer start/stop is optimistic, elapsed time advances from `00:43` to `00:44` locally, one scoped active entry is created, and no active entry remains after stop;
- cross-tab timer state reconciles on the 30-second interval without a duplicate active entry;
- phone-width Profile/Settings/troubleshooting remain 390px wide with reachable logout buttons and no horizontal overflow;
- no browser console errors.

Browser limitations:

- The available browser engine was Chromium; WebKit/Safari was not exposed by the environment.
- Browser automation key injection did not dispatch Enter to the native form, although the production form has one standards-based `onSubmit` path and the source contract covers Enter/click convergence. Physical Enter remains a required Preview check.

## Hosted And Hostname Validation

The public production alias `https://dayframe-web.vercel.app` currently serves the app directly with `200`, private/no-store responses, and no redirect to another hostname for `/` or `/login`. The mobile production API default also uses this alias.

No repository or HTTP evidence identified a second custom production hostname. Unique Vercel deployment URLs may also exist, but they are deployment/preview addresses and cookies remain host-scoped. Provider login must be exercised on one canonical Preview hostname without switching to another alias mid-session.

Draft PR [#99](https://github.com/kwabiwe/dayframe/pull/99) created Vercel Preview `https://dayframe-f39s9xdr3-dayframeworkshop.vercel.app` for commit `8f0a3a0`. GitHub reports the Vercel check as successful.

The Preview is protected by Vercel SSO: both `/login` and `/logout` return `302` to `vercel.com/sso-api` before a request reaches Dayframe. The in-app browser had no Vercel session, and the available Chrome control connection could not be established. Provider credentials and Vercel application-log access are not stored in the repository.

Vercel Preview/provider-auth validation: **NOT RUN**. The successful deployment is build evidence, not provider-auth journey evidence. The matrix below remains mandatory before merge.

## Remaining Limitations And Required Checks Before Merge

On the Vercel Preview with provider authentication:

1. Press physical Enter to log in and confirm one continuous transition.
2. Repeat login by clicking the button, including wrong then correct password under slow throttling.
3. Open Profile repeatedly; visit Settings repeatedly; expand troubleshooting repeatedly.
4. Preserve Network logs and confirm there is no discovered/prefetched `GET /logout`, unexpected structured `401`, or one-second bootstrap storm.
5. Keep the tab visible for at least 10 minutes, switch away/back, and confirm 30-second/focus reconciliation without logout.
6. Start/stop a timer, navigate normally, hard-refresh, and use Back/Forward.
7. Explicitly log out once, log back in, and repeat with two tabs.
8. Inspect Vercel logs for the safe reason fields and absence of tokens/identity/database detail.
9. Exercise an expired/revoked disposable provider app session if the Preview environment permits it.
10. Verify Preview and production aliases do not redirect an authenticated browser between hostnames.
11. Repeat in Safari/WebKit at `1440x900` and `390x844`.

Do not merge until these hosted/provider checks are recorded.

## Rollback

Revert the branch commit. No schema, migration, provider setting, domain setting, production data, or mobile release needs reversal. Rolling back would restore the unsafe GET logout and one-second polling, so it should only be used while replacing the change with an equivalent POST-only/session-safe implementation.
