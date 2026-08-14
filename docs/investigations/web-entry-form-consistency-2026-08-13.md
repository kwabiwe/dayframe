# Web Entry Form Consistency Investigation

Date: 2026-08-13
Updated: 2026-08-14
Scope: Trello `PR1` — Add Time consistency, compact `HHMM` typing, and browser selection colour

## Findings

Three independent presentation paths had drifted:

- Add Time still used the generic two-column form, while Calendar/List/Reports used the compact time-entry anatomy. This placed Category before Description and omitted the aligned Duration surface.
- The first alignment pass reused the compact field classes without giving the Add Time dialog their required horizontal-inset custom property. The browser therefore discarded the unresolved padding declaration and painted Description against the card edge.
- Existing-entry headers repeated the description or category beneath a muted `Calendar entry` kicker, even though the editable Description field already carried that information.
- Running entries rendered the Duration label inside its inset value box, unlike Start, Finish and completed-entry Duration.
- The controlled time-input mask inserted a colon after the third digit. For sequential `1025` entry, the third keystroke changed `102` to `1:02` and moved the caret; the fourth digit was then inserted into an already bounded minutes field and could be truncated.

The application-level `::selection` rule originally used the solid action coral while some controls still appeared with browser-native blue selection. The first PR pass replaced it with `--accent-soft`, but review found that tint nearly indistinguishable from the surrounding surface in both themes. The final treatment therefore keeps one Dayframe coral selection while preserving measurable selected-to-unselected and text contrast.

## Resolution

- Add Time now uses the compact editor field anatomy and order while preserving its existing suggestions, tag/category creation, overlap warning, validation and event-first submission path.
- Add Time, anchored Calendar editing and modal entry editing now inherit one shell contract for border, radius, shadow, colour, 12px content inset, 64px header, 72px footer and 44px controls. The Add Time close and footer actions use the same geometry and treatment as the other entry cards.
- Completed and running editors use the single black/bold `Edit Entry` title. Entry descriptions such as `Sleep`, and the former `Untitled entry` fallback, remain solely in the Description field rather than being duplicated in the header. Calendar create mode retains `Calendar Entry`, and Add Time uses the equivalent single `Add Time` title.
- Add Time exposes equal-height Start, Finish and read-only Duration surfaces; narrow containers wrap Duration before stacking all temporal fields.
- Running Duration uses the same external label/value structure as the completed and create editors.
- Add Time, completed-entry and running-entry footers use one fixed 92×44px Cancel/primary action size. Add Time now places the same compact, icon-free overlap sentence in the footer feedback plane instead of a yellow notice card inside the form.
- Completed entries may finish in the future. Only a future Start remains invalid, matching the API's existing completed-entry contract and removing the misleading future-Finish error cue.
- Digit-only drafts remain unformatted while incomplete. Four digits synchronize immediately, while valid three-digit shorthand normalizes on blur/commit. Colon-form input remains supported.
- Global browser selection uses the contrast-safe `--accent`/`--on-accent` pair in light and dark themes. The softer coral token was rejected because its selected-to-unselected contrast was too weak.
- Empty and cleared Description fields open historical suggestions in Add Time, completed/running Edit Entry and the running toolbar without requiring a Category. Suggestion selection applies Description/Category/Tags, restores input focus without reopening, and updates an active timer instead of starting another one. Shared quick-editor suggestions portal to the viewport so editor scrolling cannot clip them.
- Add Time outside-dismissal now owns only the actual Description compound control and suggestion panel; the full-width label gutter is no longer an implicit Description hit target.
- Add Time no longer places its mobile fixed Suggestions, Tags or date-time panels inside a query-container containing block. Start and Finish retain explicit accessible names with their full dates while their closed controls return to time-only visible values; Finish shows a cross-midnight `+N`, and common phone widths reserve a separate wrapping row for overlap feedback.
- All compact Start, Finish and Duration values now use the same 15px/21px regular foreground typography. Running entries place the existing subtle `Running timer` status below the shared header title, and every Calendar-anchored create/edit footer exposes Cancel beside Save without removing outside dismissal.

## Guardrails And Evidence

- DOM coverage exercises sequential `1025` entry in the shared quick editor and Add Time date/time picker, plus `725` blur-before-Save normalization.
- Timeline unit coverage proves the third digit remains raw and the fourth digit resolves to `10:25` without changing the saved edge incorrectly.
- Source contracts protect Add Time field order, shared compact classes, equal Duration anatomy and the contrast-safe global selection pair.
- DOM and source coverage protect equal footer action geometry, the one-line icon-free overlap notice, its Add Time footer placement, and future-Finish editing without an error or danger field cue.
- DOM coverage verifies completed and running editors retain their Description values while the header stays exactly `Edit Entry`, including the former untitled-running case.
- Behavioural DOM coverage verifies Add Time focus/open, outside dismissal, selection and focus recovery; running/completed empty and cleared Description suggestions; keyboard option navigation; and the active-toolbar no-second-timer contract.
- The initial rendered checks passed at `1440x900` and `390x844`, but KB's side-by-side Preview evidence exposed the unresolved Add Time gutter afterwards. The corrected follow-up therefore protects the shared shell metrics directly rather than treating those earlier screenshots as sufficient evidence.
- The managed visual browser was healthy but its navigation policy blocked the private localhost/LAN development URL. Final visual acceptance remains on the exact Vercel Preview; local verification covered the shared light/dark token contract, DOM header states, the optimized production build and all non-visual checks.
- Repository validation passed: `npm run test` (1,625 tests), `npm run typecheck`, `npm run lint` (two pre-existing warnings, no errors), `npm run build`, `npm run check:docs`, and `git diff --check`.

No API, database schema, mobile binary, migration or motion behavior changed.
