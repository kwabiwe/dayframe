# Dayframe Regression Checklist

Review this checklist before and after changes that touch Dayframe UI, timer behavior, data sync, mobile permissions, hosted deployment, or shared API contracts.

## P0 Timer And Sync

- Web can start a timer with task title/description and optional category.
- Web can stop the authenticated workspace's active timer.
- Mobile can start a timer from the Start task card.
- Mobile can stop the active timer.
- Mobile category chips start immediately when tapped.
- Mobile shows a queued/starting state until the server confirms a start; it does not show an unconfirmed start as a fully active timer.
- Active timer state syncs web to mobile and mobile to web within the expected foreground sync window.
- Starting a new timer closes or reconciles the previous active entry according to the service rules.
- Stopping a timer creates a completed entry that persists after bootstrap refresh.
- Active timer title/description and category edits while running are saved.
- Offline queued start/stop/event sync preserves order and dedupes by `clientEventId`.

## Category-First Product Model

- Starting a timer never requires a client or project.
- The primary user-facing fields are task title/description, category, timer, and review/edit state.
- Category is optional at start and can be added or changed while running.
- Category create, edit, archive, reorder, pin, color, and use flows remain reachable.
- Pinned and most-used categories appear as compact quick actions.
- Existing compatibility data does not reappear as normal user-facing client/project UX.
- Reports and review surfaces prioritize category, source, place, and time breakdowns.

## Mobile Dashboard

- Dashboard order is header, active timer, start task, compact category chips, and Today chart/summary.
- Settings, permissions, logout, and detailed sync management are not on the dashboard.
- Category chips are compact, pill-shaped, color-coded, tappable, and do not overflow phone width.
- Today chart/summary is visible before settings/configuration content.
- Empty Today chart uses a clean zero-state rather than a misleading 100% category slice.
- Reviewable items are represented in Today summary and are tappable for edit/review.
- No buttons, text fields, chips, or settings controls are clipped or off-screen in simulator.

## Settings, Permissions, And Theme

- Settings opens as a separate pushed screen from the top-right settings/menu icon.
- Profile/account controls and logout live under profile/settings.
- Location permission setup lives in onboarding/settings, not dashboard.
- Apple Health permission setup lives in onboarding/settings, not dashboard.
- User-facing copy says "Health data" or "Apple Health", not raw native framework names.
- Permission errors are friendly and actionable; raw native exception strings are not shown.
- Light, dark, and system theme changes apply immediately across the mobile app.
- Settings sections fit within phone width with visible close/back navigation and 44px minimum touch targets.

## Time Review And Editing

- Timeline includes Calendar, List, and Timesheet views with a clear selected state where available.
- Calendar blocks are positioned by time, use category colors when available, and can be clicked or double-clicked to edit.
- Calendar/time blocks can be resized from the top or bottom edge, snap to configured intervals, and save on release.
- Selected time blocks can be deleted from edit controls, context actions, or keyboard delete/backspace where supported.
- Calendar zoom controls change time granularity without breaking layout.
- List view groups entries by date, shows friendly source labels, and includes edit, start-again, and delete actions.
- Timesheet view groups work by category/activity, shows day totals and row totals, and remains readable.
- Review Inbox actions remain readable, normal sized, and do not overlay item content.

## Hosted, Health, And Location

- Web and mobile use authenticated workspace-scoped API calls.
- Mobile production/native hosted builds never fall back to localhost.
- `EXPO_PUBLIC_DAYFRAME_API_BASE` points mobile builds to the hosted Vercel API.
- Mobile does not write directly to Supabase tables.
- Supabase setup has run `packages/db/migrations/001_init.sql`, then all files in `supabase/migrations/` in timestamp order.
- `DATABASE_URL` examples do not require `?sslmode=require`; use the Supabase pooler string that works in Vercel.
- Offline queue sync preserves shortcut, NFC, geofence, Apple Health, and other background event paths.
- Apple Health workout payloads strip route/location-like metadata before upload.
- No duplicate React keys, hydration errors, or framework runtime overlays appear during normal use.

## Visual System

- The Dayframe palette is used consistently for category, tag, calendar, report, chart, and chip colors.
- Light and dark themes apply across backgrounds, text, borders, controls, icons, panels, charts, and time blocks.
- Outer and inner panels, popovers, tables, color swatches, and dialogs have consistent rounded corners.
- Typography uses the current modern system font stack and stays compact in dense productivity surfaces.
- Controls look restrained and functional; decorative visual changes must not reduce timer or review usability.
- Icon buttons use consistent accessible labels and do not replace obvious task flow copy where text is clearer.

## Validation Commands

- Run the narrowest relevant lint/type/test checks for the touched code.
- For broad changes, run `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`.
- Use Browser/CDP or equivalent browser automation to smoke-test web dashboard, timer start/stop, review/edit, reports, categories, settings, and theme switching.
- Use computer-use, Xcode simulator, or Expo tooling to manually smoke-test mobile login, bootstrap load, start timer, stop timer, category chip start, edit active timer, queue sync, web/mobile active-timer synchronization, theme switching, category color/pin state, Settings layout, and no off-screen buttons.
- Do not claim UI behavior is validated from lint/typecheck alone.
