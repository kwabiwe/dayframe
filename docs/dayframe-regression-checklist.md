# Dayframe Regression Checklist

Review this checklist before and after changes that touch Dayframe UI, timer behavior, data sync, or shared API contracts.

## Core Timer

- Web dashboard and timeline both show the "What are you working on?" timer strip.
- The persistent web timer has one shell-owned measured control track: Description is the flexible majority field, its tag action stays inside the compound control, Category and time are bounded, Plus and Play/Stop use the same circular footprint, and Quick actions remain beneath the row.
- Idle and running states keep the same timer-control geometry. At compact/phone/200%-zoom-equivalent widths, Description may take its own row while Category, Plus, time, and Play/Stop remain aligned, at least 44 px, text-safe, and free of horizontal overflow.
- Users can type a long task description, optionally choose a category, and start a timer without a project.
- If a timer is already running, starting a new timer closes the previous active entry first.
- The active timer ticks every second on web and mobile.
- Stopping a timer on web or mobile stops the same active timer for the signed-in workspace.
- Edits typed into the active timer description/category are saved before the entry is stopped.
- Pinned and recent/frequent quick actions can start category-based tasks.
- Play, Enter, task suggestions, Quick actions, Shift+Space, and Stop each produce one gated mutation; Dashboard/Timeline navigation preserves the same active entry and failed optimistic mutations return to the prior stable state.
- Continue/start-again actions use a play affordance and start the task.
- On mobile, empty Play starts immediately and opens the running Edit Timer sheet. A history replay action remains available while another timer runs and atomically switches to the selected task; suggestions in the active editor still enrich that same timer rather than starting a duplicate.
- Edit Timer delete confirmation appears without unmounting or collapsing the suggestions/edit content underneath.
- Mobile timer start, stop, edit, delete, and suggestion-apply actions do not show spinners, progress bars, or layout-moving loading indicators. They update optimistically and reconcile silently; visible spinners are reserved for deliberate pull-to-refresh.

## Time Review

