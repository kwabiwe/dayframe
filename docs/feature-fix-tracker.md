# Dayframe Feature And Fix Tracker

Last verified: 2026-07-10 10:20 BST

## Verification Snapshot

- Local repo: feature branch `agent/dayframe-health-autolog-customization`, based on `main` at `eb20cb3`.
- GitHub: no open PRs and no GitHub issues at the start of this slice.
- Latest verified TestFlight build: `0.1.0 (11)`.
- Evidence checked: recent memory, previous chat/session logs, local git log, GitHub PR history, and project docs.

## Status Key

- `Done`: merged to `main`; TestFlight/build evidence is listed separately when applicable.
- `Watch`: merged, but keep watching real production/TestFlight behaviour because the bug depended on real data or device state.
- `Next`: intended for the next implementation PR.
- `Planned`: accepted backlog item, no active branch yet.
- `Future`: larger track, useful but not immediate.

## Current Next Work

| Item | Status | Evidence | Next action |
| --- | --- | --- | --- |
| Auto-log defaults during onboarding and non-Health imports | Planned | PR #36 adds the compact Apple Health settings surface; onboarding and non-Health import defaults are not yet designed. | Design the next small surface for onboarding defaults and place/other import mappings if still needed after Apple Health validation. |
| Duplicate/overlapping Sleep investigation | Planned | PR #33 deliberately avoided automatic duplicate sleep merge/delete. | Inspect production row metadata before any merge/delete logic. |

## Recently Shipped Or Addressed

| Item | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Cross-midnight continuation border polish | Done | PR #36. | Continuation segments that started before midnight now drop the top border/top radii; segments continuing into the next day still drop the bottom border/bottom radii. |
| Apple Health auto-log category and description customization | Watch | PR #36. | Settings can map HealthKit sleep/workout types to category and description defaults; new imports and Health Review reprocess both use the mappings. Watch real device import/reprocess behaviour before marking fully settled. |
| Calendar event tap crash | Done | PR #35, build `0.1.0 (11)`. | Root cause was unstable React hook order in `ActiveTimerEditSheet`. |
| HealthKit automatic sleep/workout sync | Watch | PR #35, build `0.1.0 (11)`. | Foreground sync and HealthKit observer callbacks are wired; keep watching real device/background behaviour. |
| Anchored pinch zoom | Done | PR #35, build `0.1.0 (11)`. | Zoom now shifts scroll position around the finger midpoint. |
| Fixed 24-hour calendar mode | Done | PR #35, build `0.1.0 (11)`. | Awake/24h chips and labels are gone; Calendar is fixed 24-hour. |
| Current-time red-line label removal | Done | PR #35, build `0.1.0 (11)`. | Red line no longer prints the current time over left-side timestamps. |
| Calendar swipe reliability and midnight labels | Done | PR #34, build `0.1.0 (10)`. | Looser diagonal day swipes, top day-strip week swipes, and 00:00 boundary labels. |
| Previous-day sleep continuation marker removal | Done | PR #34, build `0.1.0 (10)`. | Previous-day sleep continuation copy/styling was removed; next-day continuation styling still needs the top-border polish above. |
| Calendar 24h option, cross-midnight clipping, and reports polish | Done | PR #33, build `0.1.0 (9)`. | Added 24h calendar support, continuation visuals, pie/bar Reports toggle, and edit-sheet polish. |
| Edit-sheet keyboard, safe-area, and swipe-down polish | Done | PR #33, build `0.1.0 (9)`. | Addressed Dynamic Island spacing, keyboard movement, focused description visibility, and swipe-down dismissal. |
| Sleep category routing for new/reprocessed HealthKit sleep | Done | PR #32 and PR #33. | Sleep now uses/creates a user-facing `Sleep` category; workouts remain under `Health`. |
| Legacy Health-category Sleep repair | Done | PR #33. | Narrow cleanup path for old confirmed HealthKit sleep rows that were still under `Health`. |
| Mobile calendar gestures, pinch density, and delete entry action | Done | PR #32. | Added day swipe, pinch zoom, and completed-entry delete affordance. |
| Rule assistant draft/simulate slice | Done | PR #30. | Plain-language automation requests can draft evidence checks, simulation checks, outcomes, and unsupported gaps. |
| Natural-language rules that auto-write time | Planned | PR #30 deliberately stops at draft/simulate. | Keep final writes deterministic, auditable, and user-approved before enabling auto-write. |
| Incomplete review durations showing huge live-to-now values | Done | PR #30. | Incomplete suggestions no longer accrue absurd durations such as hundreds of hours. |
| Health Review backlog drain | Watch | PRs #25, #26, #27, and #29. | Bounded reprocess batches, prioritisation, covered-row handling, and legacy cleanup migration are merged; watch live backlog behaviour. |
| Stale reviewed cards / already-resolved popups | Watch | PRs #22, #26, and #30. | Confirm/Dismiss became idempotent or structured; mobile removes resolved cards optimistically. |
| Sleep stages fragmented into REM/Core/Deep cards | Watch | PRs #23, #26, and #29. | Current imports group sessions; legacy sleep-stage backlog cleanup is merged. |
| Health items left in Review without useful explanation | Watch | PRs #22, #25, #26, #27, and #29. | Diagnostics and left-in-review reasons exist; continue checking that reasons are clear on device. |
| Geo/place default description mismatch | Done | PR #19 and PR #26. | Place names should remain reference/context; configured activity descriptions are used for geofence display and Confirm. |
| TestFlight release preflight and compliance checks | Done | PR #31 plus build release runs. | Keep verifying processing state, encryption compliance, notes, and internal testing assignment before asking KB to test. |

## Future Tracks

| Item | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Dayframe Preview / pre-prod lane | Future | Repeatedly noted as useful after the current fast TestFlight lane stabilises. | Likely separate preview bundle/app, staging Vercel/Supabase, and TestFlight lane before merging to production. |
| Durable repo tracker | Done | This document. | Update this file whenever a planned item moves, ships, is skipped, or needs live-watch status. |
| Full automation rule creation/editing | Future | PR #30 proves draft/simulate only. | Needs UI for saving, simulating, explaining, editing, disabling, and auditing rules. |
| Account/workspace deletion and deeper privacy controls | Future | PRD/README call out export and deletion as next-phase privacy work. | Ensure raw health/location payloads are deletable and exportable. |
| Broader replacement-readiness work | Future | Older Dayframe audits tracked this as the long-term direction. | Includes deeper reporting/export/backup confidence, restore paths, and continued real-world iOS validation. |

## Maintenance Rules

- Update status immediately after a PR merge, TestFlight build, or KB validation report.
- Keep `Watch` for fixes that are merged but depend on real HealthKit, geofence, or production data behaviour.
- Add PR/build evidence when moving an item to `Done`.
- Do not treat a chat plan as done unless GitHub/local code or TestFlight state verifies it.
