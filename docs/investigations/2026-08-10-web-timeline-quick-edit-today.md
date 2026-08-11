# Web Timeline quick edit and fresh Today state

## Scope

- Trello #105: make exact and grouped Timeline List descriptions quick-editable without replacing the existing full editor.
- Trello #130: advance a Timeline tab after local midnight only when it had been showing the previous Today, and label the current Day as `Today`.
- Add one web-only, workspace/user-scoped batch-description API; no database migration, mobile/shared contract, Reports, or Calendar-editor change.
- Triggerless inline date pickers mount their body portal only after hydration so every List row preserves identical server and first-client markup; the hidden panel then becomes available without a runtime overlay.

## Interaction contract

- Trigger: one click on an exact or grouped entry's Description enters borderless inline editing without selecting its text. A grouped target owns every occurrence ID in that aggregate; Enter/F2 also enters, Enter or focus departure saves, and Escape restores the original text. Double-click retains full-editor behaviour for exact entries but remains a grouped edit on aggregate rows. Start and Finish remain compact side-by-side `HH:MM` inputs; clicking either input enters editing and opens its Dayframe-themed calendar without a separate icon column.
- Owner: `EntriesTable` owns one inline-edit session. The existing `TimeEntryQuickEditorModal` remains the sole full-editor owner.
- Entrance/update/exit: the same input nodes stay mounted and the table geometry stays fixed while editing and saving. Idle Description is drawn by the existing measure span while the transparent native input remains above it for pointer, keyboard and caret ownership; the native glyph appears only in edit mode. Description, Category and Tags share one typographic baseline. The occurrence circle and category dot remain geometrically centred against the 38 px desktop/44 px phone primary line. Description focus alone expands that lane over 180 ms and eases metadata right, then returns it left on exit. Description remains borderless in every focus state. Start and Finish remain independent inputs in an intrinsic `5ch 16px 5ch` grid, with equal 8 px outer padding, a centred separator and the timer toolbar's responsive control height; it cannot flex into Duration. A successful grouped regroup has one 180 ms scoped View Transition; unsupported browsers and Reduce Motion update immediately. Validation or network failure keeps the editor open with its draft, inline error and restored focus.
- Range clipping: an entry extending beyond the selected Day opens from the visible clipped interval, not its full stored span. Focusing `17:33–00:00 / 6h 26m` therefore cannot flash the underlying `17:33–17:43 / 24h 09m`. A no-change exit emits no patch; an actual time/date change treats the opposite displayed edge as fixed and recalculates Duration.
- Surrounding layout: CSS flex-grow remains the inline-field animation owner and reflows only the Description/Category/Tags sequence. Only the Task cell is top-aligned; Time, Duration and Actions retain centred cell alignment even when Task has a visible secondary line. Overlap warnings stay beneath the primary Task line rather than changing its baseline. A grouped save can merge rows only within the existing same-day, category, normalized-description and canonical-tag identity. If the source group was expanded, expansion transfers to the resulting merged key and exposes every combined occurrence.
- Interruption: a newer inline session has a monotonic session ID, so an older async completion cannot close or overwrite it. On exact entries, double-click cancels the inline session before opening the full editor; grouped double-click keeps the aggregate target.
- Async outcome: exact saves use the existing compact-editor plan and mutation routes. Grouped saves send one batch request containing every group ID, apply the successful descriptions locally before canonical refresh, and block repeat submission while saving. Failures preserve the draft and focus. There is no Undo path.
- Accessibility: read-only inputs remain keyboard reachable; Enter/F2 enters, Enter saves, Escape cancels, errors use `role="alert"`, and save progress uses `role="status"`. A successful merge returns focus to the resulting grouped Description. The time input exposes the calendar dialog state directly and Escape returns focus to that input. Reduce Motion removes Description translation and regroup motion while preserving the state changes.

## Grouped-description API contract

- `PATCH /api/time-entries/batch-description` accepts `{ ids: string[], description: string | null }` and returns `{ ok: true, ids, updatedCount }`.
- Description is trimmed and blank input is stored as `null`, matching exact-entry editing.
- The service locks and validates every requested completed entry in one transaction scoped to the active workspace and user. A missing, out-of-scope or running ID aborts the entire request before any update.
- The endpoint intentionally requires at least two distinct IDs; running and individual entries continue through their existing exact-entry owners.

## Follow-up root causes and guardrails

- List typography had been centred by control boxes rather than the rendered glyph line. The native read-only Description input and full-height metadata controls therefore exposed different font metrics even when their boxes shared a centre. Idle Description now renders through its existing measure span, and the Description/Category/Tags line uses baseline alignment while marker centres retain explicit control-height calculations.
- The Time shell itself had the intended grid dimensions, but the shared `.timeline-date-picker` rule appeared later in the cascade and restored `display: grid` plus a 120 px minimum to each triggerless inline picker wrapper. That invisible child collapsed both `HH:MM` inputs to 0 px, leaving only the separator visible. The Timeline-specific child selector now forces those wrappers to `display: contents` with no minimum; a source contract locks the cascade-sensitive selector.
- Overlap content had been allowed to affect table-cell centring. Task alone owns top alignment and its second line; Time, Duration and Actions keep their centred cell alignment in every row.

