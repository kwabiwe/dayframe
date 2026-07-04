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
- Show loading, empty, success, and error states for user-facing actions.
- Task title is optional. Category is optional and should be editable while a timer is running.
- Surface friendly, actionable permission messages; never display raw native exception strings to users.

## Review Checklist

- [ ] Component follows existing naming and folder conventions.
- [ ] Props and types are explicit.
- [ ] Error and loading states are handled.
- [ ] Mobile and desktop layouts are checked.
- [ ] No text overflow or overlapping UI.
- [ ] Dashboard changes preserve the core timer/start-task flow.
- [ ] Permission controls are not placed on the dashboard.
