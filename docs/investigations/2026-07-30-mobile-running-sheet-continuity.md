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

- Mobile TypeScript typecheck passed.
- Full mobile suite passed: 303 tests across 42 files.
- Workspace lint and `git diff --check` passed.
- The first simulator build attempt exposed an out-of-sync CocoaPods sandbox;
  `npx pod-install` repaired it before release preflight.
- Signed Release archive and App Store export passed from merged `main` at
  `e71dda9`; the archive contains version `0.1.0 (78)` and production API base
  `https://dayframe-web.vercel.app`.
- App Store Connect delivery/build ID
  `7b34be3b-c828-4e97-ab97-2ee1e0424e36` is `VALID`, export compliance is
  false, en-GB notes are set, and the all-build `Internal Health Debug` group
  reports `IN_BETA_TESTING`.
- Physical-iPhone normal/Reduce Motion, Light/Dark, Dynamic Type and VoiceOver
  interaction checks remain the acceptance gate.
