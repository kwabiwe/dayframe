# Codex Workflow Files

This folder contains project-local context for the Codex workflow.

## Folders

- `prompts/` - reusable instructions you can ask Codex to read and follow
- `plans/` - generated feature plans
- `reference/` - deeper on-demand context for specific work types
- `examples/` - source examples from the original workflow

## How To Use A Prompt

Ask Codex to read the prompt file directly:

```text
Read .codex/prompts/prime.md and follow it.
```

For a prompt that takes an argument, include the argument in the same message:

```text
Read .codex/prompts/execute-plan.md and execute .codex/plans/phase-1-foundation.md.
```
