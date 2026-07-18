# iOS local motion consistency

Date: 18 July 2026

Status: implementation and automated validation complete; release evidence blocked on remaining device checks

## Scope and baseline

This follow-up covers abrupt local React Native transitions confirmed by source inspection and an authenticated iPhone 17 Pro simulator run against the repository's local dev-auth API. It does not change native stack or tab transitions, the Active Timer sheet owner, SwiftUI Calendar, API contracts, or persistence ownership.

Pre-change evidence is kept as ignored QA output under `.codex-dayframe-qa/motion-consistency/baseline/`:

- `floating-date-picker.png`
- `edit-timer-contained-delete.png`
- `review-list.png`
- `review-confirm-abrupt.mp4`
- `places-list.png`
- `places-learned-copy-notice.png`

The running Today list also confirmed stable expanded and collapsed identity for a three-entry `Study session` group plus an uncategorized row. Source inspection confirmed that the swipe itself already has a single UI-thread owner, continuously travelling danger action and icon, a 14-point surface gap, and semantic danger colours. Those parts are intentionally unchanged.

## Documentation conflict reconciled

Earlier sections of `2026-07-17-today-swipe-delete-motion.md` describe a shared confirmation path and treat collapsed aggregate deletion as a possible safety follow-up. Its later superseding decision, the current feature tracker, regression checklist, PRD, and current code all require direct Today deletion with Undo, including collapsed-group deletion. Edit Timer alone retains the app-owned contained confirmation. This PR follows the superseding current contract and records the historical conflict in its PR notes.

## Motion contracts

### Today deletion and Undo

- Trigger: the existing left-swipe gesture crosses its open threshold and the user activates the travelling danger action.
- Single owner: `ReanimatedSwipeable` continues to own direct manipulation; a shared Reanimated local-presence/layout primitive owns removal, restoration, list reflow, and Undo presence. React owns optimistic state and persistence.
- Entrance/update/exit: deletion removes the affected stable row/group with a short semantic fade/scale; the inverse-colour Undo bean fades in, remains visually stable while its five-second state is current, and fades out on Undo, expiry, replacement, or rollback.
- Surrounding reflow: neighbouring rows/groups use one Reanimated layout transition and retain their existing keys. No broad `LayoutAnimation.configureNext` call participates.
- Interruption: a second deletion commits the older pending deletion before installing a new token and five-second window. Undo acts only on the current token. Stale timers and completion callbacks cannot dismiss or restore newer state.
- Async outcomes: expiry commits the optimistic deletion; persistence failure restores the exact captured entries/group position and announces the failure. Undo restores the exact snapshot without persisting deletion. Normal mutations remain spinner-free.
- Reduce Motion: direct state changes, Undo, errors, focus, and announcements remain; unnecessary translation, scaling, and spring travel are removed in favour of immediate or brief opacity continuity.

### Floating date picker

- Trigger: Edit Timer opens or closes the date picker, selects a date, or moves month.
- Single owner: a Reanimated presence wrapper owns overlay and sheet entrance/exit; a keyed Reanimated content wrapper owns the restrained month crossfade. The Edit Timer sheet remains mounted and retains presentation ownership.
- Entrance/update/exit: the dim overlay fades while the picker surface uses a short, restrained rise/fade; dismissal reverses that continuity. Month movement crossfades content without decorative travel.
- Surrounding reflow: none; the picker is absolutely overlaid and must not reflow Edit Timer.
- Interruption: repeated close/open and month taps converge on the latest React state; the overlay blocks underlying touches while present.
- Async outcomes: none.
- Reduce Motion: no rise or month travel; state changes and a brief opacity transition remain.

### Contained Edit Timer deletion confirmation

- Trigger: Delete entry opens the confirmation; Cancel or successful delete dismisses it.
- Single owner: a Reanimated presence wrapper owns the contained scrim and confirmation card. The existing Edit Timer sheet remains mounted beneath it.
- Entrance/update/exit: scrim and card fade together with restrained scale only when motion is allowed; dismissal completes before unmount.
- Surrounding reflow: none; the underlying edit content keeps its exact layout and is non-interactive while contained confirmation is present.
- Interruption: repeated Delete taps cannot create multiple confirmations; Cancel restores the same editing state and focus path.
- Async outcomes: delete retains the existing optimistic mutation owner and error handling, with no new spinner.
- Reduce Motion: scale is removed; visibility, actions, focus, and errors remain.

### Review resolution

- Trigger: a successful Confirm or Ignore response resolves one review item.
- Single owner: React owns request ordering and error state; the shared Reanimated local primitive owns only the successful card exit and list reflow.
- Entrance/update/exit: initial loading is unchanged; successful resolution fades the exact keyed card out. Errors leave the card in place and remain textual.
- Surrounding reflow: remaining stable-key cards close the gap with one local layout owner.
- Interruption: only the affected card is disabled while its request is active; other items preserve their identity and order.
- Async outcomes: removal occurs only after success. Failure preserves the item and current error behaviour, without a spinner or optimistic disappearance.
- Reduce Motion: removal and reflow become immediate or opacity-only while semantic status remains.

### Places mutations and local notices

