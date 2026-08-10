# Mobile tag keyboard native-blur follow-up

## Report and scope

The staging iPhone build from PR #164 at `2c41207` still visibly lowered and
restored the software keyboard when **Add a tag** inserted `#` and when the
only `#` was deleted. Description appeared focused again after each transition,
so the existing final-state keyboard assertion passed despite the visible dip.
This follow-up is limited to responder continuity, empty-space keyboard
dismissal, regression evidence, and rebuilding the same draft PR for staging.

## Native diagnostic evidence

One non-repeated native Tags flow reproduced the hidden responder churn. At the
`tag_keyboard_continuity` checkpoint it recorded:

- `tagBlurRecoveryCount = 3`
- `inputFocusCount = 4`
- `swipeStartedCount = 0`
- `swipeCancelledCount = 0`
- `keyboardConfirmationRetryCount = 0`

The three recovery events corresponded to opening Tags by typing `#`, closing
it by deleting `#`, and opening it through **Add a tag**. Zero sheet-pan starts
and zero keyboard-confirmation retries excluded the sheet gesture and keyboard
watchdog. The old test observed only the recovered final state and therefore
produced a false pass.

## Root cause

The Description section conditionally gained `zIndex: 20` whenever the Tags
panel became visible. Under iOS Fabric, changing the stacking order of an
ancestor of the focused `TextInput` causes its native subtree to be reordered.
That briefly resigns first responder. The continuity lease immediately focused
Description again, which preserved final state but made the keyboard's native
hide/show transition visible.

The tag and historical panels were already kept mounted, so conditional
mounting was not the remaining cause. The dynamic ancestor stacking change was.

## Fix and motion ownership

Description now owns one static elevated stacking context for the entire sheet
presentation. Opening and closing Tags changes only the existing panel's
pointer/accessibility state and its 140 ms opacity/translation animation; it no
longer reorders the focused native subtree. Reduced Motion continues to use
zero translation. The blur-recovery lease remains only as a last-resort guard,
and the native Tags flow now requires `tagBlurRecoveryCount` to remain unchanged
across typed `#`, deletion, **Add a tag**, and shortcut deletion.

The disabled vertical ScrollView did not reliably deliver empty-space taps on
iOS and had no valid scrolling role in this fixed form. The fixed form itself
is now the background `Pressable`, while structural layout wrappers use
`pointerEvents="box-none"`. Making the form the responder matters on iOS:
placing an absolute Pressable behind later layout siblings still allowed a
non-interactive descendant to terminate native hit testing before UIKit
searched the background sibling. Inputs, buttons, horizontal lists and the
native dial keep their own responder regions; an otherwise unhandled tap
bubbles to the form and calls the existing safe Description/keyboard dismissal
path. The bounded horizontal Category and Tags result lists remain ScrollViews.

## Validation boundary

Final evidence is one targeted native Tags flow from the changed source, plus
the focused contract tests and mobile typecheck. No repeated or stress loop is
part of this follow-up. Physical-iPhone interaction remains the acceptance
check for the installed staging build.
