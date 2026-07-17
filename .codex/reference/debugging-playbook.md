# Debugging Playbook

Use this before touching code for screenshots, bug reports, regressions, and confusing production behaviour.

## First Response

1. Restate the observed symptom in concrete terms.
2. Identify the affected surface: web, API, mobile, TestFlight, HealthKit, geofence, database, or deployment.
3. Check the running version before judging the bug:
   - mobile app version and build number
   - mobile `EXPO_PUBLIC_DAYFRAME_API_BASE`
   - latest merged commit on `main`
   - Vercel production deployment commit
   - relevant Supabase migration state
4. Read `AGENTS.md`, the relevant `.codex/reference/*` docs, and any active investigation note.
5. Inspect the relevant code path before forming a fix.

Do not start implementation until the real user/API/data flow has been traced.

## Evidence Ladder

Prefer evidence in this order:

1. User screenshot, screen recording, or exact UI text.
2. In-app diagnostics or debug export.
3. Vercel request logs and structured server logs.
4. Database rows for the affected workspace/user, with sensitive values minimized.
5. Local reproduction with fixtures or a seeded database.
6. Unit/integration tests that encode the failing path.

If evidence is missing, add safe diagnostics before guessing. Health and location payloads must stay local/debug-only and out of commits.

## Hypothesis Rules

For non-trivial issues, write down at least two plausible causes before changing code. For each hypothesis, record:

- what would prove it
- what would disprove it
- which log, DB query, test, or export checks it

Do not stop at the first plausible explanation if another layer could still be broken. Dayframe often has mobile, API, database, and deployment state involved at the same time.

## Common Dayframe Failure Classes

- Mobile build contains a fix but production API does not.
- Production API contains a fix but TestFlight build does not.
- Supabase schema is behind the deployed code.
- Review item is no longer open but still visible due to query or mobile filtering.
- Auto-log is blocked by overlap, stale open timer, disabled preference, threshold, invalid time, duplicate event, or DB lock contention.
- Manual confirm fails due to expected validation but returns an unstructured error.
- Sleep stages are treated as separate time entries instead of one sleep session.
- Local simulator passes but physical iPhone HealthKit data has a different shape.
- JavaScript contains a native-view fix but the installed iOS binary predates the Swift/module change, or CocoaPods/autolinking did not include the updated module.
- A hybrid Calendar bug appears visual but is actually a stale prop/event contract, a recreated hosting controller, or competing React Native and native scroll/gesture owners.

## Before A Fix Branch

1. Confirm the working tree and branch.
2. Pull latest `main`.
3. Create a focused branch named for the root cause or investigation.
4. Keep screenshots, exports, archives, and logs under local untracked QA folders.
5. Create or update an investigation note under `docs/investigations/` for the active issue.

## During Implementation

- Keep changes scoped to one root cause.
- Preserve the event-first model.
- Preserve the category/task-first UX.
- Add structured errors for expected failure modes.
- Add tests for the user-visible failed path, not just helper functions.
- Prefer diagnostics and explicit reason fields over silent fallback.

## Completion Gate

Before reporting a fix as done:

1. Show the exact commit, branch, PR, TestFlight build, and Vercel deployment status involved.
2. Run the relevant validation commands from `validation-matrix.md`.
3. Manually validate the same journey the user reported, where feasible.
   - For Calendar pinch/scroll reports, use a physical iPhone and capture repeated zoom-in, zoom-out, pan, entry-tap, and day-change evidence. Simulator screenshots alone cannot close a multi-touch performance issue.
4. Update the investigation note with root cause, fix, evidence, and residual risks.
5. Add one sentence to the relevant reference doc if the bug exposed a missing guardrail.