- Timeline includes Calendar, List, and Timesheet views with a clear selected state.
- Timeline List columns remain Task / tags, Category, Time, Duration, Actions. Repeated entries group by normalized description and category within each day; count badges and total duration remain exact; group restart uses the representative occurrence; `entry=` expands and highlights only the requested occurrence. Single rows, groups, and expanded occurrences use the timer-style three-dot menu for Edit/Delete; deleting a group is one atomic, user/workspace-scoped operation.
- Timeline has one route-owned period toolbar. Canonical `date`, `scope`, and `view` URL parameters reconstruct the same selected state on refresh, direct load, and Back/Forward; invalid values fall back safely, and Timesheet always normalizes to Week.
- Previous/Next and Today/This week preserve view and scope, while Alt+Left/Right move one day in Day scope or one Monday-Sunday week in Week scope. View/scope-only changes reuse loaded data; an uncached period change performs one read, keeps the last valid view while pending, and retains it with calm feedback if the read fails.
- Calendar, List, Timesheet, Day total, and Week total use the same half-open overlap rule and one captured current time. Entries crossing midnight or a range edge appear in every intersected period with only the in-range duration; Timesheet splits them across the affected day columns.
- The generic shell date row is absent on Timeline but remains on Dashboard. The persistent timer remains shell-owned and unchanged; Calendar keeps only zoom under View options.
- The Timeline toolbar remains one coherent surface at 1440, 1280, 1024, 768 and 390 px plus a 200%-zoom equivalent, with no page overflow, 44 px controls, distinct focus/selected/disabled states, and usable System/Light/Dark themes.
- Web Calendar blocks degrade metadata by rendered-height priority: title, duration, category/place context, then tags. Minimum-height blocks keep a readable title where it fits and use visual lanes rather than covering nearby blocks.
- Live web Calendar blocks use one compact `6px` radius at every density. Category identity comes from a soft fill and subtle category-derived `1px` border; no block state restores a leading accent rail.
- Sequential blocks and neighbouring overlap lanes retain approximately `1px` of visible Calendar surface between cards. The inset is applied only to rendered geometry, while timestamps, durations, snapping and overlap classification keep their semantic inputs.
- Web Calendar blocks use a non-interactive positioned container with one primary action plus separate sibling restart and pointer-resize affordances. There is no interactive wrapper containing buttons; hover actions have equivalent keyboard and touch routes.
- Web Calendar selection is fill-led and adds no persistent outline. Pointer selection and pointer-opened Edit/Save do not leave a focus perimeter; keyboard focus retains one explicit `:focus-visible` ring.
- Pointer hover alone reveals the inline Play action: bottom-right on taller entries and vertically centred at the right edge on short entries. Selected, running, resizing and dense/no-text blocks hide it; keyboard and touch Start again remain available through the selected action surface. Double-click and keyboard Enter open Edit.
- A single click/tap or Space on a web Calendar block opens one portalled compact editor anchored to that exact rendered day fragment. Pointer opening does not move focus; Space and click-create focus Description; Enter and double click retain the advanced editor. Description, Category, Start, Finish, Save, Go back, Discard, header icon actions and Category options all use neutral grey keyboard focus while selected/accent state remains independent and invalid focus keeps its danger cue. Close/Escape and outside dismissal preserve dirty-draft confirmation; first Escape closes Category and a second reaches the editor. A clean outside click dismisses. Save right-aligns to the shared field inset; Save, Go back and Discard share exact 44px geometry and typography; Discard uses the same accent/on-accent treatment as Save while retaining alert-dialog semantics. Go back/Escape restore the exact edited field and draft, successful create returns focus to the Calendar grid, and Discard closes without saving.
- On web Calendar, one primary fine mouse-pointer sequence on eligible empty day-body space opens a real create-mode target and a non-interactive dashed provisional anchor. The clicked time floors to the preceding 15-minute slot and defaults to exactly 30 minutes, including 23:45 to 00:15. Touch/coarse pointers, right-click, drag, scroll, cancellation, headers, the time axis, scrollbars, blocks, actions, resize handles, temporary anchors and the semantic one-pixel block gap must not create. If an editor is open, its outside pointer is synchronously consumed: the first click dismisses or requests dirty discard only, and a later independent click creates.
- Calendar create mode starts blank and Uncategorized, shows Start, Finish and full `h:mm:ss` Duration, keeps Close and Save, and omits Play/Delete. Save sends exactly `tagNames: []`, the owned optional Description/Category, and exact Start/Finish through the existing manual-entry runtime; it creates one event-first entry, never starts/stops a running timer, rejects rapid duplicate Save, and consumes any simultaneous outside pointer before the busy guard. While Save is pending, outside clicks, anchor clicks, Escape, date/scope/view navigation, scroll-away and anchor loss cannot replace, dismiss or unmount the editor. Failure keeps the exact editor instance, draft, anchor and live error; success waits for canonical refresh. A completed-entry PATCH remains available during an unrelated timer mutation, while create/running-entry mutations keep the shared timer gate. The provisional block stays below canonical entries and does not participate in entries, totals or overlap lanes.
- The compact Calendar editor owns only Description, Category, Start and completed-entry Finish plus read-only Duration/Elapsed. Save emits only changed owned keys, clear-to-null remains explicit, untouched timestamps retain exact instants/seconds, edited timestamps normalize to `:00`, and cross-midnight edits retain each timestamp's original local date. Nonexistent spring-forward wall times are invalid; ambiguous fall-back baselines preserve their exact source instants and positive geometry, and only edited fields are recomputed. All manual-entry surfaces and the authoritative POST reject malformed, reversed and future Start/Finish values against one captured current time while preserving valid past and midnight-spanning entries. The API resolves missing Start/Finish values from the scoped stored entry before validating every partial-update combination. No-change Save closes without a request; failures keep the exact draft and inline error.
- Running-entry compact Save uses the shell timer mutation gate, updates Calendar/bootstrap state and the persistent timer draft together, preserves tags/place/legacy metadata, emits one partial PATCH and one forced bootstrap refresh, applies authoritative `updatedAt`, and restores the exact data/draft snapshots on failure. Completed Start again uses canonical persisted values and standalone inline failure appears in the established fixed accessible feedback surface, while Delete closes immediately into the shared five-second Timeline Undo owner.
- The portalled editor prefers an 8px below-anchor gap, flips above when needed, clamps to 12px viewport margins, becomes a 12px-gutter bounded phone card, and repositions on scroll/resize/zoom/anchor/panel changes—including a same-duration Start/Finish move. When its anchor leaves the Calendar viewport, a clean editor dismisses, a dirty editor opens one discard decision per excursion, and a busy editor remains owned until the mutation settles. Go back restores the exact prior focus/draft without an immediate repeated prompt. Normal actions, validation/server errors, overlap information and discard confirmation switch in one fixed-geometry footer region with priority `discard > error > overlap > normal`; long content is internally bounded and never moves the card. Entrance/exit use opacity plus at most 4px translation with one editor owner; feedback state uses opacity only and Reduce Motion makes it effectively instant.
- Web running blocks keep normal text opacity and use an explicit Running label plus a non-colour boundary treatment. Completed Calendar/List restart actions share the one shell timer runtime, copy only category/description/tags, gate duplicates, refuse to replace an active timer, and roll back on failure.
- Calendar/time blocks at least 48px high can be resized from safe top/bottom pointer handles, snap to configured intervals, and save on release. Smaller blocks use Edit instead of overlapping resize targets.
- Overlaps of at least one minute save from web/mobile Add and Edit, Calendar resize, every explicit Review confirmation path, and offline Review replay. Warnings explain the automatically detected overlap without disabling the primary action; shorter intersections are boundary noise.
- Boundary-touching entries have no overlap marker. Contained, partial, chained, cross-midnight, running, and dense overlaps show deterministic markers and Calendar geometry.
- Calendar taps open the visible intended block in contained and dense collisions; enlarged hidden hit targets do not cover neighbouring blocks.
- Timeline/History and Reports distinguish Total logged from Time covered. Category allocation and timesheets remain logged-time views, while daily/weekly goals advance on covered time.
- Automatic Health and location overlap decisions remain Review-first and explicitly say the user can still confirm.
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

