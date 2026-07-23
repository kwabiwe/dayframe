# Web Timer Strip Refinement

Date: 2026-07-23

Branch: `codex/web-timer-strip-refinement`

Base: `be97f1fc7aff0e681525556dcc2119119980826f` (`origin/main`, merged PR #100)

Pull request: [#101](https://github.com/kwabiwe/dayframe/pull/101) (draft)

Status: Ready for review

## Scope

This focused PR implements the persistent timer composition annotated in `DF web 2.pdf`. It owns the shared Dashboard/Timeline timer strip, timer-specific responsive layout, overlay positioning, control geometry, keyboard/focus treatment, and regression evidence.

It does not change Timeline range architecture, Calendar blocks/actions, grouped lists, Reports filters, global Search, mobile source, API contracts, the database, hosted deployment, or production data.

## Visual Requirement

The supplied Photoshop sketch defines one desktop control line:

`[ Task description + tag action ] [ Category ] [ Plus ] [ Elapsed time ] [ Play/Stop ]`

The task field is the flexible majority column, the tag action remains inside it, Category stays adjacent, Plus and Play/Stop use the same circular footprint, elapsed time has a stable width, and Quick actions remain beneath the row.

Source render used for comparison:

- full PDF render: `/tmp/dayframe-pdf-review.lajnIz/df-web-2-1.png`
- focused target crop: `/tmp/dayframe-pdf-review.lajnIz/timer-target-region.png`

These are local QA artifacts and will not be committed.

## Current-Main Reproduction

The exact base was built with `npm run build -w @dayframe/web` and run as an optimized production server with `DAYFRAME_AUTH_MODE=dev` against the disposable local PostGIS database `dayframe_timer_strip_test`.

At 1440 x 900 in the seeded running state, current main measured:

| Control | Width | Height | Vertical centre |
| --- | ---: | ---: | ---: |
| Description compound field | 566 px | 56 px | 86.5 px |
| Category | 230 px | 52 px | 113.58 px |
| Plus | 44 px | 44 px | 117.58 px |
| Elapsed/start | 160 px | 56 px | 111.58 px |
| Stop | 56 px | 56 px | 111.58 px |

All horizontal gaps were 12 px, but four different outer heights and selected-tag participation in the description column pulled the controls off a common line. In the idle state the centres still differed by up to 12.39 px. At 390 x 844, Description was 56 px, Category 52 px, Plus 44 px, Time 56 px, and Play 56 px.

The active Stop button is kept circular only by a later CSS override of the older wide active-button rule. Timer styling is split between the earlier timer definitions and a later fill-led layer.

## Implementation Plan

1. Restructure the timer form as one explicit label/control grid so labels own row one and all five controls own row two.
2. Use the shared 44 px ordinary-control and icon-action tokens for Description, Category, Plus, Time, and Play/Stop.
3. Keep tags as a secondary line inside the description column without changing the shared control track.
4. Constrain Category and elapsed-time tracks, preserve a flexible `minmax(0, 1fr)` description track, and use one grid gap owner.
5. Add deliberate phone/200%-zoom rows without shrinking interaction targets.
6. Keep task suggestions, hashtag autocomplete, tag picker, Category menu, start editor, manual entry, Quick actions, optimistic mutations, rollback, and route continuity on the existing shell owner.
7. Consolidate the owning timer CSS and add focused source/runtime contracts.
8. Rebuild, measure, perform two visual reviews, then run the complete required validation set.

## Motion Contract

- Trigger: opening/closing a timer suggestion, tag picker, Category menu, start-time editor, or manual-entry dialog; starting/stopping the timer; and responsive reflow caused by viewport size.
- Owner: `PersistentTimerBar` owns its local menus and draft presentation; `InlineTagInput` owns tag overlays; shared `ModalDialog`/`PopoverPanel` owns dialog presentation; `AppShellRuntimeProvider` remains the sole timer/mutation owner.
- Entrance/update/exit: existing overlay and dialog behavior remains. Timer start/stop swaps the icon and elapsed content within identical outer geometry; no new spatial animation is added.
- Surrounding layout: the grid tracks remain stable between idle/running states. Selected tags use only the description column's secondary line. Quick actions remain below the form.
- Interruption: the existing mutation gate rejects rapid duplicate actions. Escape closes only the active timer-owned layer and returns focus where applicable.
- Async outcome: optimistic start/stop/update behavior and exact rollback remain unchanged. Busy state disables the relevant actions without introducing layout-moving progress UI.
- Accessibility: the existing global Reduce Motion rule still collapses transitions. Visible labels, focus ownership, keyboard reachability, live error alerts, 44 px targets, and dialog focus restoration remain present.

## Architecture Preservation

`AppShellRuntimeProvider` remains the one timer owner mounted by `AppShell`. No new poller, store, API client, mutation queue, route-level timer, database migration, shared payload, or mobile implementation is introduced.

## Implemented Structure

The timer form now has explicit label and control areas:

```text
description-label | category-label
description       | category | manual | time | action
```

At wide widths the authoritative track is:

```css
minmax(0, 1fr) minmax(160px, 220px) 44px minmax(132px, 144px) 44px
```

At 840 px and below, Description takes a full-width row and the remaining controls use:

```css
minmax(0, 1fr) 44px minmax(104px, 118px) 44px
```

At 350 px and below, Category takes its own full-width row before the action row. All compact variants preserve 44 px interaction targets and use one gap owner.

The tag picker trigger remains inside `InlineTagInput`'s shared `ui-compound-control`. Category now exposes a labelled listbox trigger, Arrow Up/Down/Home/End navigation, Escape focus return, viewport-safe menu bounds, and nested flex shrink rules that keep long labels inside their track.

## CSS Consolidation

The late fill-led timer layer is now the single authoritative timer presentation. The refactor removed the obsolete earlier timer surface, entry-bar/form/action/clock/control-group rules, the old 50 px Play button, the wide 92 px active Stop variant, unused delete-action rules, and duplicate early Category, suggestion, and Quick action blocks.

The retained rules use the shared control-height, icon-button, radius, padding, field-gap, layout-gap, surface, focus, and semantic colour tokens. No new arbitrary colour, font, radius, motion, or route-local spacing system was introduced.

## Final Geometry

At 1440 x 900, both idle and running states measured:

| Control | Width | Height | Vertical centre |
| --- | ---: | ---: | ---: |
| Description compound field | 604 px | 44 px | 77.55 px |
| Category | 220 px | 44 px | 77.55 px |
| Plus | 44 px | 44 px | 77.55 px |
| Elapsed/start | 144 px | 44 px | 77.55 px |
| Play/Stop | 44 px | 44 px | 77.55 px |

All four horizontal gaps are 12 px. Switching idle to running changes only the content/icon; the five outer boxes and their centres remain identical.

Responsive final measurements:

| Viewport | Description | Category | Plus | Time | Play/Stop | Document overflow |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1280 | 444 x 44 | 220 x 44 | 44 x 44 | 144 x 44 | 44 x 44 | None |
| 1024 | 336 x 44 | 220 x 44 | 44 x 44 | 144 x 44 | 44 x 44 | None |
| 768 | 580 x 44, own row | 350 x 44 | 44 x 44 | 118 x 44 | 44 x 44 | None |
| 390 | 338 x 44, own row | 108 x 44 | 44 x 44 | 118 x 44 | 44 x 44 | None |
| 720 CSS px (1440 at 200% equivalent) | 668 x 44, own row | 438 x 44 | 44 x 44 | 118 x 44 | 44 x 44 | None |

On the 390 px `Uncategorized` fixture, Category stayed 108 px wide, the label clipped from 97 px intrinsic width to 39 px with ellipsis, and an 8 px gap remained before the 44 px Plus action.

## Browser And Mutation Evidence

The final optimized build was exercised against the disposable database `dayframe_timer_strip_test`.

- Enter created exactly one active entry.
- Idle Play created exactly one active entry.
- A Quick action created exactly one active entry with the expected Category.
- A task suggestion created exactly one active entry with the suggested description.
- Shift+Space created exactly one active entry and a second Shift+Space stopped that same entry without increasing the row count.
- Stop changed the one active entry to completed without creating another entry.
- Manual entry produced one dialog and one completed entry.
- Description, Category, and selected tag changes persisted on the active entry.
- Dashboard -> Timeline -> Dashboard preserved the same active entry, draft fields, and advancing elapsed time.
- With the production server deliberately unavailable, optimistic Start returned to idle, exposed a dismissible error, and created zero database rows.
- A long 690 px intrinsic description remained inside a 334 px input at 390 px without document overflow.
- Category menu, task suggestions, tag picker, and manual-entry dialog fit the phone viewport.

## Visual Reviews

### Pass 1

The annotated target and the implementation were placed in one combined comparison image. The wide layout matched the intended ordering, flexible description treatment, internal tag action, equal circular actions, stable time track, and Quick actions placement.

The responsive pass found that the desktop track left only 80 px for Description at exactly 768 px. The timer's compact composition was moved to the 840 px breakpoint so the 768 px Description track became 580 px.

### Pass 2

The second pass was run independently after a fresh optimized build. It classified two blockers before accepting the result:

1. The new 840 px rule initially appeared before the later authoritative timer rules and was overridden. The rule was moved beside the final timer layer and the production build was rerun.
2. `Uncategorized` could force the Category button past its 108 px phone track and cover Plus. The trigger/value now have explicit `min-width: 0`, flex shrink, overflow containment, and a non-shrinking chevron.

After those fixes, the complete 1440/1280/1024/768/390 matrix passed in System, Light, and Dark: 15 combinations, no horizontal overflow, matching geometry between themes, readable surfaces, and no runtime overlay. The final independent classification is:

- Blockers: none.
- Bugs: none.
- Polish: none required for this focused PR.
- Deferred: unrelated review-plan work remains outside scope.

The final combined target/implementation image is:

`/tmp/dayframe-pdf-review.lajnIz/final-reference-comparison-neutral.png`

It is a local QA artifact and is not committed.

## Automated Validation

- `npm run lint`: passed.
- `npm run typecheck`: passed for mobile, web, and shared.
- `npm run test`: passed, 100 files and 693 tests total:
  - mobile: 33 files, 237 tests;
  - web: 62 files, 362 tests;
  - shared: 5 files, 94 tests.
- `npm run build`: passed the optimized web production build.
- `npm run check:brand-assets`: passed.
- Explicit web lint, typecheck, 362-test suite, and optimized build: passed.
- Explicit mobile typecheck and 237-test suite: passed.
- Focused timer/control suite before browser review: 5 files, 19 tests passed.
- `git diff --check`: required immediately before commit.

Shared helpers/types, mobile source, native iOS modules, database schema, and API payloads did not change, so no additional shared-only or iOS build was required.

## Limitations And Manual Checks Before Merge

- The in-app browser does not expose a native page-zoom capability. The 200% layout audit used the equivalent 720 CSS px viewport for a 1440 px browser and should receive one manual native-browser 200% zoom check before merge.
- Provider-auth, Safari/WebKit, and hosted Preview behavior were not rerun because this PR changes only the authenticated timer presentation and local interaction wiring; the existing session and API contracts are untouched.
- The local browser fixture uses seeded categories and a disposable database. It does not alter production data.

## Rollback

Revert this PR to restore the preceding timer markup and CSS. There is no migration, persisted setting, API contract, mobile change, or hosted state to unwind.
