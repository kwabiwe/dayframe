# Testing And Validation Guidelines

Use this when planning or validating implementation work.

## Validation Pyramid

1. Syntax, formatting, linting, and type checks.
2. Unit tests for isolated logic.
3. Integration tests for database/API/component boundaries.
4. End-to-end tests for critical user journeys.
5. Manual human review and exploratory testing.

## Regression Habit

When a bug is found:

- Write or update a failing test that reproduces it.
- Fix the implementation.
- Re-run the failing test and the relevant regression suite.
- Update global rules, on-demand context, or commands if missing context caused the bug.

## Review Checklist

- [ ] Validation commands are listed in the feature plan before implementation.
- [ ] Commands are non-interactive and executable.
- [ ] The agent reports exact commands and outcomes.
- [ ] Browser/UI changes include screenshots or manual testing notes.
