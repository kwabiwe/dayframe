# Documentation Governance

This document defines where Dayframe guidance lives and how it stays aligned with code.

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
| What may CPU, memory and render cost be, and how is it measured? | `.codex/reference/performance.md` | Per-build release readings (those go in the release reference) |
| What behaviour must not regress? | `docs/dayframe-regression-checklist.md` | Branch status and historical test output |
| What must every agent know? | `AGENTS.md` | Long feature-specific contracts |
| Why did a particular fix happen? | `docs/investigations/*.md` | New canonical product policy unless promoted |

`README.md` is the contributor entry point. It summarizes the product and links to canonical sources; it is not another specification.

## Status and history rules

- `docs/feature-fix-tracker.md` is the only canonical delivery-state document.
- `.codex-dayframe-qa/STATUS.md` (main checkout, git-ignored) is a working note for handing over between agents and sessions: current state only, rewritten rather than appended, never a diary. It records where work stands and points at canonical documents; it is not one. When it disagrees with a canonical document, the canonical document wins and the note is corrected.
- Dated investigations are evidence records. Their “current,” “next,” or “in progress” wording is historical after the associated PR merges.
- Stable product, architecture, design, and testing documents must not embed “latest build” snapshots. Release records belong in the tracker or release reference.
- A merged implementation may be `Done`, `Watch`, or `Release pending`; never leave it `In progress` solely because a historical investigation says so.
- Do not claim hosted, TestFlight, physical-device, or production validation unless that exact environment was checked.

## Documentation impact

When a change affects durable guidance, update the relevant canonical source:

| Change | Required documentation review |
| --- | --- |
| Product behavior or scope | PRD and feature tracker |
| Runtime ownership, API, data flow, auth, or storage | Architecture plus the relevant API/database reference |
| Schema or hosted environment | Database reference, hosting runbook, migration ordering, env examples |
| User-visible UI or motion | Brand/style/components/motion references and regression checklist |
| Mobile/native behavior | Mobile references, validation matrix, release/TestFlight reference |
| Bug that exposed a missing guardrail | Investigation plus a focused test or automated check |

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
4. Fix clear defects and stale text together.
5. If product intent, privacy, rollout, or destructive behavior is genuinely ambiguous, add it to the tracker’s decision register instead of guessing.

## Maintenance

Update the delivery tracker when verification or release state changes. Retire stale guidance when it could mislead and automate repeated manual checks where practical.
