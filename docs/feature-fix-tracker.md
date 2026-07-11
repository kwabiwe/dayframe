# Dayframe Feature And Fix Tracker

Last verified: 2026-07-11 07:17 BST

## Verification Snapshot

- Local repo: `main` synced with `origin/main` at PR #40 merge commit `1dc16a4`.
- GitHub: PR #40 is merged; no open PRs and no GitHub issues at release verification time.
- Latest verified TestFlight build: `0.1.0 (15)`.
- Evidence checked: recent memory, previous chat/session logs, local git log, GitHub PR/issues state, project docs, README, and App Store Connect build state.

## Status Key

- `Done`: merged to `main`; TestFlight/build evidence is listed separately when applicable.
- `Watch`: merged, but keep watching real production/TestFlight behaviour because the bug depended on real data or device state.
- `Release pending`: merged to `main`, but not yet verified in a new TestFlight build.
- `In progress`: implemented on an active branch, with review or merge still pending.
- `Next`: intended for the next implementation PR.
- `Planned`: accepted backlog item, no active branch yet.
- `Future`: larger track, useful but not immediate.

## Current Next Work

| Item | Status | Evidence | Next action |
| --- | --- | --- | --- |
| More reliable offline and mobile sync | In progress | PR #41; README and regression checklist already describe the mobile offline queue for Shortcut, NFC, geofence, Apple Health, and background event paths. | Harden failed queue recovery: visible failed/synced states, manual retry, safe backoff, conflict/idempotency checks, queue diagnostics/export, recovery from partial API failures, and web/mobile active-timer reconciliation after reconnect. |

## Recently Shipped Or Addressed

