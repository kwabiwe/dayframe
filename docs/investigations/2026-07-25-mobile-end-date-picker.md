# Mobile End-Date Picker

## Report

The completed-entry editor used Dayframe's floating calendar for the start date,
but exposed the end date as a raw `YYYY-MM-DD` keyboard field.

## Fix

- Start and end date controls now open the same `FloatingDatePicker`.
- The picker tracks whether it is editing the start or end value and preserves
  the corresponding time-of-day when a date is selected.
- Existing future-date validation, theme styling, accessibility semantics,
  motion ownership, keyboard dismissal, and 44-point control geometry remain in
  the shared picker and edit-sheet paths.
- A source contract prevents the end date from regressing to a keyboard text
  field.

## Success Criteria

- In Add time and Edit entry, tapping Start date opens the shared calendar and
  updates only Start date.
- Tapping End date opens the same calendar and updates only End date.
- Selecting a date preserves the relevant start/end time value.
- Future end timestamps remain rejected.
- Light, Dark, Dynamic Type, VoiceOver, Reduce Motion, keyboard avoidance, save,
  cancel, and reopening the entry remain correct.
- Repository validation, iOS build, merged-main archive, TestFlight processing,
  export compliance, notes, and internal beta assignment all pass.
