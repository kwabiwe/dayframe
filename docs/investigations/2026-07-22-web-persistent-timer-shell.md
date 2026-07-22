# Web Persistent Timer, Shell And Navigation

## Scope

Phase 2 of the Dayframe web-overhaul programme only. The change gives Dashboard and Timeline one persistent timer owner, simplifies the shell/navigation, moves date and view controls into local context, and narrows the normal Timeline List. Reports, Places and Settings content redesigns belong to later phases and are not included.

Base: `origin/main` at `51c16348b50a8daea00fbfb2bde2717e96a58d50`, the merge commit for PR #93.

Branch: `codex/web-persistent-timer-shell`.

## Current-main reproduction

Before editing, the exact Phase 1 merge was run against a disposable seeded PostGIS database in the actual in-app browser.

- Dashboard mounted `CurrentTimerPanel` while Timeline mounted a second timer implementation. Each owned its own bootstrap polling, draft state, mutation path and keyboard assumptions, so route navigation unmounted one owner and constructed another.
- The desktop top bar duplicated workspace, theme, notifications, Reports and Help controls already available elsewhere.
- Entries retained a separate manual-entry form plus Source, Confidence and Review diagnostics in the normal list.
- Date/zoom controls were mixed into global or page chrome rather than sitting directly beneath the timer or within Timeline View options.
- Entries and Automation remained primary sidebar destinations even though Timeline List and Places are the approved user destinations.

## Implementation plan

1. Mount one timer runtime at `AppShell`, with the existing bootstrap/API path, optimistic projections and mutation serialization.
2. Make Dashboard and Timeline consume that runtime and delete both independent page timer owners and the old shortcut helper.
3. Replace redundant desktop chrome with the persistent timer/date shell, consolidate navigation/account/workspace/appearance access, and preserve compatibility redirects.
4. Reuse Phase 1 controls for start-time and manual-entry dialogs; narrow Timeline List and localize View/Zoom controls.
5. Add ownership/redirect/optimistic contract tests and complete the required browser matrix, including request counting and failure rollback.

## Architecture and decisions

- `AppShellRuntimeProvider` is the sole web timer owner. It reuses `/api/bootstrap`, `/api/time-entries` and the existing authenticated client fetch; it does not introduce another API client, server store or mutation queue.
- A single mutation gate serializes start, stop, detail, start-time and manual-entry requests. Optimistic helpers project the active entry through all bootstrap entry collections, then reconcile from bootstrap or restore the exact snapshot on failure.
- `PersistentTimerBar` is mounted once by `AppShell` on Dashboard and Timeline. The pages render their content from the runtime and do not poll or mutate timer state independently.
- `Shift+Space`, Plus/manual entry and timer controls all call the runtime owner. The former standalone timer shortcut path was deleted.
- Profile and workspace content is combined in one Phase 1 `PopoverPanel`; workspace switch/create, account details, password controls, Appearance/Settings and logout remain reachable at desktop and phone widths.
- Timeline view mode is URL-backed. Zoom lives under local View options. Entries and Automation are absent from primary navigation but retain server redirects.
- Timeline List contains Time, Task/tags, Category, Duration and Actions. Place remains secondary task metadata; Source, Confidence and Review are absent from the normal list.
- A late competing CSS layer was not added. Affected shell/timer/navigation rules were consolidated into the existing Phase 1 section and superseded top-bar rules were removed.

## Motion contract

- Trigger: Dashboard/Timeline navigation, timer start/stop/edit, Plus/manual entry, start-time editor, profile/search/help actions and Timeline view changes.
- Single owner: `AppShellRuntimeProvider` owns timer state and mutations; Phase 1 `ModalDialog`/`PopoverPanel` owns each presentation surface; URL state owns Timeline view selection.
- Entrance: route content changes beneath the still-mounted timer shell; dialogs enter through the shared native-dialog primitive with managed focus.
- Update: optimistic timer projections update the one shell instance and all relevant entry collections without page-level remounts or layout-moving progress UI.
- Exit: stop clears the active projection after the one mutation succeeds; Cancel/Escape closes shared dialogs and restores focus.
- Surrounding layout: the sticky timer remains above route content, date navigation is immediately below it, and compact/mobile layouts reflow without horizontal overflow.
- Interruption and rapid repeat: the mutation gate ignores overlapping actions; stable runtime identity prevents route changes from duplicating a start/stop request.
- Failure and rollback: the prior bootstrap snapshot and draft are restored and an inline actionable error remains in the timer.
- Reduce Motion: existing shared motion media rules collapse transition duration; no navigation animation or second timer handoff is introduced.

## Data, API, security and privacy

No database migration, new API route, second API client, authentication/session change, analytics payload, location/Health payload, automation table deletion or event-pipeline change. Existing workspace/user scoping and event-first compatibility remain unchanged.

## Validation

All required automated checks passed on 2026-07-22 with the bundled arm64 Node runtime:

- focused web lint, typecheck, test (43 files, 220 tests) and production build
- full workspace lint, typecheck, test (81 files, 551 tests) and production build
- brand-asset contract and `git diff --check`

Actual in-app browser validation used a disposable seeded database and passed:

- Dashboard to Timeline and Timeline to Dashboard retained one timer, the same description and the same active state. Start-time changes persisted in both directions.
- CDP network capture measured exactly one `mode=start` POST and one `mode=stop` POST for their respective controls. `Shift+Space` also emitted one start or stop through the same owner.
- Plus opened a four-field manual dialog: Category, Description/tags, Start and Finish. One submission emitted one manual POST and produced exactly one Timeline row.
- With the web server intentionally stopped after an active bootstrap, Stop optimistically changed state, the failed request restored the active timer and surfaced the error, and a server restart plus refresh reconciled the still-active database state.
- `/entries` resolved to `/timeline?view=list`; `/automation` resolved to `/places`.
- Active category and tag edits persisted across both routes. The category menu and tag picker stayed inside the 390-pixel viewport; cancelling a changed start-time draft restored the persisted start time.
- Dashboard and Timeline Calendar/List were scrolled with the timer still sticky and singular. Calendar Zoom and Day/Week controls appeared only inside local View options.
- Profile/workspace, workspace switch/create, Appearance/Settings and logout remained reachable on desktop and mobile web. Switching Personal to Freelance Studio and back updated the active workspace correctly. Sidebar search, `Ctrl+K`, `N`, Escape and `Shift+Space` were keyboard exercised.
- System, Light and Dark passed. Reduced Motion media emulation matched and shared transition duration collapsed to 0.001 seconds.
- Dashboard and Timeline List measured zero horizontal overflow and exactly one persistent timer at 1440x900, 1280x720, 1024x768 and 390x844. The removed desktop top bar had zero instances.
- Fresh browser tabs navigated Dashboard to Timeline and back, exercised the final edge cases and reported no console errors; only development informational logs were present. The sticky shell had no backdrop blur.

## Release and rollback

No merge, deployment, hosted migration or Phase 3 work is authorised. Rollback is the draft PR revert; the change has no durable schema or rollout-flag effect. The disposable local QA database is removed after validation.

## PR

Draft PR from `codex/web-persistent-timer-shell`; review only. Do not merge or deploy as part of this phase.