| Item | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Auto-log defaults during onboarding and non-Health imports | Done | PR #40, build `0.1.0 (15)`, delivery UUID `e6bcc257-2214-49c9-8614-5a201958a175`. | Adds Settings-managed defaults for mobile starts, Shortcuts, NFC, widgets, and Home Assistant buttons. Defaults only fill blank category/description values; explicit event values still win. |
| Duplicate/overlapping Sleep investigation | Watch | `docs/investigations/2026-07-11-duplicate-sleep.md`; KB reports no current duplicates in TestFlight build `0.1.0 (14)`. | Existing idempotency, Health segment dedupe, covering-entry checks, overlap blocks, and legacy consolidation already guard the known paths. Do not add merge/delete logic without a real duplicate export or row sample. |
| Midnight Core reskin and supplied branding | Done | PR #39, build `0.1.0 (14)`, delivery UUID `e6425673-8e83-4d62-ae31-cc01e7fc6001`. | Shared web/iOS Midnight Core tokens, refreshed app icon, wordmarks, reusable brand components, and automated brand/theme guardrails shipped without changing core tracking logic. |
| Calendar edit card keyboard avoidance regression | Watch | PR #37, build `0.1.0 (13)`, delivery UUID `8b5d4ac4-d0ca-4239-9719-4442aee56ec6`. | Edit sheet now uses screen-coordinate keyboard measurements, explicit keyboard-open sheet height, scrollable form body, and regression tests for small-iPhone keyboard-open layout. Watch KB's real-device keyboard/suggestion-bar check before marking fully settled. |
| Cross-midnight continuation border polish | Done | PR #36, build `0.1.0 (12)`. | Continuation segments that started before midnight now drop the top border/top radii; segments continuing into the next day still drop the bottom border/bottom radii. |
| Apple Health auto-log category and description customization | Watch | PR #36, build `0.1.0 (12)`. | Settings can map HealthKit sleep/workout types to category and description defaults; new imports and Health Review reprocess both use the mappings. Watch real device import/reprocess behaviour before marking fully settled. |
| Calendar event tap crash | Done | PR #35, build `0.1.0 (11)`. | Root cause was unstable React hook order in `ActiveTimerEditSheet`. |
| HealthKit automatic sleep/workout sync | Watch | PR #35, build `0.1.0 (11)`. | Foreground sync and HealthKit observer callbacks are wired; keep watching real device/background behaviour. |
| Anchored pinch zoom | Done | PR #35, build `0.1.0 (11)`. | Zoom now shifts scroll position around the finger midpoint. |
| Fixed 24-hour calendar mode | Done | PR #35, build `0.1.0 (11)`. | Awake/24h chips and labels are gone; Calendar is fixed 24-hour. |
| Current-time red-line label removal | Done | PR #35, build `0.1.0 (11)`. | Red line no longer prints the current time over left-side timestamps. |
| Calendar swipe reliability and midnight labels | Done | PR #34, build `0.1.0 (10)`. | Looser diagonal day swipes, top day-strip week swipes, and 00:00 boundary labels. |
| Previous-day sleep continuation marker removal | Done | PR #34, build `0.1.0 (10)`. | Previous-day sleep continuation copy/styling was removed; next-day continuation styling still needs the top-border polish above. |
| Calendar 24h option, cross-midnight clipping, and reports polish | Done | PR #33, build `0.1.0 (9)`. | Added 24h calendar support, continuation visuals, pie/bar Reports toggle, and edit-sheet polish. |
| Edit-sheet keyboard, safe-area, and swipe-down polish | Watch | PR #33, build `0.1.0 (9)`. | Generic edit-sheet polish shipped, but the Calendar edit card now has a keyboard-covering regression tracked in Current Next Work. |
| Sleep category routing for new/reprocessed HealthKit sleep | Done | PR #32 and PR #33. | Sleep now uses/creates a user-facing `Sleep` category; workouts remain under `Health`. |
| Legacy Health-category Sleep repair | Done | PR #33. | Narrow cleanup path for old confirmed HealthKit sleep rows that were still under `Health`. |
| Mobile calendar gestures, pinch density, and delete entry action | Done | PR #32. | Added day swipe, pinch zoom, and completed-entry delete affordance. |
| Rule assistant draft/simulate slice | Done | PR #30. | Plain-language automation requests can draft evidence checks, simulation checks, outcomes, and unsupported gaps. |
| Incomplete review durations showing huge live-to-now values | Done | PR #30. | Incomplete suggestions no longer accrue absurd durations such as hundreds of hours. |
| Health Review backlog drain | Watch | PRs #25, #26, #27, and #29. | Bounded reprocess batches, prioritisation, covered-row handling, and legacy cleanup migration are merged; watch live backlog behaviour. |
| Stale reviewed cards / already-resolved popups | Watch | PRs #22, #26, and #30. | Confirm/Dismiss became idempotent or structured; mobile removes resolved cards optimistically. |
| Sleep stages fragmented into REM/Core/Deep cards | Watch | PRs #23, #26, and #29. | Current imports group sessions; legacy sleep-stage backlog cleanup is merged. |
| Health items left in Review without useful explanation | Watch | PRs #22, #25, #26, #27, and #29. | Diagnostics and left-in-review reasons exist; continue checking that reasons are clear on device. |
| Geo/place default description mismatch | Done | PR #19 and PR #26. | Place names should remain reference/context; configured activity descriptions are used for geofence display and Confirm. |
| TestFlight release preflight and compliance checks | Done | PR #31 plus build release runs through `0.1.0 (14)`. | Keep verifying processing state, encryption compliance, notes, and internal testing assignment before asking KB to test. Docs-only PRs do not need a TestFlight build unless they change release/build configuration. |

## Future Tracks