- Trigger: successful saved-place delete, learned-place Ignore/Forget, or transient copy/status feedback.
- Single owner: React and the API retain mutation ordering; the shared Reanimated primitive owns the affected keyed list item and local notice only. Existing full-screen/native presentation owners are unchanged.
- Entrance/update/exit: successful mutations remove only the affected row/candidate; copy/status notices fade in and out without shifting unrelated content unexpectedly.
- Surrounding reflow: only sibling place/candidate rows close the vacated space. Existing add/edit form transitions remain outside this owner.
- Interruption: mutation controls remain scoped to their existing busy item; stale local-notice callbacks cannot clear a newer notice.
- Async outcomes: rows remain until API success. Errors retain the row and current error copy. Delete/Ignore/Forget ordering is preserved.
- Reduce Motion: list state and notices remain, with immediate or opacity-only continuity and no decorative movement.

## Implementation outcome

- `DayframeDashboard` retains `ReanimatedSwipeable` as the Today direct-manipulation owner and adds stable-key Reanimated presence/layout transitions for individual rows, grouped rows, expanded children, restoration, list reflow, and the inverse Undo bean.
- A tokenized five-second deletion coordinator makes rapid consecutive deletion deterministic: the older deletion commits before the newer window begins, Undo targets only the current token, stale callbacks are ignored, and dashboard unmount disposes the outstanding timer.
- `FloatingDatePicker` now owns its local overlay/sheet presence and restrained keyed month crossfade. `DeleteEntryConfirmation` animates only its contained Edit Timer presentation; the full-screen modal keeps its established owner.
- Review and Places keep rows mounted until API success, then animate the exact stable-key removal and sibling reflow. Failure leaves the item in place. Places copy feedback is an overlaid, tokenized live notice so it does not reflow unrelated content and an older timeout cannot clear newer copy.
- The implementation stays in React Native/Reanimated because all changed transitions are ordinary local presence or list layout changes and the existing swipe already proves the UI-thread gesture stack is sufficient. No evidence justified a Swift owner.

## Automated and native validation

Run on 18 July 2026 from `agent/ios-motion-consistency`:

- `npm run typecheck -w @dayframe/mobile` — passed.
- `npm run test -w @dayframe/mobile` — passed: 24 files, 192 tests.
- `npm run lint` — passed.
- `npm run typecheck` — passed for mobile, web, and shared workspaces.
- `npm run test` — passed: mobile 192, web 143, shared 56; 391 tests total.
- `npm run build` — passed; the Next.js production build completed and generated 20 static pages.
- `npm run check:brand-assets` — passed.
- `git diff --check` — passed before the native build; it must be repeated after final documentation changes.
- `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild -workspace apps/mobile/ios/Dayframe.xcworkspace -scheme Dayframe -configuration Debug -destination 'platform=iOS Simulator,id=CF4A2B85-B714-4985-B9AA-8CE669BA78F6' build` — passed with `** BUILD SUCCEEDED **` on the iPhone 17 Pro iOS 26.5 simulator destination.

CocoaPods was not reinstalled because no native dependency or autolinking state changed. `Podfile.lock` remains untouched.

## Simulator evidence and remaining blockers

Authenticated local dev-auth testing on the iPhone 17 Pro iOS 26.5 simulator produced ignored QA recordings under `.codex-dayframe-qa/motion-consistency/normal/`:

- `date-picker-and-contained-confirmation.mp4` covers Today group expansion, date-picker entrance, previous/next month continuity, dismissal, and contained Edit Timer confirmation entrance/cancel. The underlying Edit Timer layout remained mounted.
- `review-confirm-removal-valid.mp4` covers a successful Review Confirm removal from a two-card list and surrounding reflow. A separate failure exercise kept the invalid card in place and showed the existing error.

The following evidence is still required and is not claimed as passed:

- Post-adjustment Places copy feedback and destructive delete/ignore/forget recordings.
- Today individual, grouped, expanded-child, and blank-row direct swipe deletion; Undo, five-second expiry, rapid consecutive deletion, offline rollback, and vertical-scroll arbitration. The computer-control drag did not produce a reliable swipe, and the Mac locked again before another capture could be inspected.
- Date selection, Review Dismiss, Edit Timer successful delete, timer start/stop/edit/delete regressions, tab and push/back/swipe-back regressions, and native Calendar scroll/day/pinch regressions.
- System/Light/Dark, Reduce Motion, Dynamic Type, VoiceOver, and Reduce Transparency passes. The completed post-change recordings are normal-motion Light only.
- Physical-iPhone direct manipulation, native-transition, and frame-pacing validation. `devicectl` found one paired physical iPad Pro 10.5-inch but no physical iPhone; the iPad does not satisfy the required iPhone check. Xcode performance tooling was therefore not used.

Until the Mac is unlocked and a physical iPhone is available, this investigation remains a Watch item and the overall task must not be described as complete.

## Boundaries confirmed

Inspection and the final diff keep the API and web runtime behaviour, Supabase migrations, Vercel configuration, native navigation/tabs, Active Timer sheet owner, and SwiftUI Calendar ownership/data boundary unchanged.

- Post-change simulator recordings for every changed presence/list transition.
- Normal and Reduce Motion checks across System, Light, and Dark, Dynamic Type, VoiceOver, and relevant Reduce Transparency states.
- A full repository-supported native iOS build.
- Direct manipulation and frame-pacing validation on a physical iPhone. No physical iPhone was discoverable during the baseline pass, so completion cannot be claimed until one is available.
