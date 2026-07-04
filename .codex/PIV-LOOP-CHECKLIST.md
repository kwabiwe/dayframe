# Codex PIV Loop Checklist

Use this for every implementation phase or feature.

## Plan

- [ ] Ask Codex to read and follow `.codex/prompts/prime.md`.
- [ ] Discuss the next PRD phase or feature in plain language.
- [ ] Ask Codex to research codebase patterns and relevant docs.
- [ ] Require meta-reasoning against `docs/PRD.md`, `AGENTS.md`, and relevant `.codex/reference/` files before accepting a plan.
- [ ] Answer clarifying questions.
- [ ] Ask Codex to read `.codex/prompts/plan-feature.md` and create a plan in `.codex/plans/`.
- [ ] Review the generated plan.
- [ ] Confirm the validation strategy is specific and executable.
- [ ] Confirm UI work includes simulator/browser manual validation using computer-use where available.
- [ ] Confirm hosted work includes Supabase migration checks in timestamp order after the base schema.
- [ ] Create or update `.env.example`.
- [ ] Fill in `.env` locally before implementation begins.

## Implement

- [ ] Reset context after the plan is approved.
- [ ] Start a new Codex thread or new focused conversation.
- [ ] Ask Codex to read `.codex/prompts/execute-plan.md` and execute the approved plan.
- [ ] Require all validation commands from the plan to run.

## Validate

- [ ] Review code changes yourself.
- [ ] Run type checks, linting, tests, and build.
- [ ] Manually test the app like a user.
- [ ] Run browser validation when the feature touches UI.
- [ ] Run simulator/manual mobile validation when the feature touches mobile UI, timer, settings, permissions, or theme behavior.
- [ ] Fix issues and re-run failed validation.
- [ ] Update tests to cover bugs found during validation.
- [ ] Update `docs/PRD.md`, `docs/dayframe-regression-checklist.md`, `AGENTS.md`, or `.codex/reference/` if missing or outdated context caused drift.
- [ ] Re-run repository text checks for banned/outdated product direction before claiming done.
- [ ] Ask Codex to read `.codex/prompts/commit.md` or make a manual atomic commit.