## Mobile Sheets And Direct Manipulation

- Edit entry, Edit running timer, learned-place details, saved-place information, and location-suggestions information use the shared handle-owned sheet; no consumer restores a local swipe implementation.
- A sheet transition has one animation owner. Never combine a native React Native Modal slide with a custom translation entrance or exit.
- Never reset an animated sheet to its resting position before its visible dismissal completes. Invoke the parent close callback after the coordinated off-screen/opacity exit, then reset only while hidden or before the next hidden-to-visible presentation.
- A draggable sheet and its backdrop share one dismissal-progress owner. The backdrop lightens continuously during drag, restores with a rejected release, reaches zero with the off-screen sheet, and cannot remain mounted alone.
- Rejected releases settle from the exact release point with a critically damped, non-overshooting return. A committed dismissal cannot later settle to rest, and rapid swipe/backdrop/Done/native-close requests invoke the parent callback once.
- Direct manipulation stays on the UI thread and begins only on the dedicated 44-point handle. The form ScrollView, text inputs, category scroller, date picker, and delete confirmation keep their existing owners.
- Keyboard lift and swipe translation use separate nested layers. Keyboard frame changes are frozen during handle manipulation and committed exit so they cannot pull the sheet upward or change the dismissal decision.
- Reduce Motion removes sheet travel and uses only a brief coordinated opacity transition. VoiceOver retains the labelled handle plus the existing Done/close alternative; Dynamic Type may change the measured exit boundary without clipping or snapping.
- Direct-manipulation changes require physical-device, frame-by-frame validation. A simulator build and source-string tests do not validate animation ordering, finger tracking, frame pacing, rejected-release feel, or ghost-frame absence.
- Source-string ownership checks may supplement behavioral state-ordering tests, but never constitute the sole animation evidence.

## Tags

