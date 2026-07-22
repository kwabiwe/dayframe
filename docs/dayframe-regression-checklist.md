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
- On mobile, empty Play starts immediately and opens the running Edit Timer sheet. A history replay action remains available while another timer runs and atomically switches to the selected task; suggestions in the active editor still enrich that same timer rather than starting a duplicate.
- Edit Timer delete confirmation appears without unmounting or collapsing the suggestions/edit content underneath.
- Mobile timer start, stop, edit, delete, and suggestion-apply actions do not show spinners, progress bars, or layout-moving loading indicators. They update optimistically and reconcile silently; visible spinners are reserved for deliberate pull-to-refresh.

## Time Review

- Timeline includes Calendar, List, and Timesheet views with a clear selected state.
- Calendar blocks are positioned by time, use category colors, and can be clicked or double-clicked to edit.
- Calendar/time blocks can be resized from the top or bottom edge, snap to configured intervals, and save on release.
- Selected time blocks can be deleted from edit controls, context actions, or keyboard delete/backspace where supported.
- Calendar zoom controls change time granularity without breaking layout.
- Mobile Calendar uses one native scroll/zoom owner for the timeline. Pinch remains continuous under the fingers, keeps the gesture midpoint anchored, and has no release-time snap, rubber-band handoff, blank frame, or obvious dropped-frame feel.
- Hour labels, grid lines, entry blocks, cross-midnight continuation treatment, and the current-time line stay geometrically aligned throughout zoom.
- Mobile Calendar preserves fixed 24-hour rendering, vertical scrolling, day/week navigation, selected-day state, and the user's useful zoom/scroll position across ordinary data refreshes.
- A retained native Calendar accepts a later serialized model after its initial empty render: selected day/week, `nowMs`, total, and active/completed entries all repaint without recreating the hosting controller or resetting zoom/scroll state.
- Tapping an active entry, completed entry, or review candidate from the native Calendar opens the same existing React Native timer editor, entry editor, or Review flow. Native rendering must not create or mutate a second timer/data store.
- Calendar edit sheets stay visible when the iOS keyboard opens, with the focused field scrolled above the keyboard/suggestion bar.
- List view groups entries by date, shows friendly source labels, and includes edit, start-again, and delete actions.
- Today history left-swipe uses a UI-thread gesture whose danger action and icon travel continuously with the row edge; it must not pop into place or compete with vertical scrolling. A collapsed aggregate group can be deleted as one explicit swipe action covering all underlying entries. The duration keeps the normal 14-point trailing inset as a surface-coloured gap before the revealed danger action.
- Today history deletion begins immediately without a confirmation surface and shows the five-second inverse-colour Undo bean before persistence is committed. Row/group removal, surrounding list reflow, Undo entrance/exit, expiry, exact restoration, and persistence-failure rollback transition continuously rather than popping. A rapid second delete deterministically commits the older pending deletion, starts a fresh five-second window, and cannot be dismissed or restored by an older timer/callback. Blank uncategorized entries remain individual rows with direct edit/delete access instead of collapsing into a non-deletable aggregate.
- Timesheet view groups work by category/activity, shows day totals and row totals, and remains readable.

## Tags

- Typing `#` at a valid task-description token boundary opens one anchored autocomplete without moving the input, caret, keyboard, or surrounding form.
- Empty and filtered queries show case-insensitive existing results; a non-exact safe query offers Create. Email addresses and URLs do not trigger it.
- Selecting an existing or Create result consumes the temporary token, retains input focus, adds the canonical tag to separate editor state, and does not persist anything until the enclosing edit is saved. Persisted tags never hydrate back into Description.
- Duplicate hashtags and repeated selection create one association. The web picker can deselect an association without rewriting Description; mobile can select an already-applied autocomplete result to remove it. Cancelling a draft does not create a tag.
- Mobile shows a compact borderless `Add a tag` shortcut below Description. It inserts `#` at the caret with a valid boundary, focuses Description, and preserves manual `#` entry.
- Web shows a tag-icon action beside Description. It opens an anchored search/select/create picker at desktop widths and a viewport-safe fixed panel at phone widths; manual `#` entry remains available.
- Tag identity is case-insensitive within a workspace. Rename updates in-use canonical tokens; delete detaches associations without deleting time entries; cross-workspace reads and writes are rejected.
- Today, entry/task lists, editors, and web/native Calendar blocks render tags as a small solid rounded tag icon with a punched hole plus plain secondary middle-dot-separated text, never as pills or category-like colour states.
- In the mobile editor, each displayed tag is a remove action. Removal changes draft state only; the checkmark save persists it, while closing or dismissing the editor restores the entry's persisted tags.
- The mobile autocomplete uses a visibly distinct raised surface in both themes: lighter than the editor in dark mode and darker than the field in light mode.
- Mobile tag edits stay optimistic with no spinner/progress UI, restore the exact prior snapshot on failure, and retain desired tag names in offline queued timer starts for event-first reconciliation.
- The native Calendar receives serialized tag text only; React remains the owner of authentication, bootstrap data, mutations, routing, sheets, and offline state.
- Autocomplete rows meet 44pt/px targets, VoiceOver/ARIA distinguishes existing and Create actions, and Reduce Motion removes spatial panel travel.

## Data And Sync

