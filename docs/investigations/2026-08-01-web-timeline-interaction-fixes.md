# Web Timeline interaction fixes

## Report

Three issues were reported from the production web Timeline on 2026-08-01:

- a category Quick Action inherited the running task's description and tags;
- the sticky Calendar date header painted over the task Suggestions panel; and
- the deletion Undo bean was taller than the adjacent responsive Timeline controls.

The supplied screenshots showed `Work / BAU / #Cubic` followed by a Chores
Quick Action that incorrectly created `Chores / BAU / #Cubic`, the `Sat 01 Aug`
Calendar header crossing the Suggestions surface, and a 56 px Undo bean beside
the compact responsive Timeline control language.

## Root causes

- Quick Actions supplied only `categoryId` to the shell runtime. The runtime
  deliberately merges partial timer inputs with the current draft, so the
  running task's description and tags were retained.
- The Suggestions panel's local z-index was inside a Timeline timer-shell
  stacking context at z-index 25. Sticky Calendar headers use z-index 40/42,
  so they could paint over the panel regardless of its child z-index.
- The Undo bean declared `min-height: 56px`; its phone override also added 8 px
  vertical padding. Both contradicted the shared 44 px web control rhythm.

## Fix

- Quick Actions now construct and submit one explicit category-only draft:
  selected category, blank description, and no tags.
- The Timeline timer-shell stacking context is raised above its sticky view
  chrome while its existing floating children retain their established local
  ordering.
- The complete Undo bean uses the shared responsive control-height token: 44 px
  on touch/mobile layouts and 38 px on compact desktop. Its orange action
  stretches through the available inner height, and long notices truncate on
  one line rather than increasing the bean height.

## Motion contract

- Trigger: deleting a Timeline entry or group opens the existing Undo bean.
- Owner: the existing CSS notice entrance/exit animation and
  `TimelineDeleteUndoController`; this PR adds no second owner.
- Entrance/update/exit: unchanged 160 ms restrained translation/opacity; only
  the resting geometry changes to the responsive control-height contract.
- Surrounding layout: none; the notice remains fixed and does not reflow the
  Timeline.
- Interruption: existing tokenized rapid-delete and exit handling remains
  authoritative.
- Async outcome: existing Undo, expiry, persistence success, and failure
  rollback behaviour is unchanged.
- Accessibility: focus/live-region behaviour is unchanged; Reduced Motion
  continues to disable the animation without removing the Undo opportunity.

## Validation

- Focused web runtime and component tests passed: 3 files, 26 tests covering active replacement, dirty idle
  drafts, rapid repeated actions, request payloads, optimistic state, metadata
  preservation, and failure rollback in addition to the CSS contracts.
- Repository lint and all workspace typechecks passed.
- All 1,014 automated tests passed: 313 mobile, 565 web, and 136 shared.
- The optimized Next.js production build, brand-asset contract, and diff checks
  passed.
- Vercel Preview browser checks remain required in Timeline Calendar, List, and
  Timesheet at desktop and phone widths, including Quick Action replacement,
  Suggestions layering, Undo/expiry, keyboard focus, Light/Dark, Reduced
  Motion, and console/runtime errors.
