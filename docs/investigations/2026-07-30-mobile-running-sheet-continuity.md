# Mobile running-sheet continuity and time-entry action alignment

## Report

On the running timer sheet, `Done` was lower than the requested top-right
placement. The clarified requirement applies to every `ActiveTimerEditSheet`
mode: running timer, Add time, completed/history entry and Review edit. The
visual top and right insets must be equal when measured from the outer rounded
sheet, rather than from a header or content wrapper.

Focusing Description while Suggestions were visible had previously produced a
discontinuous transition: Suggestions collapsed, but the keyboard immediately
reconstrained the sheet through a separate height change.

## Fix

- Replace the running-only, header-relative `Done` exception with one absolute
  top-action layer in the outer `ActiveTimerEditSheet` surface. All modes use
  the same named 16-point top/right inset and the same 44-point minimum target.
- Reserve trailing header room for that action, so Add time and Edit entry
  titles cannot render underneath it at normal or enlarged text sizes.
- Keep Stop in `activeEditHeroRow`, independently below the top action.
- Measure the sheet before the keyboard opens and animate its height to the
  keyboard-constrained target in parallel with the existing keyboard lift.
- Collapse Suggestions over the shared 220 ms local-layout duration, animating
  opacity, a restrained upward translation, maximum height, and therefore the
  surrounding form-field reflow.
- Give the existing local session gate the explicit name
  `suggestionsDismissedForSession`. A small pure helper now makes the
  eligibility rule testable: a refresh cannot recreate Suggestions after
  manual Description/tag entry, a keyboard dismissal, or clearing the draft.

## Root cause and hypotheses

1. **Confirmed from source:** running mode used an absolute offset inside
   `sheetHeader`, while Add/Edit used the header's normal flow. The shared
   sheet padding and handle row meant neither declared `top` value described
   the required outer-sheet measurement. The new top-action layer is positioned
   directly in the positioned outer sheet.
2. **Audited, awaiting device evidence:** the existing keyboard/height owner
   already stops/replaces a previous animation and runs height interpolation in
   parallel with keyboard lift. Suggestions were also already kept mounted
   during their exit. This follow-up preserves that ownership and makes the
   existing quiet-refresh suppression rule explicit and directly testable.

## Geometry evidence

| Sheet context | Before top/right | After top/right source contract | Rendered measurement |
| --- | --- | --- | --- |
| Running timer | Header-relative; not outer-sheet measurable from source | 16 pt / 16 pt | Not run — physical sheet interaction still pending |
| Add time | Header-flow placement; not outer-sheet measurable from source | 16 pt / 16 pt | Not run — physical sheet interaction still pending |
| Completed/history entry | Header-flow placement; not outer-sheet measurable from source | 16 pt / 16 pt | Not run — physical sheet interaction still pending |
| Review edit | Shares completed-entry header-flow placement | 16 pt / 16 pt | Not run — physical sheet interaction still pending |

The visual `Done` pill remains at least 44 × 44 pt. The after values are a
source contract, not a claim of rendered-device measurement.

## Motion contract

- Trigger: Description receives focus while running-timer Suggestions are
  visible.
- Owner: `ActiveTimerEditSheet` owns the top-action placement, Suggestions
  presence, sheet height, and keyboard lift through React Native `Animated`;
  the existing swipe primitive continues to own presentation, handle drag,
  backdrop and dismissal.
- Entrance/update/exit: Suggestions retain their existing entrance. On exit
  they fade, move up six points, and collapse while the form moves into the
  released space.
- Surrounding layout: the sheet height interpolates from its measured open
  height to the keyboard-safe target rather than switching from intrinsic to
  fixed height in one frame.
- Interruption: a newer keyboard frame stops and replaces the active height and
  lift animations; the Suggestions animation already stops/restarts from its
  current value. A session-dismissal ref is not reset by a blur, keyboard hide,
  cleared Description, late suggestion data or optimistic ID reconciliation.
- Async outcome: not applicable; focusing Description is local state.
- Accessibility: Reduce Motion applies the final geometry immediately. The same
  sheet and Description input remain mounted, preserving focus and VoiceOver
  context. The Done action retains a 44-point minimum target.

## Validation

- `npm run typecheck -w @dayframe/mobile`: passed.
- Focused suggestions, keyboard-layout, time-entry action and swipe-owner tests:
  5 files / 24 tests passed.
- `npm run test -w @dayframe/mobile`: passed, 44 files / 311 tests.
- Full `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` and
  `npm run check:brand-assets`: passed. The workspace test suite covered 138
  files / 945 tests.
- `git diff --check`: passed at the focused-validation point.
- `npm run ios -w @dayframe/mobile -- --device 'iPhone 17 Pro Max'`: passed.
  The native Debug app built, installed and launched on iOS 26.5.
- Simulator recording: captured under the untracked
  `.codex-dayframe-qa/mobile-sheet-done-continuity/` directory. It is not a
  successful sheet-flow recording: bootstrap and empty Play surface
  `ExpoSecureStore`'s `KeyChainException: A required entitlement isn't present`,
  and the action reports `Timer not started`. This branch has no native,
  SecureStore, signing or entitlement diff, so the failure is documented as a
  pre-existing validation blocker rather than attributed to this UI change.
- Physical device named `iPhone`: connected as an iPhone 11 on iOS 27.0 and
  accepted the Dayframe Apple Development signing identity. The first install
  stopped at 229 MB free when `rsync` could not copy `hermesvm.framework`.
  After permanently deleting only the eight identified regenerable Dayframe
  DerivedData folders (about 11.5 GB), the signed Debug build completed,
  installed, and launched as `com.layereight.dayframe`; the Dayframe process
  is present on the device and Metro is listening on port 8081. Xcode's
  automatic-signing edits to the project file were not retained in the branch.
  Physical sheet interaction is still pending: iPhone Mirroring reaches its
  Mac-login prompt for the `Agent` account, whose credential was not entered.
  System/Light/Dark, Reduce Motion, Dynamic Type, VoiceOver and Reduce
  Transparency still require those direct interactions.

## Residual risk and release gate

No web, API, database, sync or native-project contract changed. PR #142 merged
as `5200eb9` and shipped in TestFlight `0.1.0 (80)`, delivery/build ID
`c85104d0-ab2f-4acb-9383-e59398d2b05d`. App Store Connect reports `VALID`,
export compliance false and `IN_BETA_TESTING` through `Internal Health Debug`;
the archive uses API base `https://dayframe-web.vercel.app`.

The implementation is released but remains in `Watch` until each sheet context
is measured and recorded on a physical iPhone and the Light/Dark, Reduce Motion,
Dynamic Type, VoiceOver and Reduce Transparency interaction matrix completes.
The simulator Keychain-entitlement failure remains a separate validation
blocker rather than a release failure.
