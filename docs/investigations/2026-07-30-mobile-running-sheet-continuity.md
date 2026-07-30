# Mobile running-sheet continuity

## Report

On the running timer sheet, `Done` was lower than the requested top-right
placement. Focusing Description while Suggestions were visible also produced a
discontinuous transition: Suggestions collapsed, but the keyboard immediately
reconstrained the sheet through a separate height change.

## Fix

- Position the running `Done` pill independently at the sheet's top-right, with
  equal 16-point top and right insets and a 44-point minimum target.
- Preserve the existing header placement for Add/Edit entry sheets.
- Measure the sheet before the keyboard opens and animate its height to the
  keyboard-constrained target in parallel with the existing keyboard lift.
- Collapse Suggestions over the shared 220 ms local-layout duration, animating
  opacity, a restrained upward translation, maximum height, and therefore the
  surrounding form-field reflow.

## Motion contract

- Trigger: Description receives focus while running-timer Suggestions are
  visible.
- Owner: `ActiveTimerEditSheet` owns Suggestions presence, sheet height, and
  keyboard lift through React Native `Animated`; the existing swipe primitive
  continues to own only presentation and dismissal.
- Entrance/update/exit: Suggestions retain their existing entrance. On exit
  they fade, move up six points, and collapse while the form moves into the
  released space.
- Surrounding layout: the sheet height interpolates from its measured open
  height to the keyboard-safe target rather than switching from intrinsic to
  fixed height in one frame.
- Interruption: a newer keyboard frame stops and replaces the active height and
  lift animations; the Suggestions animation already stops/restarts from its
  current value.
- Async outcome: not applicable; focusing Description is local state.
- Accessibility: Reduce Motion applies the final geometry immediately. The same
  sheet and Description input remain mounted, preserving focus and VoiceOver
  context. The Done action retains a 44-point minimum target.

## Validation

- Mobile TypeScript typecheck.
- Focused running-suggestion and keyboard-layout tests.
- Full mobile test suite and iOS simulator/physical-iPhone interaction checks
  remain release gates.
