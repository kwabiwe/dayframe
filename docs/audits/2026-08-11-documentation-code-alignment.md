# Documentation And Code-Alignment Audit — 2026-08-11

## Scope and baseline

Audited `origin/main` at merge `847ac76` (PR #165) against:

- contributor/agent guidance (`README.md`, `AGENTS.md`, `.codex/reference/*`);
- product and delivery state (`docs/PRD.md`, `docs/feature-fix-tracker.md`);
- design and interaction contracts (`docs/brand-style-guide.md`, style/components/motion references);
- architecture, API, database, Health, location, offline Review, and permission guidance;
- testing/regression/validation references;
- local auth, Vercel/Supabase, iOS hosting, TestFlight, and production-readiness runbooks;
- package scripts/manifests, environment templates, EAS/Vercel config, route trees, migrations, focused source paths, tests, Git history, and current GitHub PR state;
- dated investigations relevant to the features now on main.

GitHub reported no open PRs during the audit. The last repository-recorded TestFlight build is 87 from `91380dc`, while main contains later mobile PRs #163/#164 and web PR #165. Hosted production, stable staging, live schema, and physical-device state were not inferred from source.

## Resolved inconsistencies

| Inconsistency | Classification | Resolution |
| --- | --- | --- |
| PRD/production/Health guidance described builds 13 or 58 as “current” while main and the release record had advanced materially. | Documentation stale | Removed release snapshots from stable product/operational references; the tracker and release reference now own dated state. |
| The feature tracker still labelled many merged PRs (#88, #112, #114, #117, #121, #126, #149–#165) or merged branches as active/in progress. | Documentation stale | Replaced it with a concise main/TestFlight/watch/decision snapshot verified against GitHub and Git history. |
| README said Calendar resize and Location Review split/merge were not implemented and implied native NFC was the next required path. | Documentation stale | Rewrote README around current web/native Calendar, shared editors, implemented Location actions, and the shipped Shortcuts/App Intent route. Native NFC is now an explicit decision. |
| Brand/style/testing docs duplicated an obsolete 12-colour Midnight Core palette while shared code exposes 30 current keys and a separate picker order. | Documentation stale | Made `packages/shared/src/palette.ts` the executable category-palette source of truth; updated brand, style, regression, and validation guidance to the 30-colour contract. |
| The PRD marked offline recovery/diagnostics as missing despite durable event and Review queues, retry/backoff, diagnostics, idempotency, and validators. | Documentation stale | Marked the implementation present and retained real-device/background/conflict behavior as Watch. |
| The PRD claimed anonymized automation accuracy analytics were shipped, but code only stores Review outcomes and exposes no dedicated metrics/telemetry product. | Unsupported product claim; intent ambiguous | Removed the shipped claim and added a decision item for local reporting versus privacy-reviewed telemetry versus removal from MVP. |
| Architecture rules were spread across README, PRD, production readiness, and feature references with no canonical ownership document. | Documentation missing/duplicated | Added `docs/architecture.md` and a canonical document map in `docs/documentation-governance.md`; shortened entry-point/status guidance accordingly. |
| Setup copied root `.env.example`, but Next.js workspace commands load `apps/web/.env.local`; the web template also omitted provider auth, signup, session TTL, staging badge, and Geoapify variables, while the root template omitted APNs/session/staging variables. | Documentation/configuration wrong | Corrected setup commands, documented file-loading behavior and session TTL, and aligned both templates with hosted runtime variables. |
| Database guidance called `001_init.sql` the entire local schema even though setup applies later tag/Live Activity migrations. | Documentation stale | Documented ordered local migration history while retaining `001_init.sql` as the base. |
| Release guidance hard-coded one branch prefix and required TestFlight for every implementation, conflicting with the global feature-based release rule. | Documentation contradictory | Deferred branch prefix to the active client convention and limited mandatory TestFlight release evidence to mobile/native/mobile-contract or explicitly requested work. |
| Unknown `POST /api/time-entries` modes silently fell through to a timer start; malformed JSON became a server error. | Implementation wrong | Added closed-set mode parsing, structured JSON-object validation, client errors, and no-mutation regression tests. |
| Unknown `/api/export?kind=` values reached an unsupported service default and surfaced as a server error. | Implementation wrong | Added an executable export-kind list/type guard, structured `400`, and route regression coverage. |

## Decisions intentionally left open

These were not safe to infer from code or historical notes and are recorded in `docs/feature-fix-tracker.md`:

- production Location V2 mode (`v2_shadow`, `v2_review`, or narrow `v2_enabled` after evidence);
- automation-quality reporting versus external analytics versus removal from MVP;
- full account/workspace deletion, raw-data/token cleanup, and backup/log retention semantics;
- separate staging bundle/App Group/Keychain/APNs/EAS identity;
- native NFC beyond Apple Shortcuts/App Intents;
- wider beta/external TestFlight/App Store criteria.

## Durable safeguards added

- `npm run check:docs` validates all local Markdown links, documented root npm scripts, referenced migration files, stable-doc snapshot phrases, and hosted environment-template coverage.
- `npm run lint` now includes the documentation-alignment gate.
- A lightweight GitHub Actions workflow runs the documentation check on every PR and push to main without installing the application dependency tree.
- A repository PR template requires documentation-impact classification, feature-tracker review, exact validation evidence, motion contracts where applicable, and explicit residual decisions/Watch state.
- Agent, testing, validation, and process references now require the documentation impact gate and prevent dated investigations from overriding canonical state.
- Focused route tests protect the two API discriminator/query validation defects found by this audit.

## Validation evidence

- `npm run check:docs` — passed across 101 Markdown files.
- Focused web route tests for time-entry and export validation — 20 tests passed.
- `npm run lint` — passed, including documentation and iOS configuration checks plus web ESLint.
- `npm run typecheck` — passed for mobile, web, and shared workspaces.
- `npm run test` — passed: mobile 620, web 736, shared 150 (1,506 tests total).
- `npm run build` — optimized Next.js production build passed.
- `npm run check:brand-assets` and `git diff --check` — passed.
