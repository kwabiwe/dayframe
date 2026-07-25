# Web Settings and running-timer follow-up

## Scope

This follow-up starts from merged PR #110 and addresses the final screenshot-led
web fixes in the running start-time editor, Settings, category management,
profile workspace switching, sidebar appearance access, Places switch geometry,
and the generic read-only integration API.

It does not change timer creation/stopping semantics, workspace API contracts,
authentication, report calculations, mobile UI, database schema, or production
data.

## Findings

- The running start editor rendered a second `form` inside the persistent
  timer's outer `form`. Nested forms are invalid HTML; Enter or Save could reach
  the outer timer submission owner, trigger navigation/loading UI, and bypass
  the intended start-time update.
- Native date/time picker indicators introduced redundant keyboard stops after
  their editable segments.
- Account Settings rendered every workspace, rename form, and create form at
  once, creating unnecessary vertical space.
- The profile popover workspace rows retained card-like treatment despite the
  surrounding Settings and Log out rows being flat.
- Category colour choices used rounded rectangles with borders and shadows,
  while category identity elsewhere uses circles.
- Appearance needed a direct sidebar Light/Dark action, and selected segmented
  text needed the same dark-on-coral semantic colour as its icon.
- The route-level Settings loading boundary replaced previously rendered data
  even though the persistent shell already held a same-session bootstrap
  snapshot suitable for stale-while-revalidate presentation.
- WebKit touch styling could distort the Places suggestion checkbox because its
  switch track did not explicitly lock min/max dimensions, box sizing, padding,
  and `-webkit-appearance`.
- The existing integration API exposed only the current timer; consumers had no
  bounded, paginated way to read logged entries.

## Implementation contract

- The persistent timer remains the only outer form owner. Start-date/time Enter
  and Save call the start update directly, prevent propagation, optimistically
  update elapsed time, persist through the existing API, and retain the editor
  with an inline error on failure.
- Date and time remain native segmented controls. Their custom calendar/clock
  buttons call `showPicker()` by pointer and use `tabIndex=-1`, so keyboard flow
  is date segments, time segments, Cancel, then Save.
- Settings shows one compact workspace selector. Rename and New workspace reveal
  only their relevant inline form and collapse after success.
- Profile workspace rows use the same compact, fill-led menu treatment as
  Settings and Log out without individual shadows.
- Category identity and palette choices are circular and borderless. Save uses
  text only; Edit uses a pencil.
- The sidebar Light/Dark action is icon-only, placed immediately above Help &
  Shortcuts, and explicitly switches to the opposite resolved appearance.
- Settings consumes the persistent shell snapshot immediately, refreshes it
  quietly, and shows the full loading state only when no authenticated
  bootstrap data has been cached in the current shell.
- The Places suggestion switch explicitly owns a 52×30 px pill track and a
  24 px circular thumb across desktop and touch browsers.
- `GET /api/integrations/v1/time/entries` reuses `time:read`, requires a bounded
  ISO date range, returns newest-first entry metadata, and uses opaque cursor
  pagination with explicit user/workspace isolation.

## Motion contract

- **Trigger:** workspace Rename/New, profile workspace selection, theme toggle,
  or running start editor Save.
- **Owner:** existing React component state owns local visibility; the shell
  theme helper owns appearance changes; the timer runtime owns optimistic data.
- **Entrance/update/exit:** workspace detail forms use normal compact row
  insertion/removal; existing focus and surface transitions remain unchanged.
- **Surrounding layout:** only the selected workspace detail form occupies
  Settings space. Profile switching and theme changes do not move navigation.
- **Interruption:** repeated timer mutations remain gated; workspace actions are
  disabled while busy; Cancel closes only the relevant detail form.
- **Async outcome:** timer and workspace success reconcile from bootstrap;
  failure retains the editor/form and exposes friendly feedback.
- **Accessibility:** icon-only actions have names, picker icons stay pointer
  operable but leave the tab sequence, focus remains visible, and Reduced Motion
  does not remove state or feedback.

## Success criteria

- Mouse Save and Enter both update a running timer's start date/time without a
  page reload or Loading Dayframe flash; the duration updates immediately and
  persists after refresh.
- Keyboard order skips calendar/clock icon buttons.
- Appearance selected text is legible on coral in System, Light, and Dark.
- Workspace Settings are compact and switching/rename/create remain functional.
- Profile workspace rows are flat and visually match adjacent menu actions.
- Category swatches are circular, borderless, shadowless, and keyboard
  selectable; Save and Edit affordances match the requested icon contract.
- The sidebar contains one named icon-only Light/Dark toggle above Help.
- Routine Settings refreshes keep cached content visible and do not overwrite
  active forms.
- “Suggest visits here” remains a pill on iPad/WebKit.
- Trusted integrations can read bounded pages of logged time entries without a
  write capability or full bootstrap access.

## Validation evidence

- Focused web typecheck passed. The expanded focused component/API suites
  passed 23 tests.
- Full lint, workspace typechecks, brand contract, optimized production build,
  and `git diff --check` passed. The full suite passed 787 tests.
- Optimized-build browser QA passed eleven evidence groups across Light, Dark,
  and System at desktop, phone, compact-height, and iPad-sized layouts. It
  exercised timer pointer Save and Enter as separate single-update paths,
  persistence after reload, no navigation/Loading flash, picker tab order,
  Appearance contrast, cached Settings during a delayed quiet refresh, compact
  workspace controls, profile workspace rows, category colour/action contracts,
  the Places suggestion switch, sidebar theme toggle, overflow, and
  console/runtime errors.
- A local optimized-build API smoke returned `200`, two entries, `hasMore:
  true`, and a non-empty opaque cursor for a bounded logged-time request.

## Rollback

Revert the follow-up commit. There is no schema, migration, production-data, or
mobile rollback.
