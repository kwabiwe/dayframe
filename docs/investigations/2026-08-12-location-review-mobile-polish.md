# Location Review mobile polish

Date: 2026-08-12

## Reported behaviour

Follow-up physical-iPhone screenshots of the merged Location Review work show
four presentation issues:

- the category-colour accent follows the Review card's rounded leading edge
  instead of reading as a straight inset rail;
- focusing `Search other places` can leave the field behind the iOS keyboard;
- an unmatched stay pre-fills `What did you do?` with the generated
  `Visit at an unknown place` title, forcing the user to erase system copy; and
- Location Evidence category choices are taller than Dayframe's established
  compact visual pills.

The supplied screenshots are visual evidence only. No location coordinates,
account data, tokens, or production payloads are committed.

## Root cause

- `reviewCard` implements identity with `borderLeftWidth`, so the border is
  clipped by the card radius.
- The Location Evidence `ScrollView` dismisses and retains the keyboard
  correctly, but it neither applies iOS automatic keyboard insets nor reveals
  the focused control when the keyboard frame changes.
- The activity draft initializes directly from `evidence.display.title`; the
  Location V2 ingest service deliberately uses `Visit at an unknown place` as
  an unmatched-stay display fallback, not as user-authored activity text.
- The screen-local category choice owns a 44 pt visible capsule instead of
  separating Dayframe's 32 pt visual pill from its 44 pt interaction target.

## Implementation boundary

- Replace the rounded leading border with a square-ended vertical rail inset
  from the top and bottom card curves. Preserve category colour, card fill,
  spacing, actions, and selection semantics.
- Keep the existing outer evidence `ScrollView` as the only scroll owner. Apply
  the native iOS keyboard inset and reveal a covered focused search/activity
  field with bounded clearance.
- Start the unmatched generated visit activity as an empty draft with
  `Add activity (optional)` placeholder copy. Preserve genuine activity titles
  and saved-place visit titles.
- Use the established 32 pt visual category pill inside a 44 pt target. Keep
  selected-state semantics and category colour, and remove the redundant
  selected checkmark.
- Do not change nearby-POI retrieval or ranking, Location V2 capture, Review
  mutations, persistence, schemas, API contracts, or database state.

## Motion contract

- Trigger: the user focuses Search or Activity while the iOS keyboard opens or
  changes frame.
- Owner: the existing outer React Native `ScrollView` is the single reveal and
  scroll owner; UIKit owns the keyboard transition. No nested scroll view,
  keyboard-avoiding wrapper, or second animation owner is introduced.
- Entrance/update: the native keyboard inset updates first. If the complete
  focused field would be covered, the owner performs one bounded scroll with
  16 pt clearance. Existing Reanimated owners continue to own nearby/search
  result presence and local section reflow.
- Exit: keyboard dismissal removes the native inset without forcing the screen
  back to its original offset. The accent rail and compact pills are static.
- Surrounding layout: the focused input remains mounted and keeps the same
  stacking context. Dynamic Type remeasurement occurs before each reveal.
- Interruption: a user drag invalidates a pending automatic reveal. Focus
  generations ensure rapid focus changes and callbacks after unmount cannot
  scroll a stale field or reopened screen.
- Async outcome: keyboard reveal has no network or optimistic state. Existing
  POI/search request generations and Review mutation acknowledgement remain
  unchanged.
- Accessibility: normal motion uses one restrained native scroll; Reduce
  Motion reveals immediately. VoiceOver focus and selected-state announcements
  are preserved, touch targets remain at least 44 pt, and category identity is
  never communicated by colour alone.

## Documentation impact

- Product/architecture/API/schema: reviewed; no contract change.
- UI/motion: update the component guardrail and regression checklist.
- Delivery state: refresh the tracker to the actual `origin/main` baseline and
  record this polish as release-pending only after it lands on main.
- Release: mobile JavaScript changes need focused tests, a simulator build, and
  a signed staging preview before merge; production/TestFlight is not inferred.

## Validation plan

- Focused draft/helper and mobile Review source-contract tests.
- Mobile typecheck and documentation alignment check.
- One iOS simulator build; do not repeat successful checks in a loop.
- On the signed staging build: focus Search with nearby results present, focus
  Activity lower in the form, inspect the inset rail and compact pills, then
  perform a short System/Light/Dark, Dynamic Type, VoiceOver, and Reduce Motion
  pass.

## Validation evidence

Completed on 2026-08-12:

- `npm run test --workspace @dayframe/mobile -- --run src/lib/locationReviewDraft.test.ts src/components/reviewActions.contract.test.ts`
  passed (2 files, 20 tests).
- `npm run typecheck --workspace @dayframe/mobile` passed.
- `npm run check:docs` passed (109 Markdown files before this evidence update).
- `npm run check:ios-config` passed.
- A cold Debug build for the booted `Dayframe Sheet QA SE` iOS 26.5 simulator
  completed once with `** BUILD SUCCEEDED **`. CocoaPods emitted only existing
  dependency script-phase warnings; generated local dependency artifacts are
  not part of this change.

Still required before marking the PR ready to merge:

- Install the signed staging/preview build on the attached iPhone and complete
  the focused keyboard, rail, compact-pill, VoiceOver, Dynamic Type,
  light/dark, and Reduce Motion acceptance pass above.
