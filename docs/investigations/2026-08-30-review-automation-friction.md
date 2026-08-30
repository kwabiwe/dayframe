# Review automation and durable corrections

Status: implementation in progress; no staging or device acceptance claimed.

Baseline: `df59588a68391dec7693b266e71255350ce7cd15` (`origin/main`, fetched 2026-08-30).
Branch: `codex/pr186-review-automation-friction` in an isolated worktree; original checkout preserved.

## Contract and boundaries

Owner contract: `dayframe_pr186_review_automation_and_friction_plan.md`, prepared 2026-08-30. Normal automatic confidence is medium-high/high; each Location boundary and each thresholded overlap allows five minutes inclusive. Health overlaps may coexist, while sample/session duplicate protections remain. Medium commutes require the explicitly approved distinct saved-route exception. Existing Location Review remains user-owned.

Shared owns pure policy and strict schemas; server owns canonical eligibility, event-first transactions and idempotent receipts; Review SQLite owns account-bound intent and source-item effects; React owns presentation. PR #184 retains recovery ownership. PR #185 timer background assertions do not admit Review work. No major Review redesign or unmeasured list rewrite.

Existing Postgres boundary, max-gap and receipt columns cover the planned work. SQLite requires an additive transactional v4→v5 effects table and non-destructive backfill. No Postgres migration is currently required.

## Investigation

- Automatic logging: blanket continuity/overlap guards discard measurable boundary and activity context. Test exact threshold edges and canonical provenance rather than changing detected times.
- Back delay hypothesis A: repeated peer/interval preparation scales with backlog. Measure synthetic 2/13/25/50 profiles.
- Back delay hypothesis B: evidence prefetch/Health reprocess and stale callbacks compete with navigation. Measure cancellation and transition timing separately; do not infer device timing from desktop computation.
- Complex actions currently bypass the outbox. Merges require two source snapshots, atomic ownership, selective conflict restore and receipt replay of structural effects.

## Motion contract

- Local save trigger: committed SQLite intent only. Existing native stack owns detail pop; existing Review presence/layout primitives own source-card removal and restoration. Both merge sources share one durable action. No network await owns dismissal.
- Status trigger: message present/cleared/replaced. Existing local Reanimated presence/layout primitives own restrained opacity and reflow below the first summary. Header geometry stays fixed; no empty reserved band.
- POI trigger: one current nearby/search request publishes transient results. Existing local presence owner handles list entry/replacement/exit; native stack remains the navigation owner.
- Interruption: duplicate taps are gated; route/account generations invalidate stale callbacks, cancellation reaches prefetch, and a newer message/request supersedes older work.
- Async: SQLite failure retains all cards and the exact draft; retry/auth keeps committed effects hidden; permanent conflict restores only canonically open sources at surviving anchors. Structural children appear from canonical refresh, never fabricated locally.
- Reduce Motion: remove travel/reflow animation or use restrained opacity. Preserve semantic updates, 44-point targets, VoiceOver announcements without focus stealing, Dynamic Type and existing Reduce Transparency treatment.

## Validation

Pending. Commands, measured results, staging identity, failed/skipped checks and physical-device PASS/FAIL/NOT RUN must be recorded before handoff. No production configuration/data may be used.
