# Documentation Governance

This document defines where Dayframe guidance lives and how it stays aligned with code. It is intentionally short enough to use before every PR.

## Canonical document map

| Question | Canonical source | What does not belong there |
| --- | --- | --- |
| What product are we building? | `docs/PRD.md` | Build numbers, active branches, transient release state |
| How do runtime/data boundaries work? | `docs/architecture.md` | Feature acceptance history |
| What is shipped, watched, or awaiting a decision? | `docs/feature-fix-tracker.md` | Full implementation narratives and command logs |
| What is the visual system? | `docs/brand-style-guide.md` | One-off screen fixes |
| How is hosted auth/deployment configured? | `docs/vercel-supabase-hosting.md` | TestFlight release history |
| How is iOS released? | `.codex/reference/release-and-testflight.md` | Product requirements |
| Which checks apply? | `.codex/reference/validation-matrix.md` | Repeating every behavioural acceptance criterion |
| What behaviour must not regress? | `docs/dayframe-regression-checklist.md` | Branch status and historical test output |
| What must every agent know? | `AGENTS.md` | Long feature-specific contracts |
| Why did a particular fix happen? | `docs/investigations/*.md` | New canonical product policy unless promoted |

`README.md` is the contributor entry point. It summarizes the product and links to canonical sources; it is not another specification.

## Status and history rules

- `docs/feature-fix-tracker.md` is the only canonical delivery-state document.
- Dated investigations are evidence records. Their “current,” “next,” or “in progress” wording is historical after the associated PR merges.
- Stable product, architecture, design, and testing documents must not embed “latest build” snapshots. Release records belong in the tracker or release reference.
- A merged implementation may be `Done`, `Watch`, or `Release pending`; never leave it `In progress` solely because a historical investigation says so.
- Do not claim hosted, TestFlight, physical-device, or production validation unless that exact environment was checked.

## Documentation impact gate

Before opening a PR, classify its impact:

| Change | Required documentation review |
| --- | --- |
| Product behavior or scope | PRD and feature tracker |
| Runtime ownership, API, data flow, auth, or storage | Architecture plus the relevant API/database reference |
| Schema or hosted environment | Database reference, hosting runbook, migration ordering, env examples |
| User-visible UI or motion | Brand/style/components/motion references and regression checklist |
| Mobile/native behavior | Mobile references, validation matrix, release/TestFlight reference |
| Bug that exposed a missing guardrail | Investigation plus a focused test or automated check |
| No documentation impact | State why in the PR checklist |

Run:

```bash
npm run check:docs
git diff --check
```

The documentation check validates local Markdown links, documented npm scripts and migration paths, canonical environment-template coverage, and known stale snapshot language. It cannot decide product intent or prove hosted/device state; those remain review responsibilities.

## Conflict resolution

When guidance conflicts with code:

1. Verify the current `origin/main` implementation and tests.
2. Check the PR/merge and dated investigation that introduced the behavior.
3. Decide whether the stable document is stale or the implementation violates an explicit product invariant.
4. Fix clear defects and stale text in the same focused PR.
5. If product intent, privacy, rollout, or destructive behavior is genuinely ambiguous, add it to the tracker’s decision register instead of guessing.

## Maintenance cadence

- Every implementation PR: complete the PR documentation checklist and update affected canonical sources.
- Every merge/release: update the delivery tracker only when repository, hosted, or TestFlight evidence actually changes.
- Every 3–5 material changes: remove superseded tracker detail, promote durable lessons from investigations, and convert repeated manual checks into tests where practical.
- Periodic audit: run this document’s impact gate, check `git log`/GitHub state against the tracker, and review configuration examples against actual `process.env` use.
