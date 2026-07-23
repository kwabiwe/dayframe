# Web Settings polish

## Scope

Phase 6 of the Dayframe web-overhaul programme only. The branch starts from
`origin/main` at `a07e2d204bc6aecc12138f3d2a2901a4db0d74c6`, which is the merge commit for
PR #97. The work is limited to Settings, profile/workspace responsibility, and
shared-foundation consistency findings. It does not change the timer owner,
Dashboard, Reports, Places editing, the database schema, hosted rollout, or
mobile API contracts.

## Current-main reproduction

The original standalone PDF review board was not present in the supplied
attachment, repository, iCloud Downloads, or Codex attachments. The complete
programme's recorded complaints, earlier phase investigation notes, and a fresh
current-main browser reproduction are the evidence trail.

Still relevant on current main:

- Settings describes itself as "Privacy defaults and integration stubs for local
  development."
- Normal UI exposes auth mode values, seeded user/workspace references, ingest
  token implementation language, API paths, and a command-line backup command.
- Appearance is called Theme and uses three oversized cards rather than the
  shared segmented control.
- Daily and weekly goals use full-width decimal-hour fields for compact values.
- Profile, workspace creation/rename, and password editing are duplicated inside
  the profile popover instead of belonging to persistent Settings.
- Dev/provider contexts can see password controls that are not supported by the
  active authentication mode.
- At 390 x 844 the account trigger measures 30 x 30 px rather than the shared
  44 px target. The profile popover expands to a near-full-height editing form.

Already resolved or superseded after Phases 1-5:

- Shared focus, dialog, button, field, segmented-control, disclosure, and
  SettingsRow primitives exist.
- The shell has one timer owner and mobile-safe dialog foundation.
- Dashboard, Reports, and Places have their dedicated approved information
  architecture; they are not redesigned here.
- The document and Settings page had no horizontal document overflow at
  1440 x 900, 1280 x 720, 1024 x 768, or 390 x 844, although the phone navigation
  is intentionally horizontally scrollable.

