# Web Timeline quick edit and fresh Today state

## Scope

- Trello #105: make exact Timeline List entries quick-editable without replacing the existing full editor.
- Trello #130: advance a Timeline tab after local midnight only when it had been showing the previous Today, and label the current Day as `Today`.
- No database, API, mobile, Reports, Calendar-editor, or grouped-summary mutation changes.

## Interaction contract

- Trigger: one click on an exact entry's Description enters borderless inline editing without selecting its text. Start and Finish remain directly editable as `HH:MM`; each edge also has a separate Dayframe-themed calendar option. Focus departure saves, Escape cancels, and double-click opens the existing full editor.
- Owner: `EntriesTable` owns one inline-edit session. The existing `TimeEntryQuickEditorModal` remains the sole full-editor owner.
- Entrance/update/exit: the same input nodes stay mounted and the table geometry stays fixed. Description, Category, Tags, Time, Duration, and Actions keep one vertically centred row. Idle Category/Tags sit immediately after the measured Description; Description focus alone expands that lane and eases metadata right, then returns it left on exit. Description remains borderless in every focus state. Success returns to read-only text in place; validation or network failure keeps the editor open with an inline error.
- Range clipping: an entry extending beyond the selected Day opens from the visible clipped interval, not its full stored span. Focusing `17:33–00:00 / 6h 26m` therefore cannot flash the underlying `17:33–17:43 / 24h 09m`. A no-change exit emits no patch; an actual time/date change treats the opposite displayed edge as fixed and recalculates Duration.
- Surrounding layout: no row insertion, removal, reordering, or animated reflow. Aggregate group rows never become inline editors; expanded occurrences are exact-entry targets.
- Interruption: a newer inline session has a monotonic session ID, so an older async completion cannot close or overwrite it. Double-click cancels the inline session before opening the full editor.
- Async outcome: saves use the existing compact-editor plan and mutation routes. Successful saves refresh canonical data; failures preserve the draft and focus. There is no optimistic row mutation or Undo path.
- Accessibility: read-only inputs remain keyboard reachable; Enter/F2 enters, Enter saves, Escape cancels, errors use `role="alert"`, and save progress uses `role="status"`. No motion is introduced, so Reduce Motion requires no alternate animation.

## Date rollover contract

- The page records the browser's local Today key.
- Focus, visibility restoration, and the next local-midnight boundary reconcile that key.
- If the selected date equals the previous Today, the existing URL/date-loading path advances it to the new Today.
- A deliberately selected historical date remains selected.
- Day labels use `Today` only when their resolved local date equals the current local date; Week labels keep their explicit range.

## Focused verification

- Pure inline-edit plan tests: Description, fixed-Finish Start changes, fixed-Start Finish changes, recalculated Duration, themed-picker date changes, invalid input, and no-op clipped cross-day entry focus.
- Timeline date tests: previous-Today rollover, historical-date preservation, no same-day reset, local `Today` label, existing DST range coverage.
- Source contracts: exact-entry/group ownership and focus/visibility rollover wiring.
- Web TypeScript and `git diff --check`.
- Hands-on Staging acceptance is intentionally left to KB.