- Typing `#` at a valid task-description token boundary opens one anchored autocomplete without moving the input, caret, keyboard, or surrounding form.
- Empty and filtered queries show case-insensitive existing results; a non-exact safe query offers Create. Email addresses and URLs do not trigger it.
- Selecting an existing or Create result consumes the temporary token, retains input focus, adds the canonical tag to separate editor state, and does not persist anything until the enclosing edit is saved. Persisted tags never hydrate back into Description.
- Duplicate hashtags and repeated selection create one association. The web picker can deselect an association without rewriting Description; mobile can select an already-applied autocomplete result to remove it. Cancelling a draft does not create a tag.
- Mobile shows a compact borderless `Add a tag` shortcut below Description. It inserts `#` at the caret with a valid boundary, focuses Description, and preserves manual `#` entry.
- Web shows a tag-icon action beside Description. It opens an anchored search/select/create picker at desktop widths and a viewport-safe fixed panel at phone widths; manual `#` entry remains available.
- In the persistent web timer and Edit time block, each selected tag uses normal-weight plain text with no default fill and a thin `X` remove affordance. Its 44px interaction target contains a separate 24px-high visual wrapper; hover/focus applies darker accent text, a subtle accent fill and a `6px` rectangle only to that wrapper, without changing field height. Clicking either the tag text or `X` removes it, the hidden measure mirrors the wrapper, and `+N` overflow remains neutral.
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
- Apple Health sleep stages group per normalized source with the shared 90-minute maximum waking gap. A gap exactly at the boundary remains one session; a gap one millisecond beyond it remains legitimate split sleep.
- Same-source grouped sleep revisions with at least 80% overlap of the shorter interval update one untouched Health-derived entry in place. Incomplete-then-extended, extended-then-incomplete, identical retries, and small boundary adjustments preserve one stable entry and one logical total.
- Manual Sleep entries, explicitly edited imported entries, cross-source records, weak overlaps, and multiple historical matches remain protected or ambiguous and do not reconcile automatically.
- Offline Review decisions use their dedicated account-scoped SQLite owner, not
  the activity-event queue or location-evidence database. With Review data
  already downloaded, Confirm, Dismiss, and Edit-and-confirm must commit the
  request locally, keep the card visibly disabled as `Waiting to sync`, survive
  navigation, background/foreground, force-quit, and restart, then synchronise
  exactly once when Dayframe is active and authenticated again. The card exits
  only after server acknowledgement.
- Cached Review data must never cross accounts or reinsert a pending local
  mutation as actionable. Session expiry preserves the same account's mutations as
  sign-in-required; confirmed logout warns with the exact unsynchronised count
  and clears only that active account's Review cache/outbox.
- Review retry coverage includes network/DNS failure, timeout, 408, 429, 5xx,
  temporary lock contention, legacy overlap responses, and a lost success
  response. Permanent category, technical duplicate, supersession, and
  cross-device resolution conflicts stop retrying, surface safe Settings
  diagnostics, and restore a card only when canonical server state remains open.
- Run `npm run validate:review-sync-sqlite` and
  `DATABASE_URL=..._test npm run validate:review-mutation-db` for Review outbox
  changes. The Postgres URL must name a disposable local `_test` database.
- On a physical iPhone, repeat offline Confirm, Dismiss, and Edit-and-confirm
  across System/Light/Dark, Reduce Motion, large Dynamic Type, VoiceOver,
  foreground/background, force-quit/reopen, session expiry, same-account login,
  web conflicts, category removal, overlap, reconnect, and explicit logout.
  Record each result; tests and screenshots are not device durability evidence.
- Save/change place, split, merge, record-once, and detailed Location Evidence
  remain connectivity-dependent. iOS does not guarantee a drain while
  force-quit; the contract is durable now and automatic retry when active again.
- Bootstrap data remains backward compatible for web and mobile consumers.
- No duplicate React keys, hydration errors, or framework runtime overlays appear during normal use.
- In Location V2 `v2_enabled`, only completed strong stays at logging-enabled saved or accepted-and-linked learned places create automatic confirmed entries. The entry inherits the saved place/default category and description, remains editable/deletable, and retains its source event.
- Location V2 commutes, unknown/ambiguous places, lower-confidence stays, uncertain gaps, missing approved-place links, and overlaps with confirmed/accepted time remain in Review. Retrying the same batch creates neither a duplicate entry nor a Review item for an already automatic entry.
- Rehydrating an account with commute learning already enabled restarts Expo location updates and native iOS visit/significant-change monitoring without requiring the Settings toggle to be cycled.