## Date rollover contract

- The page records the browser's local Today key in the current tab's session as well as the mounted view, so reopening a Timeline route that had been showing the prior Today can recover after the component was unmounted.
- Focus, visibility restoration, and the next local-midnight boundary reconcile that key.
- If the selected date equals the previous Today, the existing URL/date-loading path advances it to the new Today.
- A deliberately selected historical date remains selected.
- Day labels use `Today` only when their resolved local date equals the current local date; Week labels keep their explicit range.
- Timeline's header date picker uses the shared centred, viewport-clamped portal so the shorter `Today` label cannot pull the calendar under the shell's clipped edge or leave it offset to one side. Inline time calendars retain start-edge anchoring. The desktop date lane is intrinsic for full day/week labels with a `120px` minimum, so Week copy is never clipped while `Today` retains balanced padding.
- Timeline List rows use the responsive control height as one primary alignment plane. On desktop the 28px occurrence count and 12px category dot are offset by `(38px - size) / 2`; the same formula adapts to the 44px phone control height. Description, Category and Tags share one visible text baseline, while Time, Duration and Actions keep their column centres. Overlap warnings render below the primary plane and cannot reposition first-line content.

## Focused verification

- Pure inline-edit plan tests: Description, fixed-Finish Start changes, fixed-Start Finish changes, recalculated Duration, themed-picker date changes, invalid input, and no-op clipped cross-day entry focus.
- Grouped-description API/service tests: atomic multi-entry update, trimming/blank-to-null conversion, user/workspace scoping, running-entry rejection, missing-ID rollback and unchanged database state after failure.
- Grouped-description DOM/grouping tests: click/F2/double-click grouped entry, one request with every ID, Enter/blur save, Escape cancellation, failed-draft focus and retry, local merge with a matching identity, recomputed count/duration, and category/tag/day isolation.
- Anchored-picker DOM and row-layout contracts: hydration-stable portal mounting, input-triggered themed calendar without a visible icon trigger, viewport-clamped header anchoring, stable arrow spacing for `Today`, Escape focus return, idle measure-span typography, Description/Category/Tags baseline alignment, dot/count primary-line centres, separate overlap line, a contained `5ch 16px 5ch` borderless Time grid with equal inline padding, centred separator, responsive height, explicit focus suppression, Description-only reflow, and Reduce Motion fallback.
- Timeline date tests: previous-Today rollover, historical-date preservation, no same-day reset, local `Today` label, existing DST range coverage.
- Source contracts: exact/group target ownership, atomic batch routing, optimistic regroup/expansion transfer, and focus/visibility rollover wiring.
- Web TypeScript and `git diff --check`.
- Hands-on local and stable-Staging acceptance must cover Light/Dark desktop/mobile geometry, grouped merge/focus, overlap rows, Time-to-Duration containment and the promoted deployment identity.

## Rendered browser evidence

- Optimized local build, dev-auth fixture, 11 August 2026 Day/List: Description and Category text bottoms differed by `0px`; Tags shared the same 16 px line box; the 12 px dot and 28 px occurrence circle each differed by `0px` from the 38 px primary-line centre. The Overlap badge began below the primary line.
- Focused Time editor at 1440 px: `5ch / 16px / 5ch`, 38 px high, 8 px left/right padding, separator centre delta `0px`, and computed border/outline/shadow all absent. Its `1039.95px` right edge remained inside the `1146.09px` Time-cell edge and before Duration at `1156.59px`.
- At 768 px the Time editor remained 38 px high and inside Time (`755.86 < 777.20 < 787.70`). At 390 px it followed the 44 px phone control height and remained inside Time (`537.36 < 557.20 < 569.20`), with no document-level horizontal overflow; the fixed table scroll stayed local to the List surface.
- A real grouped save renamed two expanded fixture entries to an existing matching description. One batch request updated both rows; the rendered result became one three-occurrence group with a 1h 30m total, retained all three expanded occurrences, and restored focus to the merged shared Description. Direct database inspection confirmed both targeted rows were updated and marked user-edited.
- Dark/Light desktop and 390 px phone screenshots showed the same alignment. The current Day trigger measured 120 px; the Week label `Mon 10 Aug – Sun 16 Aug 2026` had equal `clientWidth`/`scrollWidth` of 251 px; the header calendar centre differed from the trigger by `0px` and remained inside the viewport. Browser console warnings/errors: none.
