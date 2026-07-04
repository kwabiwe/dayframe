# Component Guidelines

Use this when working on frontend components.

## Component Structure

- Keep components focused on one responsibility.
- Prefer existing UI primitives and local component patterns.
- Keep data fetching, mutations, and presentation responsibilities clearly separated.
- Use accessible labels, semantic HTML, and keyboard-friendly controls.
- Keep Dayframe timer surfaces category/task-first. Avoid exposing clients/projects in primary timer UI.
- Keep the iOS dashboard focused on logo/header, active timer, start task, quick category actions, and Today summary.
- Move location and Apple Health permission controls to onboarding and Settings.
- Do not put cards inside cards. Use framed cards only for actual repeated items, modals, and bounded tools.

## Expected Mobile Components

- `AppHeader`: logo/brand on the left or center, compact settings/menu icon on the top right, no primary logout/sync buttons.
- `TimerCard`: active timer or no-timer state, confirmed active state only after server confirmation, queued/starting state when mobile sync is pending.
- `StartTaskCard`: task title/description input, optional category affordance, prominent start action, safe keyboard behavior.
- `CategoryPill`: compact pill-shaped color-coded chip; tap starts immediately on dashboard, with accessible label and fixed height.
- `TodaySummaryCard`: chart plus total time, category/source breakdown, reviewable item count, clean zero-state, tappable review path.
- `SettingsScreen`: pushed route/screen for account, theme, category management, sync, permissions, and logout.
- `SettingsSection`: separated section with concise heading, internal scrolling only when needed, no horizontal overflow.
- `PermissionRow`: friendly state, short explanation, one clear action, copy says "Apple Health" or "Health data" for health permissions.

## State And Forms

- Prefer controlled form state only where it adds clarity.
- Validate at the boundary before persistence.
- Show loading, empty, success, and error states for user-facing actions.
- Task title is optional. Category is optional and should be editable while a timer is running.
- Surface friendly, actionable permission messages; never display raw native exception strings to users.
- Light/dark/system theme controls must update app state immediately, not only after reload.
- Category edit flows must persist color and pin state and reflect them in dashboard chips.

## Review Checklist

- [ ] Component follows existing naming and folder conventions.
- [ ] Props and types are explicit.
- [ ] Error and loading states are handled.
- [ ] Mobile and desktop layouts are checked.
- [ ] No text overflow or overlapping UI.
- [ ] Dashboard changes preserve the core timer/start-task flow.
- [ ] Permission controls are not placed on the dashboard.
- [ ] Category chips are compact, color-coded, and dashboard-safe.
- [ ] Today summary remains above Settings/configuration content.
- [ ] Settings screen has no clipped or off-screen buttons at phone widths.
