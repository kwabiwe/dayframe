# Web calendar, typed time, and Reports overlays

## Scope

This follow-up consolidates four related web interaction fixes:

- close Add time Suggestions immediately after pointer or keyboard selection;
- use one fixed six-week calendar in Add time and Timeline;
- replace long time selectors with a typed, normalising `HH:MM` field;
- present Reports Categories, Tags, and More filters as floating surfaces that
  never move the report content below them.

It does not change report calculations, filter URL semantics, entry persistence,
mobile UI, API contracts, database schema, or production data.

## Findings

- Manual suggestion selection already closed its owner in merged PR #109. The
  regression contract is retained and browser-checked rather than duplicated.
- The first custom calendar created blank leading cells and only rendered the
  current month. Its seven 44 px minimum columns could also exceed the panel's
  inner width, explaining the partial surface shown in narrow captures.
- Timeline still used a browser-native date input, so the two date pickers did
  not share one visual or behavioural implementation.
- The time selector rendered 84 select options across hour and minute controls.
  That is unnecessary on a keyboard-first web surface.
- Reports used native `details` content in normal document flow. Expanding any
  filter therefore increased the panel height and displaced every summary and
  chart below it. The blue rectangle came from the old reserved-border focus
  treatment on the complete trigger.

## Implementation

- `DayframeCalendar` owns the shared month header, weekday row, and fixed 42-day
  grid. Adjacent-month days are muted but selectable and update the visible
  month when chosen.
- Calendar cells retain a 38 px minimum height but relinquish the old 44 px
  minimum width, so all seven columns remain inside the full-width surface.
- `DayframeDateTimePicker` adds a numeric time field. Typing or pasting compact
  values is masked while editing and normalised on blur, Enter, or Done; `725`
  becomes `07:25`. Values outside `00:00–23:59` remain in place with an inline
  error and do not close the picker.
- `DatePickerPopover` reuses `DayframeCalendar` without the time field and keeps
  its immediate Today action.
- Reports filter lists and the More panel use the shared raised surface,
  absolute positioning, bounded internal scrolling, outside-click/Escape
  dismissal, and a deliberate text-colour focus perimeter. Their trigger row
  remains fixed, so opening a filter cannot reflow the report.

## Motion contract

- **Trigger:** pointer or keyboard activation of a date or Reports filter
  trigger.
- **Owner:** each picker/filter component owns its single floating surface.
- **Entrance/update/exit:** reuse the existing shared floating-surface
  opacity/translation transition; selection updates content in place; dismissal
  uses the same owner.
- **Surrounding layout:** no surrounding page reflow. Reports metrics and charts
  keep identical bounds while filters are open.
- **Interruption:** outside click and Escape close the current surface; rapid
  trigger activation deterministically toggles that surface.
- **Async outcome:** report selection preserves the existing URL navigation
  contract. No optimistic rollback or timer is introduced.
- **Accessibility:** controls expose expanded state and dialog/listbox roles;
  keyboard focus remains visible; adjacent dates have full spoken labels;
  Reduced Motion uses the existing shared surface override.

## Success criteria

- Every month displays exactly 42 selectable days in six rows.
- Adjacent-month days are visibly muted and change both the selected date and
  visible month.
- The calendar surface covers the full grid at desktop, phone, compact-height,
  and zoomed layouts in Light, Dark, and System themes.
- Compact time entry normalises unambiguous input and blocks invalid time.
- Add time and Timeline use the same calendar implementation.
- Categories, Tags, and More filters float over Reports without moving metrics
  or charts; they retain contrast, scrolling, selection, keyboard access, and
  URL-backed filter behaviour.

## Validation

- Full repository: 770 tests passed (mobile 245, web 431, shared 94), all
  workspace typechecks, lint, optimized web build, and brand asset contract.
- Production browser bundle: 17 geometry/interaction checks passed across Light
  and Dark desktop, 390 px phone, and 720 x 450 compact-height layouts.
- Browser evidence verified 42 dates, adjacent-month cells, full-width grid
  containment, compact time normalisation, invalid-time blocking, zero
  horizontal overflow, bounded filter lists, and identical document-position
  bounds for Reports summaries before and after Categories, Tags, and More.
- Keyboard Escape/outside dismissal, visible focus, and shared Reduced Motion
  ownership were checked against the documented component and CSS contracts.
- Screenshots and machine-readable browser measurements remain local under
  `tmp/report-calendar-qa/` and are intentionally excluded from the PR.