| Item | Status | Evidence | Notes |
| --- | --- | --- | --- |
| NFC support through iOS Shortcuts | Future | README already describes NFC/Shortcut-style event ingestion and notes full native NFC scanning as a known limitation. | Build the practical first path around iOS Shortcuts/NFC tags: tag scan triggers a Shortcut/deep link, Dayframe queues an event-first start/stop/review action, offline queue and idempotency still work, and users get template Shortcuts for common actions. Native NFC scanning can be considered later if Shortcuts is not enough. |
| Live Activities with a timer | Future | Mobile already has an active timer and shared web/mobile timer sync; no ActivityKit extension exists yet. | Add an iOS Live Activity/Dynamic Island timer for the active Dayframe entry, showing task/category and elapsed time, keeping state accurate across start/stop/edit/sync, and handling stale/offline states without misleading the user. |
| Dayframe integration with Cockpit | Future | Prior Dayframe/Cockpit planning expects Cockpit to read Dayframe when it is ready instead of Toggl. | Start with a small token-protected read-only Cockpit API/stream for current timer, today timeline, source/confidence, and next suggested action; avoid write/mutation controls until explicitly approved. |
| Natural-language rules that create time entries | Planned | PR #30 proves draft/simulate only; earlier guardrails require deterministic, auditable writes. | Expand the Rule assistant into saveable rules that can propose or create time entries only after a preview/simulation step, with user approval, evidence shown, disable/edit/audit controls, and no direct LLM-to-database write path. |
| Dayframe Preview / pre-prod lane | Future | Repeatedly noted as useful after the current fast TestFlight lane stabilises. | Create a separate preview/staging path with its own app identity or bundle, staging Vercel/Supabase environment, staging secrets, TestFlight group/build lane, and release checklist so KB can test risky changes before production/main TestFlight. |
| Durable repo tracker | Done | This document. | Update this file whenever a planned item moves, ships, is skipped, or needs live-watch status. |
| Full automation rule creation/editing | Future | PR #30 proves draft/simulate only. | Needs UI for saving, simulating, explaining, editing, disabling, and auditing rules. |
| Account deletion, workspace deletion, and stronger privacy controls | Future | README privacy model calls export/deletion next-phase work and raw event payloads are stored in `activity_events.raw_payload`. | Add user-facing export/delete flows for accounts and workspaces, hard-delete or anonymise scoped data, clear raw Health/location payloads and integration tokens, respect retention windows, and document what remains in backups/logs. |
| Geofence and place automation expansion | Future | Earlier Dayframe planning covered HA/iOS geofence triggers for Gym, Home, School, Church, Office/client sites, family places, town/Chelmsford centre, and unknown stays. README and production-readiness docs already have event-first geofence foundations. | Expand location automation carefully: improve place setup/correction, use review-first defaults for ambiguous/broad/Home locations, support specific enter/exit rules, avoid automatic writes without confidence, and keep source evidence visible for every suggestion or created entry. |
| Intelligent commute tracking and regular-place learning | Future | KB requested opt-in commuting intelligence and regular-place recording on 2026-07-11. | Add a separately toggleable continuous-location mode that can learn frequently visited places even when they are not saved, detect movement between saved or learned places, and propose commute/transition entries with battery, privacy, retention, pause/delete, and review-first controls. |
| Home Assistant/local bridge inputs | Future | Production-readiness docs describe scoped ingest tokens and a future Home Assistant bridge payload; prior planning included HA buttons/zones as local signals. | Add token-management UI first, then a small local bridge path for HA button/geofence events into `/api/events`, with scoped/revocable tokens, idempotent payloads, and no uncontrolled direct time-entry writes. |
| Telegram/voice diary and correction intake | Future | Original life-tracking planning included Telegram/direct-chat corrections and end-of-day diary summaries that Major can turn into time entries. | Design a review-first correction/import lane where chat or voice notes become proposed edits or missing entries, show the evidence text, require confirmation before writing, and preserve an audit trail of what changed. |
| Review split/merge and saved-place correction flows | Future | README known limitations still call out review split/merge and saved-place correction flows as not fully implemented. | Let users split, merge, trim, and correct suggested stays/time blocks from Review without losing raw event provenance; saved place corrections should improve future matching but not rewrite history silently. |
| Reporting, export, backup, and restore confidence | Future | README and production-readiness docs expose workspace/time-entry/activity/review exports, but restore and larger-data reporting confidence are still future work. | Make Dayframe dependable as a system of record: richer filters, larger-data performance checks, CSV/JSON exports KB can trust, backup verification, restore/import tooling, and clear recovery docs. |

## Maintenance Rules

- Update status immediately after a PR merge, TestFlight build, or KB validation report.
- Keep `Watch` for fixes that are merged but depend on real HealthKit, geofence, or production data behaviour.
- Add PR/build evidence when moving an item to `Done`.
- Do not treat a chat plan as done unless GitHub/local code or TestFlight state verifies it.
