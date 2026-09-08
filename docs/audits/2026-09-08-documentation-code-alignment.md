# Documentation And Code-Alignment Audit — 2026-09-08

## Scope and baseline

Audited freshly fetched `origin/main` at `ae60f6d` (merged PR #191). GitHub reports PRs #186–#191 merged in order at `5fd50cf`, `d649e2d`, `2dc2a90`, `108bfc0`, `3f91d08`, and `ae60f6d`.

The audit covered `AGENTS.md`, the PRD, architecture, feature tracker, regression checklist, documentation governance, every `.codex/reference/*.md`, hosted/iOS/TestFlight runbooks, production readiness, configuration and migration sources, the implementation/tests changed by PRs #186–#191, and their recent investigation records. Application code and behavior were not changed.

## Resolved documentation drift

| Stale or contradictory statement | Resolution |
| --- | --- |
| The delivery tracker stopped at PR #187 and still called the #188–#191 stack unmerged or implementation-pending. | Advanced the canonical audit baseline to PR #191 and recorded all six merge commits. Current-main behavior is now separated from still-unrecorded production, TestFlight, signed-device, and physical-device evidence. |
| Health capture was described as a draft branch, and mobile recovery as a branch awaiting its server prerequisite. | Marked PRs #188–#190 as merged/release-pending and documented bounded transactions, v6 Review reconciliation, independent recovery lanes, deliberate Settings sync, and the owner-scoped Health journal. |
| The Review tracker, regression checklist, and validation matrix said split/merge/place/record actions remained direct-only or connectivity-dependent. | Aligned them with PR #186: every resolving/structural Location action uses the strict durable Review outbox; only fresh evidence/provider lookup and compatibility-only pure `change_place` remain live-dependent. |
| Stable references documented SQLite v5 effects but omitted PR #188's v6 interrupted-delivery and receipt-reconciliation metadata. | Added the v5→v6 contract, immutable-envelope/anchor preservation, proof-before-retry behavior, unknown-outcome handling, and v4→v5→v6 validation coverage. |
| The connectivity checklist simultaneously said any online pending work animates and only active transmission animates. | Made waiting/dependency/backoff work visually silent and reserved rotating arrows for an active reconnect/recovery transmission. |
| PR #191 was still pending, while the PRD/README/agent rules still called the staging iOS identity a future decision and warned that preview replaces TestFlight. | Recorded the implemented `com.layereight.dayframe.staging` lane and its isolated App Group, Keychain, URL scheme, Live Activity extension, and on-device state. Signed-device isolation remains an evidence gate, not a product decision. |
| The iOS hosted runbook listed only production URL-scheme/App Group/Keychain capabilities. | Added the matching staging host/extension identities and provisioning guidance. |
| Production-readiness guidance omitted the approved medium commute exception and reduced durable Health capture to anchored-query dedupe. | Pointed Location policy back to the canonical PRD guards and documented the owner-scoped source journal, split-query reconstruction, immutable delivery identity, and exact acknowledgement. |
| Recent investigation headers could be read as current branch/merge state. | Preserved their original evidence and added dated historical-status notes pointing to the canonical tracker. |

## Evidence boundaries retained

- The latest repository-attested internal TestFlight release remains build 100 from PR #185. Build 103 was observed as valid, but its source/API/runtime provenance was not recorded, so it is not used to claim current-main release.
- Exact PR #190 combined staging evidence and a later pre-final PR #191 staging head are recorded. No exact-final PR #191 stable-alias promotion or signed staging-device acceptance is claimed.
- No production deployment, production resolution-link migration, production incident repair, TestFlight upload, rollout-mode change, or historical-data repair was inferred from merges or passing CI.
- The September 4 Review/Sleep/commute records remain unresolved until their exact source-to-visible-state chains are proved.

## Decisions still open

The canonical decision register still requires owner choices for:

- production Location V2 mode (`v2_shadow`, `v2_review`, or the narrow documented `v2_enabled` policy);
- automation-quality measurement versus privacy-reviewed telemetry versus removal from MVP;
- full account/workspace deletion, sensitive-data/token cleanup, and backup/log retention semantics;
- native NFC beyond Shortcuts/App Intents;
- the wider beta/external TestFlight/App Store lane;
- persisted activity/category icon semantics;
- commute endpoint correction and learning feedback.

The implemented staging identity is no longer a product decision. Its signed-entitlement and cross-process physical-device checks remain release validation.

## Validation

- `npm run check:docs` — PASS.
- `git diff --check` — PASS.
- Complete diff review — PASS; Markdown/reference files only, with no application, configuration, migration, lockfile, or generated-artifact changes.
