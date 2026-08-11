# Web Timeline quick edit and fresh Today state

## Scope

- Trello #105: make exact Timeline List entries quick-editable without replacing the existing full editor.
- Trello #130: advance a Timeline tab after local midnight only when it had been showing the previous Today, and label the current Day as `Today`.
- No database, API, mobile, Reports, Calendar-editor, or grouped-summary mutation changes.
- Triggerless inline date pickers mount their body portal only after hydration so every List row preserves identical server and first-client markup; the hidden panel then becomes available without a runtime overlay.

## Interaction contract

- Trigger: one click on an exact entry's Description enters borderless inline editing without selecting its text. Start and Finish remain compact side-by-side `HH:MM` inputs; clicking either input enters editing and opens its Dayframe-themed calendar without a separate icon column. Focus departure saves, Escape cancels, and double-click opens the existing full editor.
- Owner: `EntriesTable` owns one inline-edit session. The existing `TimeEntryQuickEditorModal` remains the sole full-editor owner.
- Entrance/update/exit: the same input nodes stay mounted and the table geometry stays fixed. Every Task, Category, Tags, Time, Duration, category marker and Action lane is geometrically centred in the row; mixed font sizes no longer rely on baseline alignment. An absolute input overlays an intrinsic 28 px text measurer, so idle Category/Tags sit at the original 8 px gap immediately after Description rather than inheriting a reserved column. Description focus alone expands that lane over 180 ms and eases metadata right, then returns it left on exit. Description remains borderless in every focus state. Start and Finish remain independent editable inputs but share one borderless rounded visual shell at the same responsive control height as the timer toolbar Description, with equal inline padding and a geometrically centred separator. Success returns to read-only text in place; validation or network failure keeps the editor open with an inline error.
- Range clipping: an entry extending beyond the selected Day opens from the visible clipped interval, not its full stored span. Focusing `17:33–00:00 / 6h 26m` therefore cannot flash the underlying `17:33–17:43 / 24h 09m`. A no-change exit emits no patch; an actual time/date change treats the opposite displayed edge as fixed and recalculates Duration.
- Surrounding layout: CSS flex-grow is the single local animation owner; it reflows only the Description/Category/Tags sequence and does not insert, remove or reorder rows. Aggregate group rows never become inline editors; expanded occurrences are exact-entry targets.
- Interruption: a newer inline session has a monotonic session ID, so an older async completion cannot close or overwrite it. Double-click cancels the inline session before opening the full editor.
- Async outcome: saves use the existing compact-editor plan and mutation routes. Successful saves refresh canonical data; failures preserve the draft and focus. There is no optimistic row mutation or Undo path.
- Accessibility: read-only inputs remain keyboard reachable; Enter/F2 enters, Enter saves, Escape cancels, errors use `role="alert"`, and save progress uses `role="status"`. The time input exposes the calendar dialog state directly and Escape returns focus to that input. Reduce Motion removes the Description metadata translation while preserving the state change.

## Date rollover contract

- The page records the browser's local Today key in the current tab's session as well as the mounted view, so reopening a Timeline route that had been showing the prior Today can recover after the component was unmounted.
- Focus, visibility restoration, and the next local-midnight boundary reconcile that key.
- If the selected date equals the previous Today, the existing URL/date-loading path advances it to the new Today.
- A deliberately selected historical date remains selected.
- Day labels use `Today` only when their resolved local date equals the current local date; Week labels keep their explicit range.
- Timeline's header date picker uses the shared centred, viewport-clamped portal so the shorter `Today` label cannot pull the calendar under the shell's clipped edge or leave it offset to one side. Inline time calendars retain start-edge anchoring. The desktop date lane is intrinsic for full day/week labels with a `120px` minimum, so Week copy is never clipped while `Today` retains balanced padding.
- Timeline List rows use the responsive control height as one primary alignment plane. On desktop the 28px occurrence count and 12px category dot are offset by `(38px - size) / 2`; the same formula adapts to the 44px phone control height. Description, category, tags, Time, Duration and Actions share that centre. Overlap warnings render below the primary plane and cannot re-centre the dot, count or other columns.

## Focused verification

- Pure inline-edit plan tests: Description, fixed-Finish Start changes, fixed-Start Finish changes, recalculated Duration, themed-picker date changes, invalid input, and no-op clipped cross-day entry focus.
- Anchored-picker DOM and row-layout contracts: hydration-stable portal mounting, input-triggered themed calendar without a visible icon trigger, viewport-clamped header anchoring, stable arrow spacing for `Today`, Escape focus return, intrinsic idle Description width, shared responsive control-height centres across mixed row content, a single borderless rounded shell over separate side-by-side time inputs, equal inline padding, a centred separator, explicit border/outline/shadow suppression on focused time fields, Description-only reflow, and Reduce Motion fallback.
- Timeline date tests: previous-Today rollover, historical-date preservation, no same-day reset, local `Today` label, existing DST range coverage.
- Source contracts: exact-entry/group ownership and focus/visibility rollover wiring.
- Web TypeScript and `git diff --check`.
- Hands-on Staging acceptance is intentionally left to KB.