- Web and mobile use authenticated workspace-scoped API calls.
- Mobile foreground start/stop actions attempt immediate API sync and only fall back to the offline queue for genuine network/offline failure.
- Offline queue sync preserves shortcut, NFC, geofence, Apple Health, and other background event paths, respects retry backoff for automatic retries, and exposes retry/export diagnostics in Settings.
- Bootstrap data remains backward compatible for web and mobile consumers.
- No duplicate React keys, hydration errors, or framework runtime overlays appear during normal use.
- In Location V2 `v2_enabled`, only completed strong stays at logging-enabled saved or accepted-and-linked learned places create automatic confirmed entries. The entry inherits the saved place/default category and description, remains editable/deletable, and retains its source event.
- Location V2 commutes, unknown/ambiguous places, lower-confidence stays, uncertain gaps, missing approved-place links, and overlaps with confirmed/accepted time remain in Review. Retrying the same batch creates neither a duplicate entry nor a Review item for an already automatic entry.

## Productivity Views

- Dashboard shows Today and This Week totals, review count, streak/summary, day timeline, review inbox, and recent activity.
- Reports show category, source and place breakdowns as the normal user-facing views.
- Reports use one explicit Day, Week, Month or Custom date range for every total, chart and breakdown; historical navigation never leaves a chart anchored to the real current week.
- Entries crossing a report boundary contribute only the time inside the selected range. Daily and weekly goal progress uses persisted user goals and appears only for matching Day/Week ranges.
- Categories, Tags, Reports, Places, Review Inbox, Settings, Search, Profile, workspace switching, Appearance, and Help remain navigable on desktop and mobile web.
- Dashboard and Timeline share one shell-owned timer. Timer state, details and start-time edits survive navigation in both directions; one user action emits one mutation and failed optimistic mutations roll back.
- Legacy `/entries` redirects to Timeline List and `/automation` redirects to Places. The normal Timeline List omits Source, Confidence and Review diagnostics.
- On iOS Categories, focusing `New category` reveals one in-place creation editor above the keyboard with its name field, all 12 colour choices, pin state, Cancel and Create controls visible; creation uses the selected colour, while Cancel and failure preserve the documented state behavior.
- Review Inbox actions remain normal sized, readable, and do not overlay item content.

## Visual System

- Midnight Core is used consistently: midnight-navy dark canvas, designed neutral light canvas, layered surfaces and coral primary/active states.
- Stable palette keys and legacy HEX compatibility are preserved while all 12 Midnight Core display colours remain perceptually distinct and are used consistently for category, calendar and report data.
- Light and dark themes apply across backgrounds, text, borders, controls, icons, panels, and time blocks.
- Outer and inner panels, popovers, tables, color swatches, and floating dialogs have consistent rounded corners.
- Typography uses the current modern system font stack and stays compact in dense productivity surfaces.
- Controls look restrained and functional; decorative visual changes must not reduce timer or review usability.
- iOS surfaces use the current fill-led hierarchy: canvas/surface/inset contrast, compact divider-based lists, circular icon-only actions, and pill text actions instead of outline-heavy rounded-rectangle clutter.
- The supplied colour symbol is unchanged; dark surfaces use the light wordmark artwork and light surfaces use the dark wordmark artwork.
- Symbol and wordmark remain separate reusable elements with one accessible brand name or fully decorative semantics.
- Primary application branding no longer uses the legacy PNG banner, CSS filters or a visible white image rectangle.
- The first mobile tab visibly reads “Today”, uses a day-overview icon and retains the internal timer behaviour.
- Favicon and app icon use the symbol alone; the iOS icon is opaque and legible at home-screen size.
- Charts use shared palette/track tokens, exact textual values and non-colour cues without changing calculations.
- In System, Light and Dark, push, pop and interactive swipe-back transitions between Settings, Review and Places keep the whole viewport on the resolved theme canvas with no white corner leaks, rounded-card vignette or overlapping scene chrome.
- Reduce Motion removes route and layout motion without hiding navigation state changes or loading feedback.
- Native SwiftUI surfaces use the same semantic Midnight Core roles, system typography, Dynamic Type, VoiceOver labels, Reduce Motion, and Reduce Transparency behaviour as the surrounding React Native app.
- Every feature that introduces movement follows `.codex/reference/motion.md`: it has one animation owner and consistent entrance, update/reflow, exit, interruption, timeout/Undo/failure, and Reduce Motion behaviour where those states apply.

## Validation Commands

- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run test`.
- Run `npm run build`.
- Run `npm run check:brand-assets`.
- Run `git diff --check`.
- Use Browser/CDP to smoke-test dashboard, timeline, entries, reports, categories, places, automation, review, settings, search, notifications, profile, help, and theme switching.
- Use Computer/Xcode or Expo tooling to smoke-test mobile login, bootstrap load, start timer, stop timer, quick actions, manual task entry, queue sync, and web/mobile active-timer synchronization.
- In System, Light and Dark, inspect header/auth branding, theme transitions, focus/selected/disabled/destructive states, chart labels, responsive overlays, Dynamic Type, VoiceOver, Reduce Motion and Reduce Transparency.

## Release Checks

For docs-only PRs, `git diff --check` plus GitHub/Vercel check observation is enough unless the docs change build or release configuration.

For implementation PRs that affect shipped mobile/API behavior, do not ask KB to test until:

- PR is merged into `main` and local `main` is synced.
- Tracker reflects merged PR number/status.
- `npm run testflight:preflight` passes.
- iOS build number is temporarily incremented for archive/upload.
- Full Xcode archive, export, and App Store Connect upload complete.
- App Store Connect processing is `VALID`.
- Export compliance is set.
- TestFlight notes are set.
- Internal group `Internal Health Debug` is assigned or verified.
- Build beta state is `IN_BETA_TESTING`.
- Final handoff includes exact version/build and delivery UUID.
