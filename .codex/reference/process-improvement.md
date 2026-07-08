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

After every 3 to 5 Dayframe changes, do a short process review:

- Which docs were useful?
- Which docs were ignored or too vague?
- Which manual checks should become tests?
- Which old notes can be archived?
- Which recurring lessons belong in `AGENTS.md`?

## Anti-Patterns

- Giant prompt files that are not tied to the repo.
- Copying external methodology without adapting it to Dayframe.
- Declaring success from tests alone when the bug was user-journey based.
- Treating local simulator results as proof for real HealthKit behaviour.
- Adding docs instead of fixing missing tests or diagnostics.
- Letting investigation notes become a second product spec.
