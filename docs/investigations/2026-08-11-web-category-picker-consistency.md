# Web category picker consistency

## Report

The create-enabled web category picker had three visible inconsistencies across
the timer and compact entry editors:

- the create heading and Name label used nearby `rem` values instead of stable
  semantic typography roles;
- the Calendar host's option-button selector also matched the nested colour
  action, moving its dot against the field edge; and
- the final Create action drew its divider as an inset shadow on the rounded
  action, producing rounded line corners that touched the action surface.

The approved measured handoff is the Figma file
[`Dayframe / Web Category Picker Consistency`](https://www.figma.com/design/WijcNXvGGk0kSIDuvXBvHO).

## Hypotheses and evidence

1. The shared compound-control geometry was wrong everywhere. This was
   disproved by the timer rendering and source geometry: a 20px dot centred in
   the 44px leading target inside a 2px perimeter produces the intended 14px
   visible inset.
2. A compact-editor host override changed the nested control. This was proved
   by the later `.calendar-compact-category-menu button` rule, which matched
   option rows, the nested colour action and create-form buttons.
3. The divider artefact came from the menu border. This was disproved by source
   inspection; `.category-picker-create-option` owned an inset top `box-shadow`
   on the same rounded button.

## Decision and implementation

- Keep `CategoryPicker` as the single owner of create typography and internal
  geometry across timer, Add Time, Timeline List and Calendar hosts.
- Use 14px/650 for the create heading and actions, 12px/650 for the Name label,
  and 14px/400–500 for input and option text.
- Keep the create swatch at 20px inside its 44px leading target. Scope Calendar
  host styling to direct option rows so it cannot override nested controls.
- Replace the rounded action's inset shadow with a separate 1px semantic line,
  inset 12px and separated from the rounded action surface by 6px.
- Promote the reusable rules to `docs/brand-style-guide.md`; keep engineering,
  regression and proof details in their canonical supporting documents.

No product behavior, API, persistence, mobile surface, Reports picker or
category catalogue semantics change.

## Motion contract

- **Trigger:** existing category-picker open, Create option and colour-dot
  actions.
- **Owner:** the shared `CategoryPicker` remains the sole presence owner.
- **Entrance/update/exit:** existing floating-surface opacity/translation and
  timing remain unchanged; only static typography and geometry change.
- **Surrounding layout:** portalled placement remains fixed and unanimated;
  opening the list, Create state or colour palette never reflows the editor.
- **Interruption:** existing Escape, outside-pointer, focus-return and rapid
  reopen ordering remains unchanged.
- **Async outcome:** existing create success, failure retention and retry paths
  remain unchanged.
- **Accessibility:** Reduce Motion suppresses the same nonessential movement
  while preserving state and focus; targets remain at least 44px.

## Validation record

- Focused DOM and source-contract tests protect category creation behavior,
  create typography, swatch geometry, divider anatomy and host-selector scope.
- Exact Preview and promoted Staging browser evidence will be recorded in PR
  #167 before hands-on testing is handed off.
