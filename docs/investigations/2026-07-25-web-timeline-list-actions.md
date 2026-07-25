# Web Timeline List Columns And Actions

## Scope

This follow-up puts Timeline List columns in the approved order: Task / tags,
Category, Time, Duration, Actions. Every task row uses Play plus the same
three-dot floating action pattern as the timer bar. Single rows and occurrences
offer Edit/Delete; grouped rows offer Edit latest occurrence/Delete whole
group.

Whole-group deletion is atomic. The server locks and verifies every requested
entry inside the current user/workspace scope before deleting any of them. A
missing or out-of-scope entry rolls back the complete operation.

## Interaction and motion contract

- Trigger: the row's three-dot action opens its menu; selecting Delete opens
  the established destructive confirmation dialog.
- Owner: `EntryActionsMenu` owns menu presence/focus; the existing dialog owns
  confirmation. No second animation owner is introduced.
- Entrance/update/exit: the shared raised surface appears at the trigger;
  Edit transitions into the existing entry dialog and Delete into the existing
  confirmation dialog.
- Surrounding layout: the menu is portalled and fixed, so table rows and the
  horizontal-scroll container do not reflow or clip.
- Interruption: outside click and Escape close the current menu and return
  focus. Arrow keys cycle menu items. A second trigger owns its own menu.
- Async outcome: deletion waits in the confirmation dialog, refreshes after
  success, and keeps the dialog/error visible on failure. Group deletion is
  all-or-nothing.
- Accessibility: the trigger exposes menu state, menu items use semantic
  roles, focus enters the menu and returns to the trigger, and no meaning is
  motion-only.

## Validation

- Focused menu contract, batch route, transaction success/rollback, existing
  grouped Timeline and exact-entry coverage.
- Full lint, typechecks, tests, optimized build, brand and diff checks.
- Responsive Preview review in Light, Dark and System at desktop, compact and
  phone widths, including keyboard and Reduced Motion.
