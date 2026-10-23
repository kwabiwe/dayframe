# Process Improvement

Use this after regressions, repeated mistakes, and larger Dayframe changes.

## Purpose

The process layer should make future work safer without turning every task into bureaucracy. Update it when the repo learns something durable.

## When To Update Guidance

Update docs when:

- a regression happened because a check was missing
- a bug class appears more than once
- a production issue required knowledge not written down
- a feature creates a new invariant or release step
- a manual validation step caught something tests missed

Do not update docs for one-off trivia, temporary command output, or secrets.

## Where Lessons Go

- `AGENTS.md`: short, high-value rules that should always be loaded.
- `docs/documentation-governance.md`: canonical ownership and pre-PR documentation impact rules.
- `.codex/reference/*.md`: detailed guidance loaded only when relevant.
- `docs/investigations/*.md`: active issue notes and evidence trails.
- Tests: executable guardrails for regressions.
- PR description/comment: task-local evidence and validation summary.

If a lesson applies to many projects, promote it to a reusable agent skill or workflow proposal rather than burying it in Dayframe.

## Retrospective Loop

After each focused PR:

1. Identify what failed or changed.
2. Identify which check would have caught it earlier.
3. Add that check to tests or `validation-matrix.md`.
4. Add one concise note to the relevant reference doc if needed.
5. Keep the investigation note current until the issue is closed.
6. Run `npm run check:docs` and ensure the feature tracker no longer describes merged work as active.

After every 3 to 5 Dayframe changes, do a short process review:

- Which docs were useful?
- Which docs were ignored or too vague?
- Which manual checks should become tests?
- Which old notes can be archived?
- Which recurring lessons belong in `AGENTS.md`?

## Merge Gate

A PR is ready to merge only when all of these hold, read at merge time for the exact head being merged:

- `Validation gate` and `Workspace unit tests, typecheck and lint` are present and passing. Both run on every PR (no path filters; the gate uses `if: always()`), so a list without them means CI has not run, not that nothing failed. GitHub Actions does not run on a PR that conflicts with `main`, which leaves only the Vercel rows.
- Every other check is `pass` or `skipping`. Path-based skips (PostGIS on mobile-only or docs-only PRs, iOS on web or docs PRs) are expected; anything `fail`, `pending` or `cancel` blocks the merge.
- The PR's remote head SHA equals the SHA that was reviewed and tested; merge with `--match-head-commit`.

Merge PRs one at a time. When the next PR conflicts with `main` after a merge (usually a tracker row), merge `main` into it and wait for its CI again. A merge script that only checks "no listed check failed" is wrong: on 23 Oct 2026 one merged #541 with `Disposable PostGIS (base)` failing.

## Anti-Patterns

- Giant prompt files that are not tied to the repo.
- Copying external methodology without adapting it to Dayframe.
- Declaring success from tests alone when the bug was user-journey based.
- Treating local simulator results as proof for real HealthKit behaviour.
- Adding docs instead of fixing missing tests or diagnostics.
- Letting investigation notes become a second product spec.
- Merging on "no failing checks" instead of "all required checks passed" (see Merge Gate).
