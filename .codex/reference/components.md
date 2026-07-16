# Component Guidelines

Use this when working on frontend components.

## Component Structure

- Keep components focused on one responsibility.
- Prefer existing UI primitives and local component patterns.
- Keep data fetching, mutations, and presentation responsibilities clearly separated.
- Use accessible labels, semantic HTML, and keyboard-friendly controls.
- Keep Dayframe timer surfaces category/task-first. Avoid exposing projects/clients in primary timer UI.
- Keep the iOS dashboard focused on logo/header, active timer, start task, quick category actions, and Today summary.
- Move location and HealthKit permission controls to onboarding and Settings.

## State And Forms

- Prefer controlled form state only where it adds clarity.
- Validate at the boundary before persistence.
- Show loading, empty, success, and error states for user-facing actions where they help the user understand the state.
- For normal mobile timer mutations, loading UI should be invisible: start, stop, edit, delete, and suggestion-apply actions should update optimistically, then reconcile silently. Do not add spinners, progress bars, or layout-moving loading rows for these paths. Keep visible spinners for deliberate pull-to-refresh only.
- Task title is optional. Category is optional and should be editable while a timer is running.
- Running-timer suggestions are metadata completion for the existing active timer. Empty Play starts one bare timer then opens the running edit sheet; Play while a timer is already running should open the same suggestion/edit flow. Applying a suggestion must update that active timer, not create a second timer.
- Surface friendly, actionable permission messages; never display raw native exception strings to users.
- Treat route state as the source of truth for same-route mobile sub-settings. Do not mirror the active route section into local state or intercept native back gestures to repair duplicated navigation state.

## Review Checklist

- [ ] Component follows existing naming and folder conventions.
- [ ] Props and types are explicit.
- [ ] Error and loading states are handled.
- [ ] Mobile and desktop layouts are checked.
- [ ] No text overflow or overlapping UI.
- [ ] Timer mutations feel immediate and do not show non-refresh loading indicators.
- [ ] Dashboard changes preserve the core timer/start-task flow.
- [ ] Permission controls are not placed on the dashboard.
