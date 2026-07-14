# Product Model Guidelines

Use this when changing timer flows, dashboards, reports, entity management, onboarding, or settings.

## Current Product Direction

- Dayframe is category/task-first.
- The primary user-facing fields are task title/description and category.
- Task title is optional.
- Category is optional and can be added while a task is running.
- Quick actions should show user-pinned categories only. Learned or recent tasks belong in task-entry suggestions, not the pinned category strip.
- Existing projects may be converted into categories.
- Projects and clients are legacy/internal compatibility until explicitly approved for user-facing UX again.

## Timer UX Rules

- Starting a timer must not require a project.
- Stopping a timer must close the authenticated user's active timer in the current workspace.
- Active timer state must refresh correctly on web and mobile.
- Manual completed entries should support category-only or uncategorized entries.
- User-facing labels should say task, category, time entry, place, or source. Avoid project/client wording unless working on a compatibility or migration surface.

## Rule Assistant Rules

- Plain-language automation requests should become structured evidence checks before they become executable rules.
- Multi-step rules such as home -> station -> home must simulate against event history and show rejection reasons before any automatic write is enabled.
- Model-generated drafts can help with wording and intent, but the time-entry writer must stay deterministic and auditable.

## Data Compatibility

- Keep nullable legacy columns such as `time_entries.project_id` until a deliberate migration removes them.
- Do not delete existing project/client data without an approved migration and export/safety plan.
- Reports should prioritize category and source/place breakdowns. Legacy project/client reports should be hidden or demoted unless explicitly requested.

## Standalone Product Copy

- Do not describe Dayframe through legacy third-party timer brands.
- Do not add legacy timer-brand imports, scripts, docs, env vars, tests, seeds, or hidden integration hooks.
- Dayframe should be described as a standalone time-intelligence app.
