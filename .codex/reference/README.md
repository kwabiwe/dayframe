# On-Demand Agent Context

`AGENTS.md` contains short rules that apply to every task. Load only the relevant references below for deeper feature contracts.

Canonical repository documents:

- `docs/PRD.md`: stable product intent and scope.
- `docs/architecture.md`: runtime, data, authentication, storage, native-boundary, and deployment ownership.
- `docs/feature-fix-tracker.md`: current Done/Watch/Release pending/Decision state.
- `docs/documentation-governance.md`: document ownership, conflict resolution, and the pre-PR documentation gate.
- `docs/brand-style-guide.md`: brand assets, semantic visual tokens, accessibility, and platform design language.
- `docs/dayframe-regression-checklist.md`: user-visible behavior that must not regress.
- `docs/vercel-supabase-hosting.md`: hosted environment and staging/production operations.

On-demand references:

- `components.md`: frontend component and native-view boundary patterns.
- `api.md`: API route and service patterns.
- `style.md`: visual implementation rules.
- `testing.md`: testing principles; command/evidence selection remains canonical in `validation-matrix.md`.
- `database.md`: schema, migration, query, and RLS rules.
- `product-model.md`: category/task-first product rules.
- `mobile-permissions.md`: iOS permission states and placement.
- `debugging-playbook.md`: screenshot, production, and regression triage before coding.
- `health-review-pipeline.md`: HealthKit, Review, auto-log, Confirm/Dismiss, and diagnostics.
- `location-learning.md`: Location V2 evidence, segmentation, rollout, privacy, and Review policy.
- `offline-review-mutations.md`: durable Review terminal-action outbox.
- `motion.md`: motion ownership, continuity, accessibility, and PR evidence.
- `release-and-testflight.md`: TestFlight, Vercel, Supabase, and runtime version checks.
- `validation-matrix.md`: canonical validation commands and manual evidence by feature area.
- `process-improvement.md`: lightweight retrospective and guardrail updates.

Dated files under `docs/investigations/` preserve issue evidence and closure criteria. They must not override the PRD, architecture, feature tracker, or these promoted reference contracts after their PR merges.
