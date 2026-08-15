# Location calendar recovery: mobile session split

Date: 2026-08-14

## Report

Automatic commutes and visited places stopped appearing in Dayframe. The last
visible commute was on 5 August, despite a commute and a substantial data-centre
stay on 13 August.

## Evidence

The investigation started from the merged `origin/main` at `928657c` after
reviewing the Location Intelligence, finalisation replay, commute auto-log, and
mobile lifecycle documentation.

Read-only inspection of the installed production TestFlight build showed that
capture did not stop:

- the native signal queue continued draining;
- the local V2 engine continued accepting evidence and producing segments;
- 13 August contained 221 pending evidence records, including visit,
  significant-change, geofence, and standard-location signals;
- the local segments included a commute and stays covering the reported period;
- the last successful evidence upload and replay were on 6 August;
- two stale outbox batches were marked as requiring a new login;
- the current local journal still contained the 13 August evidence.

A controlled foreground launch reproduced the failure on build 94. Normal
bootstrap and timer requests succeeded with a valid session, but no evidence or
replay request reached the server. This separated capture and segmentation from
the failed authenticated upload path.

## Root cause and regression

React Native sends cookies from its shared cookie store by default. Dayframe's
ordinary mobile requests therefore remained authenticated by the HTTP-only web
session cookie even after the SecureStore bearer used by background location
sync had been rejected and cleared. The UI continued to look signed in, so the
user was never asked to authenticate again and obtain a replacement bearer.
Location evidence continued accumulating on-device without reaching server
replay or automatic entry creation.

The split session was introduced by [PR #86](https://github.com/kwabiwe/dayframe/pull/86),
`Location Intelligence V2: deterministic evidence and private review`, merged
on 21 July 2026. Its uploader required the SecureStore bearer and cleared that
bearer on `401/403`, while pre-existing mobile API calls could still fall back
to the React Native cookie. The defect became observable on 6 August when the
location bearer failed. Later PRs did not introduce it: the first failed batch
predated PR #160, and PRs #168, #174, and #175 landed later. PR #176 improved
Keychain and lifecycle reconciliation but did not remove the cookie/bearer
split, which is why the installed build 94 still reproduced the failure.

## Repair contract

- Route every mobile API request through one network boundary that forces
  `credentials: "omit"`.
- Keep the SecureStore bearer as the sole mobile API session carrier, including
  login, bootstrap, Review mutation, location upload, and replay requests.
- When any authenticated mobile request receives `401/403`, clear the rejected
  bearer and its matching native shortcut context, then publish the signed-out
  transition only if that bearer still owns the current session. A delayed
  response from a replaced login must not clear or sign out the replacement.
- Preserve queued evidence and retry it after the user signs in again. The
  privacy-driven seven-day raw-evidence retention remains unchanged.
- Add executable coverage for cookie omission, current-session sign-out,
  delayed-response/login replacement races, location timeouts, and the absence
  of direct runtime `fetch` calls outside the mobile network boundary.

## Recovery expectation

After a fixed mobile build is installed, the existing cookie can no longer mask
the absent bearer. Dayframe will require one normal login, then foreground
reconciliation can upload and replay retained evidence. The 13 August evidence
was still within the protected local journal at diagnosis and is recoverable.
Evidence older than the documented seven-day privacy window may already have
expired locally and is intentionally not reconstructed.
