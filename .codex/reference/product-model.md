# Product Model Guidelines

Use this when changing timer flows, dashboards, reports, entity management, onboarding, or settings.

## Current Product Direction

- Dayframe is category/task-first.
- The primary user-facing fields are task title/description and category.
- Task title is optional.
- Category is optional and can be added while a task is running.
- Quick actions should combine pinned categories with most-used categories.
- Existing projects may be converted into categories.
- Projects and clients are not normal user-facing concepts. Treat them only as legacy/internal compatibility until explicitly approved for user-facing UX again.

## Timer UX Rules

- Starting a timer must not require a project.
- Stopping a timer must close the authenticated user's active timer in the current workspace.
- Active timer state must refresh correctly on web and mobile.
- Manual completed entries should support category-only or uncategorized entries.
- User-facing labels should say task, category, time entry, place, or source. Avoid project/client wording unless working on a compatibility or migration surface.
- Mobile category chips start immediately when tapped.
- Mobile unconfirmed starts should show queued/starting state until server confirmation.

## Data Compatibility

- Keep nullable legacy columns such as `time_entries.project_id` until a deliberate migration removes them.
- Do not delete existing project/client data without an approved migration and export/safety plan.
- Reports should prioritize category and source/place breakdowns. Legacy project/client reports should be hidden or demoted unless explicitly requested.

## Standalone Product Copy

- Do not describe Dayframe through legacy third-party timer brands.
- Do not add legacy timer-brand imports, scripts, docs, env vars, tests, seeds, or hidden integration hooks.
- Dayframe should be described as a standalone time-intelligence app.
