# Web Entry Form Consistency Investigation

Date: 2026-08-13  
Scope: Trello `PR1` — Add Time consistency, compact `HHMM` typing, and browser selection colour

## Findings

Three independent presentation paths had drifted:

- Add Time still used the generic two-column form, while Calendar/List/Reports used the compact time-entry anatomy. This placed Category before Description and omitted the aligned Duration surface.
- The first alignment pass reused the compact field classes without giving the Add Time dialog their required horizontal-inset custom property. The browser therefore discarded the unresolved padding declaration and painted Description against the card edge.
- Existing-entry headers repeated the description or category beneath a muted `Calendar entry` kicker, even though the editable Description field already carried that information.
- Running entries rendered the Duration label inside its inset value box, unlike Start, Finish and completed-entry Duration.
- The controlled time-input mask inserted a colon after the third digit. For sequential `1025` entry, the third keystroke changed `102` to `1:02` and moved the caret; the fourth digit was then inserted into an already bounded minutes field and could be truncated.

The application-level `::selection` rule also used the solid action coral with inverse text, while some controls still appeared with browser-native blue selection. This made selection visually stronger and less consistent than intended.

## Resolution

- Add Time now uses the compact editor field anatomy and order while preserving its existing suggestions, tag/category creation, overlap warning, validation and event-first submission path.
- Add Time, anchored Calendar editing and modal entry editing now inherit one shell contract for border, radius, shadow, colour, 12px content inset, 64px header, 72px footer and 44px controls. The Add Time close and footer actions use the same geometry and treatment as the other entry cards.
- Completed, running and create Calendar editors use the single black/bold `Calendar Entry` title. Entry descriptions such as `Sleep`, and the former `Untitled entry` fallback, remain solely in the Description field rather than being duplicated in the header. Add Time uses the equivalent single `Add Time` title.
- Add Time exposes equal-height Start, Finish and read-only Duration surfaces; narrow containers wrap Duration before stacking all temporal fields.
- Running Duration uses the same external label/value structure as the completed and create editors.
- Digit-only drafts remain unformatted while incomplete. Four digits synchronize immediately, while valid three-digit shorthand normalizes on blur/commit. Colon-form input remains supported.
- Global browser selection uses `--accent-soft` with `--foreground` in light and dark themes.

## Guardrails And Evidence

- DOM coverage exercises sequential `1025` entry in the shared quick editor and Add Time date/time picker, plus `725` blur-before-Save normalization.
- Timeline unit coverage proves the third digit remains raw and the fourth digit resolves to `10:25` without changing the saved edge incorrectly.
- Source contracts protect Add Time field order, shared compact classes, equal Duration anatomy and the soft global selection token.
- DOM coverage verifies completed and running editors retain their Description values while the header stays exactly `Calendar Entry`, including the former untitled-running case.
- The initial rendered checks passed at `1440x900` and `390x844`, but KB's side-by-side Preview evidence exposed the unresolved Add Time gutter afterwards. The corrected follow-up therefore protects the shared shell metrics directly rather than treating those earlier screenshots as sufficient evidence.
- The managed visual browser was unavailable for the corrected follow-up. Final visual acceptance remains on the exact Vercel Preview; local verification covered the shared light/dark token contract, DOM header states, the optimized production build and all non-visual checks.
- Repository validation passed: `npm run test` (1,617 tests), `npm run typecheck`, `npm run lint` (two pre-existing warnings, no errors), `npm run build`, `npm run check:docs`, and `git diff --check`.

No API, database schema, mobile binary, migration or motion behavior changed.
