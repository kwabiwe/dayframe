# Web Popup Surface And Timer Fixes

Date: 2026-07-24

Branch: `codex/web-popup-surface-timer-fixes`

Base: `origin/main` at `5dee5df`

Status: Implemented; PR validation in progress

PR: [#106](https://github.com/kwabiwe/dayframe/pull/106)

## Scope

This focused PR owns the shared floating-surface treatment and the persistent
timer's Suggestions, Tags, Categories, and running start-date/time editor.
Manual-entry suggestions/date styling and Timeline date navigation are reserved
for the follow-up PR.

No API, database, mobile, timer-runtime, entry-persistence, or authentication
contract changes are included.

## Reported symptoms

- Suggestions, Tags, and Categories extend below the persistent timer but are
  clipped at the timer panel boundary.
- The light floating surfaces do not separate clearly from the timer/page
  behind them.
- Tags can appear empty or unusable because the list does not receive a bounded
  scroll track.
- Tags and Categories consume more vertical space than necessary.
- The tag action appears as an oversized grey-filled circle.
- The running start-date/time editor opens as a detached modal with a page
  scrim, lacks internal padding, and does not resemble the timer's anchored
  menus.

## Evidence and hypotheses

1. The persistent timer has the shared `.swiss-panel` class. The earlier
   `.swiss-panel` rule applies `overflow: hidden`, while the later fill-led rule
   does not reset it. This clips every absolutely positioned timer child even
   when its own `z-index` is correct.
2. Floating surfaces use several independent radius, shadow, border, maximum
   height, and motion definitions. In light mode `surfaceRaised` and the timer's
   `surface` are both white, so the missing shared boundary is especially
   visible.
3. The tag picker is a CSS grid without an explicit `minmax(0, 1fr)` list row.
   Its list therefore does not reliably become the internal scroll owner when
   header/search/footer content competes for the panel's maximum height.
4. `PopoverPanel` is a `ModalDialog`, so the running-time editor necessarily
   enters the top layer with a scrim and viewport-relative margins. That
   primitive is correct for profile/dialog use but not for a timer-anchored
   editor.

## Implementation plan

1. Add one shared web floating-surface class using semantic colour, border,
   radius, shadow, viewport, scrolling, and motion rules.
2. Allow only the persistent timer panel to overflow visibly; retain clipping
   for unrelated panels.
3. Apply the shared surface to task suggestions, tag autocomplete/picker,
   Category menu, and a new non-modal anchored start editor.
4. Give Tags and Categories bounded internal scrolling while preserving 44 px
   interaction targets.
5. Keep the tag target accessible but remove its default grey fill and reduce
   the visible glyph footprint.
6. Add focused contract tests for the regression and update the durable
   floating-surface guardrails.

## Motion contract

- Trigger: focus/click opens Suggestions; tag or Category action opens its
  picker; elapsed-time click opens the start editor.
- Owner: `PersistentTimerBar` owns Suggestions, Categories, and the start
  editor; `InlineTagInput` owns tag surfaces. CSS owns their restrained panel
  presence transition. The timer runtime remains the only mutation owner.
- Entrance/update/exit: local surfaces fade and translate by four pixels over
  the existing 140 ms control timing. Filtering updates only the internally
  scrolling list. Closing reverses visibility without moving timer layout.
- Surrounding layout: surfaces are out of flow and do not change timer or route
  geometry.
- Interruption: a second trigger deterministically replaces/closes the current
  timer-owned surface. Escape/outside click closes it and returns focus to its
  trigger where appropriate.
- Async outcome: only the start editor has an async Save. Busy state preserves
  geometry; success closes; validation/network failure keeps the editor open
  with its inline error. There is no Undo or timeout.
- Accessibility: Reduce Motion removes translation and uses restrained opacity;
  listbox/dialog semantics, keyboard focus, 44 px targets, readable contrast,
  and focus restoration remain present.

## Success criteria

- Suggestions, Tags, Categories, and the start editor remain completely visible
  outside the timer panel at desktop, tablet, phone, and 200%-zoom-equivalent
  widths.
- Light, Dark, and System show a consistent, clearly separated popup surface.
- Tags load, filter, toggle, create, and scroll; Category selection and keyboard
  navigation continue to work.
- The visible tag action has no default grey circular fill while its keyboard
  and pointer target remains at least 44 px.
- The start editor is anchored to the elapsed control, has uniform internal
  padding, preserves date/time selection and Cancel/Save, and no longer dims the
  page.
- Timer start/stop, optimistic rollback, route continuity, manual entry, and
  active-detail persistence remain unchanged.
- Focused tests, web typecheck/test/build, full lint/typecheck/test/build,
  brand check, `git diff --check`, and the required browser matrix pass.

## Validation

### Automated

- Focused floating-surface, timer-shell, and tag-editor contract tests: 17
  passed.
- Full workspace lint and TypeScript checks: passed.
- Full workspace tests: 755 passed (245 mobile, 416 web, 94 shared).
- Optimized Next.js production build: passed.
- Brand asset contract: passed.
- `git diff --check`: passed.

### Browser evidence

A disposable current-schema local Postgres database kept the QA path isolated
from the existing development database. The optimized production build passed
the popup journey at:

- 1440x900 Light
- 1280x720 Dark
- 1024x768 System
- 720x450 System (200%-zoom equivalent)
- 390x844 Light
- 390x844 Dark

The pass opened Suggestions, Tags, and Categories at each viewport, asserted
that every panel remained within the viewport, verified the shared semantic
background/border/shadow, checked tag-list scroll ownership, and confirmed no
horizontal page overflow. It also started a timer and verified that the start
editor stayed anchored, focused its date input, created no dialog scrim, and
returned focus to the elapsed-time trigger on Escape.

The first phone pass exposed one additional interaction defect: closing Tags
focused the description input, immediately reopening task Suggestions over the
Category trigger. Focus now returns to the Tags trigger, and the complete
matrix passed after that correction.

The first 720x450 pass also showed that the compact two-row timer placed Tags
and Categories too low for their desktop height budget. Compact low-height
layouts now shorten those internal scroll regions and open the start editor
upward; the final 720x450 pass kept all four surfaces inside the viewport.

### Remaining gate

- GitHub/Vercel checks and an authenticated Preview review.
