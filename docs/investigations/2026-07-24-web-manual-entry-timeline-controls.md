# Web Manual Entry, Stable Timer Layout, And Timeline Controls

Date: 2026-07-24

Branch: `codex/web-manual-entry-timeline-controls`

Base: `b06284a08b54369fa9683d8d05f48222474d1b19` (merged PR #106)

Status: In progress

## Scope

This follow-up completes the manual-entry and Timeline work deferred from PR
#106 and applies KB's later timer-layout and compact-list feedback:

- keep Description, Category, elapsed time, and Play/Stop tracks fixed;
- move the idle Plus action to the far-right slot and replace it in-place with
  the running three-dot menu;
- make the Add time Tags surface visible without scrolling the dialog;
- add the timer's task suggestions to “What did you work on?” without starting
  a timer;
- keep native click-to-select date/time inputs while styling their controls for
  Dayframe in Light and Dark;
- replace conditional Timeline reset controls with one stable clickable period
  label and a shared calendar picker containing an immediate Today action;
- remove the redundant selected-period caption and Calendar instruction copy;
- keep Calendar zoom permanently visible instead of inside a disclosure;
- remove suggestion/tag row dividers, keep clear hover/focus/selected states,
  match the tag-search field height to the task field, and prevent the final
  suggestion from being clipped.

No API, database, mobile, persisted preference, timer mutation, Calendar resize,
or range-query contract changes are in scope.

## Evidence And Root-Cause Hypotheses

1. **Manual Tags clipping is owned by the dialog scroll container.**
   - Evidence: `ModalDialog` gives `.ui-dialog-content` vertical scrolling while
     `InlineTagInput` positions the picker below its field. The picker therefore
     extends the scrollable form instead of occupying a visible overlay layer
     inside the top-layer dialog.
   - Disproof condition: a current optimized build shows the picker above the
     form without moving the dialog scroll position.

2. **Timer layout shifts because idle Plus and running More do not share one
   grid slot.**
   - Evidence: Plus currently owns `grid-area: manual`; the running More button
     is conditionally appended inside the `action` flex group after Stop.
   - Disproof condition: measured idle/running track bounds are identical before
     changes.

3. **The bottom suggestion is visually cut because the panel has a fixed
   header, six 44 px rows, and a 272 px outer maximum.**
   - Evidence: the minimum content height exceeds the panel budget once border,
     header, and row geometry are included.
   - Disproof condition: all six rows fit or the list scrolls fully to the sixth
     row at every required viewport.

4. **Timeline control movement is caused by conditional reset rendering.**
   - Evidence: both the shell date row and route toolbar mount Today/This week
     only away from the current period, changing the navigation grid.
   - Disproof condition: arrow and period-label bounding boxes remain fixed
     before and after selecting today.

## Implementation Plan

1. Introduce one stable timer action slot after Play/Stop: idle renders Plus;
   running renders More and its anchored Delete menu.
2. Add controlled manual-entry Category and suggestion state. Reuse the shared
   suggestion renderer, but selecting a manual suggestion only fills
   Description, Category, and Tags.
3. Give manual-entry tags a dialog-aware upward overlay placement and bounded
   internal list scrolling without requiring form scrolling.
4. Compact suggestion and tag rows without dividers and align the tag search
   field to the shared 44 px control height.
5. Add a reusable web date-popover primitive for shell and Timeline period
   navigation, with Today above the native calendar input and immediate
   navigation.
6. Simplify Calendar header copy and render zoom permanently.
7. Add focused source/interaction contracts, then validate the optimized UI
   across desktop, phone, compact-height/200%-zoom-equivalent, Light, Dark,
   System, keyboard, and Reduced Motion.

## Motion Contract

- **Trigger:** Plus/More slot changes when timer state changes; description
  focus opens Suggestions; Tags opens its picker; clicking the period label
  opens the calendar popover; Calendar zoom updates from its permanent control.
- **Owner:** `PersistentTimerBar` owns the stable timer slot and manual-entry
  suggestion state; `InlineTagInput` owns Tags; the date-navigation owner owns
  its calendar popover; CSS owns the established 140 ms floating-surface
  presence transition.
- **Entrance/update/exit:** floating surfaces use the existing restrained
  opacity/four-pixel translation. Timer state swaps Plus and More inside one
  fixed outer box. Date changes keep arrows and trigger geometry fixed.
- **Surrounding layout:** all menus and pickers remain out of flow. Opening Tags
  does not change dialog scroll position. Suggestion filtering changes only the
  bounded internal list.
- **Interruption:** Escape/outside click closes the active surface and restores
  trigger focus. A second trigger deterministically closes/replaces the first.
  Rapid timer actions remain guarded by the existing runtime mutation gate.
- **Async outcome:** manual entry retains the existing busy geometry, validation
  errors, exact one-create mutation, success close, and failure preservation.
  Running Delete retains PR #106 optimistic removal and rollback. Date
  navigation uses the existing loading/error retention.
- **Accessibility:** Reduced Motion removes translation; keyboard focus,
  listbox/dialog semantics, 44 px targets, visible focus, live loading/error
  status, and labelled Today/date actions remain available.

## Success Criteria

- Idle and running timer controls have identical Description, Category, elapsed,
  Play/Stop, and final action-slot geometry.
- Add time Tags opens visibly above the form without moving the dialog scroll
  position; long tags scroll internally.
- Manual suggestions match timer filtering and keyboard/pointer selection;
  choosing one fills Description, Category, and Tags but does not start a timer.
- Date/time controls retain native click-to-select behaviour and match Dayframe
  typography, surfaces, border, focus, and radius in Light and Dark.
- Every suggestion is reachable; suggestion and tag rows have no divider lines;
  the tag search and task fields share a 44 px height.
- Timeline arrows and period trigger do not move between current and historical
  dates. The period trigger opens the shared calendar picker; Today acts
  immediately; no “Selected day/week” caption remains.
- Calendar instruction copy and collapsible View options are removed; zoom stays
  visible.
- Timer/manual-entry mutations, category/tag persistence, date range ownership,
  Calendar editing/resizing, keyboard paths, mobile overlay safety, and
  optimistic rollback remain intact.
- Focused tests plus full lint, typecheck, test, optimized build, brand check,
  `git diff --check`, and the browser matrix pass before the PR is declared
  ready.

## Rollback

Revert the focused PR. No migration, data rollback, mobile release, or hosted
configuration change is required.

## Validation

### Automated

- Focused manual-entry, popup, timer-shell, Timeline-toolbar, and Tags
  contracts: 30 passed.
- Full workspace lint: passed after removing two stale imports found by the
  first lint pass.
- Full workspace TypeScript checks: passed.
- Full workspace tests: 763 passed (245 mobile, 424 web, 94 shared).
- Optimized Next.js production build: passed.
- Brand asset contract and `git diff --check`: passed.

### Browser gate

The required in-app optimized-browser control surface was unavailable in this
session. The desktop/phone/compact-height matrix, Light/Dark/System comparison,
real Add time dialog scroll-position check, idle/running bounding-box
measurement, keyboard focus journey, Reduced Motion transition check, and
console/runtime-overlay review remain explicit gates. They are not inferred
from source contracts or the production build.
