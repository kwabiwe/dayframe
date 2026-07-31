# Web Timeline Fixed Workspace

Date: 2026-07-31

Branch: `codex/web-timeline-fixed-workspace`

Status: Implemented and validated

## Scope

PR 1 makes the web Timeline a fixed application workspace. It keeps the shell-owned persistent timer, attaches the URL-owned Timeline toolbar directly beneath the timer and Quick actions, and gives Calendar, List, and Timesheet independent internal scroll owners. It also restores the small Timeline view/scope preference, shortens period labels, removes selected Timeline-only `covered` copy, makes Quick actions a one-line rail, and removes the timer description field's resting outline.

It does not change mobile, the API/data model, Reports calculations, List grouping identity, or delete/Undo behaviour.

## Root Cause

The existing Timeline toolbar and each selected view were in normal page flow. Calendar intercepted a vertical wheel and forwarded it to `window`, while List and Timesheet had only local horizontal overflow. This made document scrolling the de facto vertical scroll owner and meant fixed headings and per-view scroll restoration were impossible.

Missing Timeline URL parameters also always normalized to Calendar/Week. The URL model intentionally had no persistence owner after earlier consolidation, so a plain Timeline visit could not restore the user's last selected view or non-Timesheet Day/Week preference.

## Motion Contract

- Trigger: entering Timeline, changing view, scope, or period; scrolling a view; restoring a view position; responsive reflow.
- Owner: `AppShell` owns the fixed timer/timecard top section. `TimeReviewViews` owns the route toolbar, preference write, and scroll-memory refs. Calendar, List, and Timesheet each own one native DOM scroller.
- Entrance/update/exit: no decorative route entrance. View and period content replaces in place; stored scroll offsets are assigned synchronously in a layout effect before paint. Fixed chrome retains its geometry.
- Surrounding layout: the route-scoped flex frame reserves space for the timecard and fixed view title. Only the active view's body scrolls or reflows.
- Interruption: the existing date-loading/navigation gate remains latest-state-wins. Repeated view or scope selections are no-ops and do not create an extra history entry.
- Async outcome: a failed date load keeps the prior URL, data, and active internal workspace intact. Scroll memory is never cleared by a failed request.
- Accessibility: native scrolling, focus, keyboard controls, and visible focus rings remain available. Restorations do not animate; Reduce Motion therefore changes no essential Timeline behaviour.

## Preference Contract

The non-sensitive `dayframe_timeline_preference` cookie stores `lastView:preferredScope`, for example `list:day`. It has `Path=/`, `SameSite=Lax`, and a one-year `Max-Age`.

- A plain route is canonicalized server-side with today's local date and the stored preference.
- Valid explicit URL state wins, then becomes the remembered preference after hydration.
- The selected date is never stored.
- Timesheet is Week-only and updates `lastView` without overwriting `preferredScope`.
- Invalid cookie or explicit values normalize safely and are never written back as invalid values.

## Validation Record

### Focused automated checks

- `npm run typecheck -w @dayframe/web` — passed.
- Focused Timeline contracts and state tests — passed: 5 files, 46 tests.
- `npm run build -w @dayframe/web` — passed.
- `npm run lint` — passed with no warnings after the final preference-effect dependency adjustment.
- `npm run typecheck` — passed for mobile, web, and shared workspaces.
- `npm run test` — passed: 138 files and 953 tests across mobile, web, and shared workspaces.
- `npm run build` — passed.
- `npm run check:brand-assets` — passed.
- `git diff --check` — passed.

### Browser checks

- Used the production build locally with dev authentication and local Postgres.
- Calendar, List, and Timesheet retained the page at `scrollY: 0` while their own bodies scrolled. List restored its recorded scroll position after switching away and back.
- Calendar keeps its day header and left time axis fixed in the correct axes; List has a sticky table header and date group label; Timesheet freezes the Activity column while horizontally scrolling its own viewport.
- Direct URL state (`date`, `scope`, `view`) was applied first. A plain `/timeline` visit restored the saved view/scope but reset the date to today. The Calendar Day → Timesheet → List path restored Day; a later plain route restored Timesheet/Week without losing the saved Day preference.
- Confirmed the Days/Weeks toolbar no longer shows Timeline `covered` copy, while Timesheet daily cells still do.
- Checked Dark, Light, and System appearance paths. The light workspace had no document overflow; System was restored after the check.
- At 1440×900, 1280×720, 1024×768, 768×844, 720×844, and 390×844, document `scrollWidth` equalled `clientWidth`, `scrollHeight` equalled `clientHeight`, and `scrollY` stayed 0. Visible timer, quick-action, toolbar, and zoom controls at phone width met the 44px minimum; compact elements discovered in the closed, inert time editor were excluded from the visible-control check.
- Browser console check: no warnings or errors.

The in-app browser does not expose a recording capability, so no short interaction recording artifact was produced.
