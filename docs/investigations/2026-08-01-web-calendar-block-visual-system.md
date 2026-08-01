# Web Calendar Block Visual System

Date: 2026-08-01

Branch: `codex/web-calendar-block-visual-system`

Base: `7578a1ebd2bb7c2ef45debd7a270b7674b15e65e` (`origin/main`, merged PR #151)

Status: Implementation and local validation complete; draft PR pending

## Scope And Non-Goals

This focused web-only change consolidates the visual contract for live Calendar
time-entry blocks: radius, border, fill, selected/focus treatment, visual gaps and
the inline Play glyph. It preserves the existing Calendar action card, edit dialog,
timer runtime, resize owner, overlap classification and semantic time values.

It does not add the compact floating editor, remove the bottom action card, add
click-to-create, change mobile source, broaden tags, change APIs, add a dependency,
or add a database/Supabase migration.

## Supplied Visual Intent

The supplied references show compact Calendar cards with visibly tighter corners,
soft category fill, restrained boundaries, clear separation between adjacent cards
and a predictable right-edge Play glyph. The intended result is a dense time tool,
not pill-shaped event decoration or selection dominated by a bright perimeter.

## Current-Main Reproduction

The baseline was reproduced from exact base `7578a1e` in the in-app Chromium
browser at `1440x900` against disposable database
`dayframe_calendar_visual_qa_test`. The fixture set covered 5, 8, 10, 15, 30 and
60-minute entries; exact sequential boundaries; partial, contained and dense
overlap; Running; Uncategorized; cross-midnight continuation; a long description;
and light/strong category colours.

Computed baseline results:

- normal blocks resolved to `14px` through the later fill-system rule;
- short and tiny blocks resolved to `8px` and `7px` through more specific earlier
  rules;
- block border width resolved to `0px`;
- the inset `3px` category rail remained visible in every normal state;
- two equal lanes exposed a `4px` internal trench because each internal edge added
  `2px`;
- exact sequential entries at 15-minute zoom had `0px` visible vertical separation;
- pointer selection left the primary button matching `:focus-visible`, producing a
  `2px` blue focus outline;
- after pointer-opened Edit and Save, the generic dialog restored the primary
  button and the same blue focus outline remained;
- Play was top-right and CSS also revealed it for selected and `:focus-within`
  states.

The first no-op Edit save exposed that the local template database predated the
`user_edited_at` column already present on current main. That column was added only
to the disposable QA database before repeating the focus-restoration reproduction;
no repository migration is part of this change.

## Live Renderer Audit

`CalendarReview` in `apps/web/src/components/TimeReviewViews.tsx` is the one live
web Calendar entry renderer. It serves Day and Week scopes and every Calendar zoom
level. Reports, List and Timesheet do not render this positioned block component.

Repository search found `.swiss-time-block` only in legacy/style ownership, not in
current React rendering. Its unrelated rules remain untouched. The live block owner
is `.calendar-time-block` plus its primary, Play and resize siblings.

## Root Causes

1. Density-specific `10px`, `8px` and `7px` radii conflicted with a later `14px`
   fill-system override.
2. That same late rule forced the Calendar border to zero while the earlier owner
   continued to draw identity with an inset `3px` rail.
3. Selection owned a persistent outline while focus owned a second outline. Pointer
   focus and generic dialog focus restoration therefore appeared as the reported
   blue post-edit perimeter.
4. Lane interpolation added `2px` on both neighbouring internal edges, producing a
   four-pixel gap.
5. Semantic block height was painted edge-to-edge, so exact sequential blocks
   visually merged at zoom levels where minimum-height collision handling did not
   place them in separate lanes.
6. Play was anchored at the top and its visibility selector included hover,
   selection, `:focus-within` and its own focus.

## Implemented Visual Contract

### Radius, Border And Fill

- One block-owned `--calendar-block-radius: 6px` applies to normal, short and tiny
  blocks.
- Base fill remains `18%` category accent mixed with `surface`.
- Selected fill uses `26%` category accent mixed with `surfaceInset`, creating a
  stronger category-derived state without a bold perimeter.
- The real `1px` border mixes `42%` category accent with the semantic line colour.
- Uncategorized overrides those variables with neutral semantic values and keeps
  its hatch in normal and selected states.
- Running adapts the same single border to dashed rather than adding an outline.
- Cross-midnight slices keep square clipped edges and suppress the relevant border.
- No live Calendar state retains the inset left rail.

### Vertical Gap Without Time Drift

`calendarBlockStyle` continues to calculate the semantic `top` and `height` from
the exact timestamps. `layoutTimeBlockLanes` and rendered-density decisions still
receive that semantic geometry. Only afterward,
`calendarBlockVisualGeometry` subtracts one rendered pixel from the visible height.
It never changes `top`, never mutates its input and clamps the visual height to at
least one pixel. A slice that continues into the next day keeps its full height so
the day edge does not imply a false break.

This produces no cumulative drift: every block starts at its independently
calculated semantic `top`. Stored values, displayed times, durations, snapping,
PATCH payloads and overlap intent are unchanged.

### Horizontal Lane Gap

`calendarBlockLaneInsets` preserves the existing `8px` outer day-column inset. An
internal lane edge receives half of the one-pixel target gap (`0.5px`). Two
neighbouring lanes therefore expose one pixel in total rather than the previous
four. Fractional percentages remain owned by the shared deterministic lane/overlay
classification; this helper only interpolates the final CSS insets.

### Selection And Focus

Selection changes only to the stronger category-derived fill plus restrained
elevation. It owns no outline and does not change border width or dimensions.

The explicit perimeter remains on
`.calendar-time-block:has(.calendar-entry-primary:focus-visible)`. Pointer mouse
down prevents default focus acquisition and pointer click clears any browser focus
that remains before selection. Keyboard focus and keyboard activation keep the
primary focused and retain the visible semantic focus ring. This also prevents the
generic dialog from restoring pointer-origin focus as a blue post-save outline.

### Play Placement And Resize Conflict

`canShowTimeBlockInlineAction` is the tested presentation policy. It permits Play
only for completed, unselected, non-resizing blocks with full text density and
enough rendered height. CSS keeps it pointer-hover-only and hoverless media hides
it. The selected action card remains the keyboard/touch Start again route.

Taller blocks place the `22px` target `2px` from the bottom-right. Short/tiny blocks
use a `20px` target vertically centred at the right edge and clamp to the block
height. The action lane is reserved before hover so text does not jump.

On tall resizable blocks Play has z-index `8` and the bottom resize strip remains at
z-index `6`. Only the right-edge Play zone wins hit testing; the rest of the bottom
strip continues to own resize. Play and resize remain sibling controls, so there is
no nested interaction or duplicate mutation path.

## Special-State Preservation

- Running keeps full text opacity, its explicit label, one dashed boundary and no
  Play.
- Uncategorized keeps the neutral hatch and border in normal and selected states.
- Continuation slices keep only the clipped top/bottom corners square and do not add
  a false gap at the next-day edge.
- Resize keeps the existing pointer threshold, snapping, draft, z-index and async
  owner; it removes only the old rail and suppresses Play.
- Shared lane/overlay classification, dense text suppression and deterministic
  block hit targets remain unchanged.

## Motion Contract

- Trigger: pointer hover, pointer selection, keyboard focus and resize start/end.
- Owner: Calendar block CSS owns fill/border/shadow/glyph presentation;
  `CalendarReview` owns selected/resize state; the existing runtime owns Start again.
- Entrance/update/exit: state colours, border, shadow and glyph opacity update in
  place over the established 140ms control timing; no block translation or reflow is
  introduced.
- Surrounding layout: semantic block/lane geometry never animates or moves for a
  visual state.
- Interruption: rapid hover, selection and resize resolve from current CSS/component
  state; selection/resizing unmount Play immediately and no delayed timer owns it.
- Async outcome: Start again and resize retain their existing mutation gates,
  success reconciliation and failure rollback.
- Accessibility: Reduced Motion collapses transition duration through the global
  preference rule while retaining state, focus and action access. Keyboard focus
  remains visible; pointer hover is not the only Start again route.

## Files Changed

- `apps/web/src/components/TimeReviewViews.tsx`
- `apps/web/src/app/globals.css`
- `apps/web/src/lib/time-block-display.ts`
- `apps/web/src/lib/time-block-display.test.ts`
- `apps/web/src/components/calendarReadabilityRestart.contract.test.ts`
- `.codex/reference/components.md`
- `docs/dayframe-regression-checklist.md`
- `docs/feature-fix-tracker.md`
- this investigation

## Superseded Documentation Rule

The historical 2026-07-24 investigation correctly records the earlier decision to
show inline Play on hover, keyboard focus or persistent selection. The approved
contract for this change supersedes only that visibility rule: inline Play is now
pointer-hover-only, while keyboard and touch retain Start again in the selected
action card. The historical note is intentionally unchanged.

## Automated Validation

- `npm run test -w @dayframe/web -- src/lib/time-block-display.test.ts src/components/calendarReadabilityRestart.contract.test.ts src/components/webCategoryIdentity.contract.test.ts`: PASS, 3 files / 16 tests.
- `npm run lint -w @dayframe/web`: PASS.
- `npm run typecheck -w @dayframe/web`: PASS.
- `npm run test -w @dayframe/web`: PASS, 90 files / 571 tests.
- `npm run build -w @dayframe/web`: PASS, optimized Next.js build with 32 static pages generated.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS for mobile, web and shared workspaces.
- `npm run test`: PASS, 142 files / 1,021 tests across mobile, web and shared.
- `npm run build`: PASS.
- `npm run check:brand-assets`: PASS.
- `git diff --check`: PASS.

## Browser Evidence

Baseline screenshots (untracked):

- `/tmp/dayframe-qa/web-calendar-block-visual-system/baseline-day-dark-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/baseline-selected-day-dark-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/baseline-post-save-focus-ring-day-dark-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/baseline-day-dark-15-minute-zoom-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/baseline-week-dark-15-minute-zoom-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/baseline-week-light-15-minute-zoom-1440x900.png`

Final optimized-production screenshots (untracked):

- `/tmp/dayframe-qa/web-calendar-block-visual-system/production-day-dark-15-minute-zoom-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/production-week-dark-15-minute-zoom-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/production-week-light-15-minute-zoom-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/production-day-dark-phone-390x844.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/final-selected-pointer-no-blue-outline-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/final-keyboard-focus-visible-1440x900.png`
- `/tmp/dayframe-qa/web-calendar-block-visual-system/final-post-save-no-blue-outline-1440x900.png`

Final computed production measurements:

- exact sequential entries expose `1px` at 30- and 15-minute zoom; one-hour zoom
  retains the existing minimum-height collision lanes so the cards do not merge;
- all four neighbouring overlap lanes expose exactly `1px` at `1440x900`;
- ordinary corners resolve to `6px`, with only continuation-clipped edges square;
- the live border resolves to `1px`, category-derived colour and no inset rail;
- pointer selection and pointer Edit/Save resolve to no outline and do not match
  `:focus-visible`;
- keyboard activation resolves to one `2px` semantic focus outline at `1px` offset,
  without revealing Play;
- Running retains one dashed boundary; Uncategorized retains the hatch;
- a real bottom resize drag outside the Play zone snapped `13:00` to `13:15`,
  produced one successful PATCH and cleared resize state;
- the same tall block measured Play at z-index `8` above the z-index `6` bottom
  resize strip only in the right-edge action zone;
- the fresh production tab reported no console errors.

### Browser Matrix

| Material case | Result | Evidence |
| --- | --- | --- |
| `1440x900`, `1280x720`, `1024x768`, `768x844`, `390x844`, `720x450` | PASS | No document horizontal overflow; one radius/border contract held; phone hid inline Play and floating surfaces kept 12px gutters. |
| Day and Week | PASS | Both scopes rendered the same live owner; Week continuation corners remained clipped correctly. |
| One-hour, 30-minute and 15-minute zoom | PASS | Zoom controls remained functional; minimum-height lanes handled the tightest scale and 30/15-minute scales measured the intended vertical gap. |
| Light and Dark | PASS | Category-derived border/fill and exposed Calendar canvas remained semantic in both appearances. |
| Completed, selected and keyboard-focused | PASS | Fill-led pointer selection, no pointer outline, one keyboard-only focus outline. |
| Pointer Edit/Save and keyboard Enter Edit | PASS | Dialog opened from both contracts; pointer Save restored no blue perimeter. |
| Running, Uncategorized and cross-midnight | PASS | Dashed Running, neutral hatch and clipped continuation edge preserved. |
| Exact sequential, partial, contained and dense overlap | PASS | Vertical separation measured `1px` where cards touch; four neighbouring lanes each measured `1px`. |
| Short/tiny and long description | PASS | `6px` corners held, title-first density/truncation remained stable and action-lane reservation caused no reflow. |
| Resize and Play/resize geometry | PASS | Real outside-zone drag snapped/saved once; measured z-order gives Play only the bottom-right action zone. |
| Inline hardware hover reveal/click | NOT RUN | The in-app browser backend did not expose CSS `:hover` from its pointer move. Fine-pointer media gating, hidden default/selected/focus/resize states, placement and the guarded Start-again runtime are covered by computed styles and tests. |
| Touch gesture execution | NOT RUN | The `390x844` layout and hidden inline action passed; the unchanged selected action card remains the touch/keyboard Start again route, but a physical touch gesture was not emulated. |
| Resize failure rollback | NOT RUN | Successful resize and existing regression contracts passed; an intentional network failure was not injected. |
| Reduced Motion emulation | NOT RUN | No geometry motion was added and the global Reduced Motion contract still collapses transitions, but the media preference was not browser-emulated. |
| List/Timesheet rendered regression | NOT RUN | Their renderers were not changed and the full test/build suite passed; the final manual pass stayed scoped to Calendar. |

## Limitations And Deferred Work

- Compact floating editor, bottom-card removal, click-to-create and mobile styling
  remain intentionally deferred to later PRs.
- Hardware hover/click, a physical touch gesture, injected resize failure, Reduced
  Motion emulation and rendered List/Timesheet checks remain the explicit local
  validation limits above. They do not block this visual-only draft because the
  affected source contracts and broad automated suite pass.
- The disposable QA database was dropped after the production-browser pass. QA
  screenshots remain untracked under `/tmp` and are not part of the PR.
