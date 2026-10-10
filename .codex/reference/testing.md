# Testing And Validation Guidelines

Use this when planning or validating implementation work.

## Validation Pyramid

1. Syntax, formatting, linting, and type checks.
2. Unit tests for isolated logic.
3. Integration tests for database/API/component boundaries.
4. End-to-end tests for critical user journeys.
5. Manual human review and exploratory testing.

## Regression Habit

When a bug is found:

- Write or update a failing test that reproduces it.
- Fix the implementation.
- Re-run the failing test and the relevant regression suite.
- Update global rules, on-demand context, or commands if missing context caused the bug.

## Core Timer Regression Checks

For timer, auth, sync, schema, or category/task model changes, validate:

- hosted login/signup
- web start timer
- web stop timer
- mobile start timer
- mobile stop timer
- active timer state in `/api/bootstrap`
- completed time entry persistence
- optional category assignment while running
- manual completed entry creation
- mobile session persistence
- mobile direct API start/stop
- mobile offline queue sync
- duplicate `clientEventId` dedupe
- Start while running leaves exactly one active timer; a delayed exact Stop for A cannot stop replacement B
- unchanged web Stop emits only the exact-entry event; dirty Stop emits one metadata PATCH without `stoppedAt` followed by that exact event
- delayed/failed Live Activity delivery cannot delay or change a committed Start, Stop, Switch, Edit, or Delete response
- browser mutation ownership releases before bootstrap/push reconciliation and the newest queued Stop-to-Start intent wins
- finite iOS timer execution ends exactly once on success, failure, expiry, cancellation, logout, account replacement, and teardown while retryable work remains durable
- online pending/backoff presentation is static and only active transmission rotates
- no project required for approved category/task-first flows

## Hosted Migration Checks

Before deployment or hosted smoke-test signoff, verify the hosted Supabase schema has every column and index used by deployed code. Timer/event changes must explicitly check event idempotency columns and active timer indexes.

## Repository Text Checks

Run `npm run check:docs` and a repository search before signoff:

- Local Markdown links, documented root npm scripts, migration references, canonical environment keys, and stale snapshot phrases remain aligned.
- No legacy third-party timer-brand product copy, scripts, env vars, imports, tests, or seeds.
- No non-iOS mobile support copy or config unless it is explicitly reintroduced.
- No production/native mobile localhost fallback.

## Mobile Overlay Regression Checks

For any app chrome, navigation, account, workspace, settings, or floating-surface change, test at 390x844 and 430x932:

- Workspace switcher opens fully on-screen.
- Profile/account menu is reachable.
- Logout is reachable.
- Keyboard shortcuts opens fully on-screen (desktop; the phone top bar has Search and the avatar only).
- The ⌘K palette (Search and commands) opens fully on-screen above the tab bar, with a 44px close button.
- Notifications panel opens fully on-screen.
- No horizontal overflow.
- No zooming or landscape rotation required.
- Close/cancel actions are visible and tappable.

## PR helper scripts

- `tools/prcheck.sh` runs typecheck, lint (which includes the documentation and iOS config checks), tests and `git diff --check` against the merge base with `origin/main`; add `--build` for the web production build. It does not replace feature-specific validators, browser checks or device tests.
- `tools/codex-review.sh <prompt-file> [scratch-dir]` exports the exact committed `HEAD` with `git archive`, links the installed `node_modules`, and runs a Codex review told not to change code. Codex's `workspace-write` sandbox can write the export and the system temp directories (where the default scratch and report live), not the real checkout; the `node_modules` links resolve into the checkout, so tests that write caches there may fail inside the sandbox. Uncommitted changes are not reviewed. Set `CODEX_BIN` to override the Codex CLI path.

## Review Checklist

- [ ] Validation commands are listed in the feature plan before implementation.
- [ ] Commands are non-interactive and executable.
- [ ] The agent reports exact commands and outcomes.
- [ ] Browser/UI changes include screenshots or manual testing notes.
- [ ] App-shell and floating-surface changes include mobile overlay checks.
- [ ] Core timer changes include start/stop/manual-entry regression checks.
- [ ] Hosted migration-dependent changes include hosted schema verification notes.
- [ ] Canonical docs and delivery state were updated, or the PR explains why documentation is unaffected.