## Baseline

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm run test`: pass, 639 tests in 92 files (mobile 237/33, web 308/54,
  shared 94/5).
- `npm run build`: pass.
- `npm run check:brand-assets`: pass.
- `git diff --check`: pass.

The default `/usr/local/bin/node` is an x86_64 binary and cannot execute in this
environment. Validation uses the Codex workspace's native Node 24 runtime; this
is tooling-only and does not change the repository.

## Product and information architecture

The planned hierarchy is:

- General: Appearance and Time goals.
- Places and location: Manage Places, per-place suggestion guidance, and factual
  read-only browser permission status.
- Account and workspace: profile editing, active workspace, workspace
  switching/rename/create, supported password security, and logout.
- Data and privacy: named exports and deletion of recent raw location evidence.
- Privacy and troubleshooting: collapsed by default with friendly, safe status
  and no IDs, endpoints, environment-variable names, tokens, SQL, or engine
  strings.

The profile popover owns quick identity/workspace context, quick switching,
Settings access, and logout. Settings owns persistent editing.

## Motion contract

- Trigger: open the existing delete-evidence confirmation, or expand/collapse
  privacy and troubleshooting.
- Owner: the shared native-dialog wrapper owns confirmation; native `details`
  owns disclosure state.
- Entrance/update/exit: no new custom spatial animation. The existing dialog
  presentation and disclosure chevron provide state feedback.
- Surrounding layout: disclosure content follows normal document reflow.
- Interruption: Escape/Cancel closes the dialog when not busy; repeated saves or
  deletes are disabled while the request is active.
- Async outcome: success and error messages are announced; recoverable failures
  keep entered form values; recent-evidence deletion requires explicit
  confirmation.
- Accessibility: the existing focus trap/restoration is retained. Reduce Motion
  removes the disclosure chevron transition. Labels, expanded state, status
  announcements, and 44 px targets remain available without motion.

## Database, API, mobile, and privacy impact

No migration is required. Existing `/api/profile`,
`/api/workspaces`, `/api/workspace/switch`, `/api/export`, and
`/api/location/evidence` contracts are reused. Web permission status is
read-only and does not prompt. The mobile bootstrap, bearer session, offline
queue, location rollout, and event-first behavior are unchanged.

The profile route now rejects blank supplied names, keeps goal values inside the
existing database constraints, and refuses local-password changes for non-local
sessions. Password fields render only for local auth. Client errors are reduced
to bounded user-safe copy instead of forwarding database, provider, route, token,
or stack details. Export links use human names, raw location deletion retains an
explicit confirmation, and the collapsed disclosure contains no IDs, endpoints,
environment variables, tokens, SQL, coordinates, confidence, or engine strings.

Zero/disabled goals remain unsupported because the existing user columns require
values from 1 through 1,440 daily minutes and 1 through 10,080 weekly minutes.
Phase 6 preserves that contract instead of adding an unauthorised migration.

## Implementation and files changed

- `apps/web/src/app/settings/page.tsx`, `loading.tsx`, and `error.tsx`: concise
  information architecture plus calm route-level pending and recovery states.
- `apps/web/src/components/SettingsForms.tsx`: Settings-owned profile,
  workspace, auth-mode-aware security, Places/location, export/evidence, and
  troubleshooting rows.
- `apps/web/src/components/ThemeSettings.tsx` and `GoalSettings.tsx`: shared
  Appearance segmented control and compact hour/minute goals with announced
  save/error states and shell refresh.
- `apps/web/src/lib/goal-duration.ts`: bounded minute conversion.
- `apps/web/src/components/AppShell.tsx`: quick identity/workspace switch,
  Settings, and logout only; no duplicated persistent edit forms.
- `apps/web/src/components/ui/Primitives.tsx` and
  `Primitives.contract.test.ts`: explicit disclosure state and accessibility
  contract.
- `apps/web/src/app/globals.css`: consolidated Settings owner styles, inset
  dividers, mobile wrapping, and a 44 px account target; the obsolete profile
  password owner was removed.
- `apps/web/src/app/api/profile/route.ts` and `route.test.ts`: bounded input and
  auth-mode password guards.
- `apps/web/src/components/SettingsForms.contract.test.ts`: Settings ownership,
  appearance, privacy, goal, loading/error, divider, and touch-target contracts.
- This investigation and `docs/feature-fix-tracker.md`.

## Automated validation

All required commands passed with the native workspace Node 24 runtime:

- `npm run lint`
- `npm run typecheck`
- `npm run test`: 653 tests in 94 files:
  - web: 322 tests in 56 files;
  - mobile: 237 tests in 33 files;
  - shared: 94 tests in 5 files.
- `npm run build`
- `npm run check:brand-assets`
- `git diff --check`
- `npm run lint -w @dayframe/web`
- `npm run typecheck -w @dayframe/web`
- `npm run test -w @dayframe/web`: 322 tests in 56 files
- `npm run build -w @dayframe/web`
- `npm run typecheck -w @dayframe/mobile`
- `npm run test -w @dayframe/mobile`: 237 tests in 33 files

No shared helper or type changed, so separate shared commands were not required;
the root typecheck and test still covered the shared package.

## Real-browser validation

The in-app Chromium browser exercised System, Light, and Dark across Login,
Dashboard, Timeline calendar/list/timesheet, Categories, Tags, Reports, Places,
new Place, Review, Settings, and profile/workspace UI at 1440 x 900,
1280 x 720, 1024 x 768, and 390 x 844: 144 exact
route/theme/viewport combinations. There was no document/body horizontal
overflow, technical Settings copy, runtime overlay, warning, or console error.

Additional evidence:

- Appearance selected state, refresh persistence, system dark/light media
  response, and all three rendered palettes passed.
- Goals saved 8 h 15 min daily and 40 h 30 min weekly; Dashboard reflected the
  changed daily target after navigation. Baseline 8 h/40 h values were restored.
- Invalid negative input, excessive/zero conversion coverage, 900 ms slow-save
  disabling, offline failure wording, retained values, and successful save
  announcements passed.
- Profile update and workspace rename submissions passed. Quick switching from
  Personal to Freelance Studio and back passed without exposing IDs. A new
  workspace was not created in the shared dev fixture because no delete workflow
  exists; creation is covered by the unchanged endpoint flow and contract tests.
- The read-only denied browser-location state was factual and did not trigger a
  permission prompt. Manage Places opened the existing route.
- Troubleshooting was collapsed by default, toggled by Enter with
  `aria-expanded`, and remained free of sensitive/technical values.
- The destructive evidence dialog was inspected and cancelled, not executed. At
  phone width it was a 366 px non-overflowing alert dialog, Escape/Cancel
  semantics remained shared, and focus returned to the trigger.
- The mobile account target measured 44 x 44 px. Its 366 x 466 px dialog
  contained quick workspace access, Settings, and logout without duplicated
  edit controls or clipping.
- Keyboard focus remained visibly 2 px, sections/fields were represented in the
  accessibility tree, status/error regions announced outcomes, long unsaved
  profile/workspace values did not overflow, Back/Forward passed, and a 720 px
  effective viewport passed the desktop 200% reflow check.
- Reduced Motion matched and reduced disclosure transition duration to 0.001 s.
- A disposable synthetic local-auth account verified password-control
  visibility, wrong-current-password retention and friendly error, successful
  password clearing, and central 401/session-expiry redirection to Login. Its
  session, workspace, and account were removed from the local database after the
  check.

## Final consistency findings

The constrained sweep found no remaining double/purple focus owner, clipped
dialog/popover, blurred-backdrop remnant, off-centre shared account icon,
sub-44 px Settings action, horizontal overflow, or stale implementation wording
requiring changes outside the Settings/AppShell owners. Dashboard, Reports,
Places, the timer architecture, and mobile code were not redesigned.

## Deferred issues and limitations

- Hosted provider login, expiry, and provider-managed account behavior require
  an authorised hosted Preview with Supabase credentials; no deployment was
  authorised. Provider password suppression and server rejection are covered by
  focused tests in this branch.
- The original standalone PDF review board was unavailable; the complete
  programme, existing investigation trail, and fresh current-main reproduction
  were used instead.
- A global visit-suggestion toggle and zero/disabled goals do not exist in the
  current API/schema. Settings points users to the existing per-place controls
  and preserves the current goal constraints rather than inventing new
  contracts.
- Physical touch hardware and screen-reader audio were not available; phone
  viewport interaction, keyboard, accessibility-tree, focus, and touch-target
  evidence were collected in Chromium.

## Rollback

Revert the Phase 6 commits. There is no schema, migration, deployment, or
production-data rollback.
