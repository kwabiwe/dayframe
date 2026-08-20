# Dayframe Feature And Fix Tracker

This is the canonical delivery-state snapshot. Product intent belongs in `docs/PRD.md`, architecture in `docs/architecture.md`, validation rules in `.codex/reference/validation-matrix.md`, and detailed implementation evidence in `docs/investigations/` and Git history.

Last repository audit: 2026-08-20 against `origin/main` at merge `8d88765` (PR #182).

## Evidence snapshot

- Main includes PRs #149–#182. Since build 93 it has added mobile lifecycle/Keychain recovery and locked-screen Live Activity hardening (#176), web entry-form and Review-evidence follow-ups (#177–#178), mobile session/login/Review-sync ownership guards (#179–#180), documentation/process guardrails (#181), and durable account-scoped timer Stop plus Live Activity convergence (#182).
- The latest TestFlight release is `0.1.0 (97)`, delivery ID `c849ea28-424d-4222-8b57-14bcf25c310a`, archived from `8d88765` and recorded as `VALID`/`IN_BETA_TESTING` on 2026-08-20. It includes main through PR #182; export compliance is false, en-GB notes are set, and external testing remains disabled.
- PR #182's exact staging head was signed, installed, launched, and owner-tested on the attached iPhone 11 before merge. The real two-connection local PostgreSQL advisory-lock contention test was rerun after merge and passed before build 97 was released.
- PR #169's Preview was promoted to staging and exercised through a signed preview build on the attached iPhone. This tracker does not infer production deployment or TestFlight status from that staging evidence.
- Preview uses staging Supabase and the manually promoted `dayframe-staging.vercel.app` alias. Production/TestFlight use `dayframe-web.vercel.app` with production Supabase.

## Status key

- `Done`: present on main with appropriate repository-level evidence.
- `Watch`: merged, but real data, production, or physical-device behavior still needs observation.
- `Release pending`: present on main but not in the last repository-recorded mobile binary.
- `Implementation pending`: present only on the active implementation branch and still requires merge plus release evidence.
- `Decision needed`: implementation should not advance until the owner chooses the product/operational policy.
- `Future`: explicitly out of the current implementation lane.

## Current delivery state

| Area | Status | Current evidence and boundary |
| --- | --- | --- |
| Event-first manual timer and completed-entry writes | Done | Web/mobile start, stop, switch, split, and completed manual creation flow through `activity_events` before derived entries; focused service/route coverage exists. Existing entry edits/deletes mutate derived data rather than fabricating new capture signals. |
| Category/task-first UX and reusable tags | Done | Description and category remain optional; projects/clients are compatibility-only. Tags have workspace-scoped storage, web/mobile editing, offline queued-start support, shared native Calendar presentation, and a 30-colour category palette contract. Eligible web timer, Add Time, Timeline List, and Calendar create/edit pickers can also create an unpinned category without leaving or submitting the current draft; the deterministic automatic colour remains the default and can be replaced before creation from the shared palette. |
| Persistent web timer and Timeline | Done | One shell timer owner spans Dashboard/Timeline. Calendar/List/Timesheet, click-to-create, eligible pointer resize, shared quick editing, grouped description/time editing, overlap handling, and Today rollover are on main through PR #165. |
| Web reports, search, settings, place management, and export | Done | Range-scoped reports, historical search, shared entry editor, hosted place search adapter, workspace settings, CSV/JSON export, and responsive/focus guardrails are implemented. Saved places and one-time location labels share the public `placeName` read path; reports group normalized one-time labels. Provider-backed web place search still depends on a configured server key. |
| Mobile shared time-entry sheets and tag persistence | Watch | PRs #163 and #164 are included in TestFlight build 93. Repository tests cover keyboard/tag/layout/persistence paths; continue physical-iPhone lifecycle, keyboard, tag, and sheet-exit observation. |
| Native iOS Calendar | Watch | SwiftUI/UIKit Calendar, one native pinch/scroll owner, semantic blocks, long-press creation, React-owned sheets/mutations, dedicated saved/one-time location text, and contract tests are implemented. Continue physical-iPhone gesture, callback, accessibility, and frame-pacing checks. |
| Offline event capture and timer fallback | Watch | General event queue has retry/backoff, foreground drain, idempotency, and diagnostics. PR #176's lifecycle/Keychain recovery, PR #179's bearer ownership hardening, and PR #182's dedicated Stop outbox are included in TestFlight build 97; continue real-device reconnect, suspended/background, ordered dependency, and cross-device reconciliation observation. |
| Mobile explicit Stop durability and contention ([Trello #147](https://trello.com/c/XBVc6pe6/147-mobile-timer-stop-hangs-during-background-event-sync)) | Watch | PR #182 adds an account-owned storage-only Stop outbox, persist-before-dismiss acceptance, malformed-container recovery, authenticated generation/token revalidation before dispatch, exact `/api/events` replay, bounded mobile delivery, entry-scoped server locking and fail-closed legacy handling. Focused storage/session/route/idempotency coverage and the real two-connection PostgreSQL contention test pass. The exact staging head was signed and owner-tested on the attached iPhone 11, and the merge is in TestFlight build 97; continue production offline/force-quit/account-switch observation. |
| Offline Review terminal actions | Watch | Account-scoped SQLite Review cache/outbox, server receipts, visible pending state, retry/conflict handling, and validators are implemented. Detailed Location Evidence actions remain connectivity-dependent. |
| Mobile login and Review sync follow-up | Watch | PR #180 adds bounded auth/bootstrap/queued-event/Review deadlines, an atomic branded post-auth opening state, retry-action semantics, and the time-only automatic Location Evidence editor with live Duration. It is included in TestFlight builds 96 and 97; continue physical-iPhone slow/stalled-network observation. |
| Mobile Review and Location Evidence presentation | Watch | Review uses separate activity cards with inset straight category rails, prominent activity/time, accessible confidence, and a concise reason automatic logging did not apply. Commutes show only honest route evidence plus What/When. Unknown stays load up to three nearby Apple POIs, use a bounded transient contextual lookup and destination diversity when Apple exposes a repeated site name, retain typed search/map fallback, and default to one-time recording with an opt-in saved place; generated unknown activity starts empty, category visuals stay compact inside 44 pt targets, and the outer evidence scroll owner keeps focused Search/Activity fields above the iOS keyboard. PR #172's exact Preview from `f0904b1` was promoted to staging and its signed Staging build was installed on the attached iPhone. The owner reports successful PR #174 testing on the attached iPhone 11, and PRs #173–#175 are included in TestFlight build 93; continue production-data and lifecycle observation. |
| HealthKit sleep/workout import | Watch | Event-first import, grouped sleep sessions, mapping defaults, reprocess diagnostics, same-source untouched-entry reconciliation, and migration `202608010001_health_sleep_session_reconciliation.sql` are on main. Background delivery and real HealthKit sample revisions remain physical-device/production concerns. |
| Location Intelligence V2 foundation | Watch | Deterministic shared engine, protected mobile journal, server evidence/segments, Review DTO, split/merge/change-place/record-once/record-POI-once/save-and-confirm actions, retention cron, and narrow automatic writes for trusted stays plus finalised continuous route-backed `medium_high`/`high` commutes between saved endpoints are implemented. PR #179's mobile bearer/cookie session split is included in TestFlight build 97. Retention/logout clearing cannot reconstruct already-removed evidence. Checked-in fallback remains `v2_shadow`; live rollout is the operational decision below. |
| Live Activity/App Intent sync ([Trello #148](https://trello.com/c/UN0A4CbV/148-duplicate-optimistic-and-canonical-live-activities-on-iphone)) | Watch | PR #160's App Group/Keychain hand-off, direct Stop fallback, APNs registration, revisioned delivery outbox, diagnostics, and retry cron remain the baseline. PR #182 adds awaited snapshot-verified native cleanup, zero-or-one canonical Activity per generation, registration/Stop revalidation, and stale same-entry registration invalidation. Automated coverage passes, the exact staging head was signed and owner-tested on the attached iPhone 11, and the merge is included in TestFlight build 97; continue locked/background/terminated replacement observation. |
| Hosted provider auth and staging lane | Watch | Supabase identity plus Dayframe sessions, workspace/user scoping, staging Preview isolation, stable staging alias process, preview/production EAS targets, and staging badge are implemented. PRs #179–#180 are included in TestFlight build 97. Authenticated staging smoke, schema currency, alias promotion, and production verification remain per-PR evidence, not assumed state. |
| Workspace/time/event/review export | Done | JSON/CSV APIs and local workspace export exist; retained Location V2 evidence is included where documented. Restore/import confidence and sole-system-of-record readiness remain future work. |
| Account/workspace deletion and backup-retention policy | Decision needed | Entry/evidence deletion paths exist, but full account/workspace deletion, integration-token cleanup, raw Health/location deletion, backup/log retention, and user-facing confirmation semantics are not complete. |
| Automation accuracy metrics | Decision needed | Review outcomes are stored, but the PRD's former claim that anonymized accepted/ignored accuracy analytics were shipped is not supported by a dedicated product surface or analytics implementation. Decide whether this is an internal report, privacy-preserving telemetry, or out of scope. |

## Decision register

| Decision | Why it cannot be inferred safely | Options to decide between |
| --- | --- | --- |
| Production Location V2 mode | Code supports `v1`, `v2_shadow`, `v2_review`, and narrow `v2_enabled`; repository defaults intentionally fail closed. | Keep shadow, enable Review-only, or operationally enable the documented trusted-stay and high-confidence saved-endpoint commute policy after staging/device evidence. |
| Automation accuracy measurement | Stored Review outcomes could support a local report or external analytics, with materially different privacy implications. | Remove from MVP, add an owner-only in-product report, or design privacy-reviewed telemetry. |
| Full deletion and retention | Hard deletion interacts with derived entries, exports, server logs, backups, integration tokens, and legal/user expectations. | Define immediate hard delete, staged retention, or anonymized remnants and document backup behavior. |
| Separate staging iOS identity | Current preview installs can replace production/TestFlight and reuse bundle-scoped state. | Accept replace-and-test for now or create separate bundle/App Group/Keychain/APNs/EAS identities. |
| Native NFC beyond Apple Shortcuts | The shipped path uses App Intents/Shortcuts; a native scanner adds entitlement, UX, and background constraints. | Keep Shortcuts-only or approve a separately scoped native NFC design. |
| Wider beta/App Store lane | MVP remains personal/friends internal TestFlight. | Continue internal-only or define external TestFlight/App Store readiness criteria. |
| Persisted activity/category icons | A display-only mobile glyph can be derived safely, but stored custom icons affect web, React Native, native Calendar, export, accessibility, and legacy clients. | Keep derived presentation glyphs, approve a shared first-party icon enum, or design user-uploaded/custom icon metadata separately. |
| Commute endpoint correction | Current commute evidence renders a route, while saved-place correction and bounded match feedback are stay-owned. Editing origin/destination would change segment and learning semantics. | Keep commute route read-only or define atomic origin/destination correction and feedback rules. |

## Future tracks

- Safe restore/import and larger-data reporting confidence.
- Token-management UI and deliberately scoped Home Assistant/local bridge inputs.
- Calendar integration hints, realtime transport, and richer automation-rule management.
- Voice/diary correction intake through a review-first audit trail.
- Billing, teams, and non-iOS mobile remain out of scope unless the PRD changes.

## Maintenance rules

- Update this file in the same PR when a shipped/watch/release/decision state changes.
- Verify GitHub state before calling work `In progress`; dated investigation notes are not current-state evidence.
- Record exact merged PR/commit, deployment, migration, TestFlight build, or physical-device evidence only when it was actually checked.
- Keep detailed validation logs in the relevant investigation or PR, not in this tracker.
- Run `npm run check:docs` and the pre-PR documentation checklist before publication.
