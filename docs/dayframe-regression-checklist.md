# Dayframe Regression Checklist

Review this checklist before and after changes that touch Dayframe UI, timer behavior, data sync, or shared API contracts.

## Core Timer

- Web dashboard and timeline both show the "What are you working on?" timer strip.
- Users can type a long task description, optionally choose a category, and start a timer without a project.
- If a timer is already running, starting a new timer closes the previous active entry first.
- The active timer ticks every second on web and mobile.
- Stopping a timer on web or mobile stops the same active timer for the signed-in workspace.
- Edits typed into the active timer description/category are saved before the entry is stopped.
- Pinned and recent/frequent quick actions can start category-based tasks.
- Continue/start-again actions use a play affordance and start the task.

## Time Review

- Timeline includes Calendar, List, and Timesheet views with a clear selected state.
- Calendar blocks are positioned by time, use category colors, and can be clicked or double-clicked to edit.
- Calendar/time blocks can be resized from the top or bottom edge, snap to configured intervals, and save on release.
- Selected time blocks can be deleted from edit controls, context actions, or keyboard delete/backspace where supported.
- Calendar zoom controls change time granularity without breaking layout.
- List view groups entries by date, shows friendly source labels, and includes edit, start-again, and delete actions.
- Timesheet view groups work by category/activity, shows day totals and row totals, and remains readable.

## Data And Sync

- Web and mobile use authenticated workspace-scoped API calls.
- Mobile foreground start/stop actions attempt immediate API sync and only fall back to the offline queue for genuine network/offline failure.
- Offline queue sync preserves shortcut, NFC, geofence, Apple Health, and other background event paths.
- Bootstrap data remains backward compatible for web and mobile consumers.
- No duplicate React keys, hydration errors, or framework runtime overlays appear during normal use.

## Productivity Views

- Dashboard shows Today and This Week totals, review count, streak/summary, day timeline, review inbox, and recent activity.
- Reports show category, source and place breakdowns as the normal user-facing views.
- Categories, Places, Automation, Review Inbox, Settings, Search, Notifications, Profile, and Help remain navigable.
- Review Inbox actions remain normal sized, readable, and do not overlay item content.

## Visual System

- The Dayframe Soft Pop palette is used consistently for category, calendar, and report colors.
- Light and dark themes apply across backgrounds, text, borders, controls, icons, panels, and time blocks.
- Outer and inner panels, popovers, tables, color swatches, and floating dialogs have consistent rounded corners.
- Typography uses the current modern system font stack and stays compact in dense productivity surfaces.
- Controls look restrained and functional; decorative visual changes must not reduce timer or review usability.

## Validation Commands

- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run test`.
- Run `npm run build`.
- Use Browser/CDP to smoke-test dashboard, timeline, entries, reports, categories, places, automation, review, settings, search, notifications, profile, help, and theme switching.
- Use Computer/Xcode or Expo tooling to smoke-test mobile login, bootstrap load, start timer, stop timer, quick actions, manual task entry, queue sync, and web/mobile active-timer synchronization.