## Authentication And Sessions

- Authentication, logout, and every other state-changing action must never be exposed as a prefetchable GET link. Logout requires one explicit POST; `GET /logout` has no session or cookie side effect.
- Profile, Settings, and troubleshooting use the shared sign-out button/form. Rendering, opening, scrolling to, or discovering those surfaces never revokes a session.
- Explicit logout prevents duplicate submission, shows a pending state, revokes only the current session idempotently, clears `dayframe_session`, and returns a host-preserving 303 to `/login?signedOut=1`.
- Missing, invalid, expired, revoked, and valid sessions remain typed and distinguishable without logging tokens, hashes, cookies, email, user/workspace IDs, or provider access tokens.
- Only a structured session-related `401` starts one login replacement. Missing scope is `403`; an unstructured credential `401`, `403`, transient network failure, SQL/configuration error, or `500` does not masquerade as logout.
- The app-session TTL is finite, integer, bounded, and shared by the cookie and database expiry. Changing absolute expiry or introducing sliding renewal requires a separate security design.
- Login uses one controlled `onSubmit` path for Enter and click, rejects duplicate submission, retains useful input on failure, stays in a branded Opening state after success, and replaces `/login` in history.
- Active timer state is checked through the bounded `/api/timer-state` fingerprint every three seconds only while web is visible or mobile is foregrounded. A changed ID or `updatedAt` triggers one canonical bootstrap through the existing mutation/race gate; failures back off to 6, 12, then 30 seconds; broader bootstrap reconciliation remains at five minutes. The elapsed timer still ticks locally every second, hidden/background clients stop polling, and no heavyweight authenticated request storm returns.
- Hosted auth changes require an optimized production-build browser pass and a provider-auth Vercel Preview pass. Preserve Network logs, test two tabs/expiry/revocation/slow network/Back-Forward, inspect safe server logs, and verify authentication does not move between host-scoped aliases.
- Vercel Preview and mobile preview builds use `dayframe-staging.vercel.app` plus the separate staging Supabase project. Confirm the visible `STAGING` badge, staging account/workspace, staging schema version and baked mobile API base before mutating data. Production must remain on `dayframe-web.vercel.app` with no staging badge.

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
- Every web keyboard focus indicator uses the shared neutral grey `focus`/`control-border` treatment, including fields, standalone buttons, links, Calendar blocks, icon actions, options, menus and compound controls. Blue `info`/accent focus is prohibited; selected/active accent remains independent.
- Compound web fields with nested actions have one wrapper focus owner via `focus-within`. The nested text input has no competing border/outline, while the nested action remains independently keyboard-visible.
- Standalone buttons, links, icon actions and disclosures retain one visible external neutral grey focus ring. Focus remains visually distinct from selected, invalid and disabled states; an invalid focused field preserves a danger cue and error copy alongside neutral focus.
- Shared web control height, icon target, radius, inline padding, field gap, layout gap, panel/dialog padding and table-cell padding come from the existing web foundation tokens rather than route-local near-duplicates.
- Web shortcut copy is platform-neutral (`Ctrl/⌘ K`) and both Control-K and Command-K open Search only when the user is not typing in an input, textarea, select or editable surface.
- A shared web visual-foundation change receives a route-by-route desktop and phone audit across both themes, including text containment, padding alignment, focus clipping, horizontal overflow and runtime overlays.
- Source/contract tests guard ownership and tokens but do not replace actual-browser alignment, padding, keyboard and responsive validation.
- Stable palette keys, deterministic fallback order and legacy HEX compatibility are preserved while all 30 category shade choices remain available. Web and iOS pickers use the same five-column hue-family order, light-to-dark within each family, without changing stored category assignments.
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
