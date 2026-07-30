# Supabase egress and cross-device timer reconciliation

Date: 2026-07-30  
Status: Implementation in progress

## Observed cause

The web timer shell introduced a one-second `/api/bootstrap` refresh on 22 July. Bootstrap performs 19 data reads and includes bounded history of up to 2,000 entries, so an open browser repeatedly transferred far more data than the active timer required. The interval was changed to 30 seconds on 23 July, reducing the spike but leaving 2,880 heavyweight refreshes per always-open client each day.

The same 30-second reconciliation cadence also explains the noticeable delay when a timer is started, stopped, deleted, or edited on another device.

## Implemented design

- `GET /api/timer-state` resolves the normal Dayframe app session, then performs one workspace/user-scoped `time_entries` query limited to the active row.
- The response is `private, no-store` and contains only `activeEntryId`, `updatedAt`, and `serverNow`.
- Web checks while `document.visibilityState` is `visible`; mobile checks while `AppState` is `active`.
- The normal interval is three seconds. Failures back off to 6, 12, then 30 seconds and reset after success.
- Only one fingerprint request may be in flight per client.
- A changed active ID or `updatedAt` triggers the existing canonical bootstrap. The existing web mutation gate and mobile mutation revision/queued-refresh gate remain the only owners allowed to commit that state.
- A five-minute visible/foreground bootstrap remains for broader Health, Review, location, completed-entry, and other non-active-timer changes.
- The displayed elapsed timer continues ticking locally once per second with no network request.

## Why polling instead of Realtime

Dayframe mobile and web API clients use Dayframe app-session tokens rather than retaining Supabase Auth JWTs. Secure Realtime would add token issuance/refresh, authorization policies, reconnect behavior, publication/trigger configuration, and a larger release surface. The bounded detector is smaller, reversible, and predictable enough for the accepted three-to-four-second sync target.

## Acceptance and evidence

- Normal web-to-mobile and mobile-to-web timer start/stop/edit/delete appears within four seconds plus ordinary request latency.
- Hidden web tabs and background mobile clients emit no timer-state polling.
- A poll cannot overwrite a newer optimistic timer mutation.
- An unchanged fingerprint emits no bootstrap.
- One changed fingerprint emits one canonical reconciliation, subject to the existing queued-refresh coalescing.
- Expired bearer/cookie sessions follow existing structured `401` handling.
- Request tracing confirms the three-second path transfers only the fingerprint and the five-minute/heard-change path owns bootstrap.
- Supabase usage is measured after deployment; payload estimates are not treated as quota proof.

## Remaining release evidence

- Optimized Vercel Preview with provider authentication and request tracing.
- Two visible web clients plus web/mobile start, stop, edit, and delete.
- Hidden/background, slow request, failure backoff, expired session, offline/reconnect, and overlapping local mutation checks.
- Full workspace test, typecheck, lint, build, and diff checks.
- Physical-iPhone/TestFlight verification after merge because the mobile polling owner changed.
