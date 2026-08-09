# Mobile timer tag keyboard and Delete follow-up

## Scope and baseline

This follow-up starts from `origin/main` at
`8b3e06fe9cb959b192407a936413a5cc16cd385e`, after PRs #161 and #162 were
merged and exact source `91380dc` shipped in internal TestFlight `0.1.0 (87)`.
It is limited to four physical-device reports from that build:

- typing `#` briefly lowers and restores the iOS keyboard before Tags appears;
- deleting that `#` dismisses the keyboard and removes Description focus;
- the first matching tag (`A24` in the report) has a persistent grey fill even
  though only the Tags heading should be filled; and
- the running-timer sheet can leave Delete below an unreachable bottom edge on
  a larger iPhone.

No API, persistence, database, production deployment, merge or TestFlight
change is part of this draft.

## Findings

### Keyboard continuity while entering Tags

The visible keyboard dip was deterministic from source, not a slow tag query.
Large-screen XCUITest reproduced a native blur during both transitions between
the historical Suggestions overlay and the tag chooser. Both absolute
ScrollView subtrees were conditionally inserted or removed around the focused
Description tree. PR #162's recovery effect then inspected
`Keyboard.metrics()`; if UIKit transiently reported no metrics while
Description still owned first responder, it deliberately called `input.blur()`
and then `input.focus()` on the next frame. Together those paths made internal
view/responder bookkeeping visible.

Description also kept React Native's `selection` prop controlled on every
keystroke. That was useful for rejecting an old native caret echo, but it gave
React another opportunity to perturb native selection during the same overlay
commit.

Both overlay trees now stay resident after Description geometry exists. Their
closed states are accessibility-hidden and pointer-disabled, so typing and
deleting `#` only change existing animation values and content rather than
reconstructing native ScrollView subtrees around first responder. The fix also
treats `TextInput.isFocused()` as authoritative during tag recovery and never
blurs an already focused field because keyboard metrics are temporarily absent.
Because UIKit can still emit a transient native blur while the two resident
overlays exchange visibility, the active tag session retains a bounded 500 ms
continuity lease when the query is removed. That one blur is reacquired
synchronously at the native event boundary; explicit background/control,
dismissal and presentation-cancellation paths invalidate the lease first.
Native typing now owns the caret normally. Only programmatic edits—Add a tag
and consuming a tag—supply a controlled selection for one committed frame,
while a bounded 500 ms guard rejects only the exact known old-caret echo.

### Deleting the hashtag

When `#` became inactive, the tag-session reducer hid the chooser but retained
an in-flight monotonic focus request. A late frame or blur from that request
could therefore run after the user had removed the query, producing the
reported loss of focus.

An inactive hashtag now clears the pending request and advances its generation
when cancellation is required. Any already queued frame fails the request-ID
check, while Description remains first responder and native caret owner.

### Grey `A24` row

The panel initialized `highlightedTagAction` to the first match and animated
that row to `surfaceMuted`. With `A24` first, the row looked like a second grey
heading even without touch or keyboard navigation.

That persistent default highlight is removed. The Tags heading remains the
only muted fill; rows use the raised panel body and existing transient pressed
feedback, with the same inset dividers and outline introduced in PR #162.

### Running-sheet Delete reachability

The option was not removed by either merge. `DayframeDashboard` still passes
`deleteActiveTimer` to the running `ActiveTimerEditSheet`, and the sheet still
renders its bottom Delete action whenever `onDelete` exists. Its absence in the
iPhone screenshot is therefore a viewport/reachability defect, not a missing
callback or conditional feature.

The previous scroll decision depended on compact height, Dynamic Type or
measured overflow. It ignored keyboard occlusion, and a fitting/stale first
measurement could disable the `ScrollView` even though Delete sat below the
dial and the visible bottom edge. Device height changes which content is
initially visible, so this can differ between the earlier iPhone 11 run and a
larger iPhone without changing the rendered action.

Keyboard occlusion now makes the form scrollable, and every sheet with a bottom
Delete action keeps scrolling enabled. Bounce remains disabled when the form
genuinely fits, so standard geometry does not drift; the change only guarantees
that the existing bottom action can be reached. Each presentation resets to
the top so scroll position cannot leak between entries.

## Motion, focus and layout contract

| Interaction | Owner | Contract |
| --- | --- | --- |
| Type or delete `#` | Native `TextInput` responder/caret | The keyboard and Description focus stay continuous. No tag-session path may force blur; stale requests cancel by generation. |
| Open or close Tags | Existing Description-local overlay | Retain the established 140 ms panel presence treatment and stable sheet geometry. Reduce Motion keeps the existing no-translation path. |
| Press a tag row | Existing `Pressable` | Only transient pressed feedback applies. No row starts with persistent selection fill. |
| Reveal bottom Delete | Form `ScrollView` | Scrolling is the single layout owner. The dial and action keep their current order and geometry; a fitting form does not bounce. |
| Rapid query change, dismissal or navigation | Presentation/tag request IDs | Old focus frames and caret acknowledgements cannot restore a removed hashtag or affect a newer presentation. |

There is no async mutation or rollback change. VoiceOver labels, the 44-point
row targets, Dynamic Type overflow handling and the existing Delete mutation
path remain unchanged.

## Regression coverage

- Reducer tests cover cancellation of an in-flight focus recovery when the
  hashtag is deleted.
- Caret/contract tests prohibit forced blur in tag recovery, continuous
  controlled native typing, and persistent first-row muted fill.
- Layout tests cover keyboard occlusion at a large-iPhone viewport and require
  bottom-action sheets to keep scrolling enabled.
- The native QA harness includes a tag reliability journey that types and
  deletes `#`, checks focus/keyboard/tag-panel telemetry continuously, verifies
  the `A24` row exists, then repeats entry through Add a tag.
- A running-fixture QA journey scrolls to and invokes the existing Delete
  action on the large-screen Simulator.

## Validation

| Check | Result |
| --- | --- |
| Focused tag/session/caret/layout/overlay contracts | Pass: 5 files / 39 tests |
| Full mobile suite | Pass: 62 files / 610 tests |
| Full repository suite | Pass: 172 files / 1,465 tests |
| Mobile, web and shared TypeScript | Pass |
| ESLint and iOS configuration contract | Pass |
| Brand-assets contract and `git diff --check` | Pass |
| Swift QA source parse | Pass |
| iPhone 17 Pro Max Simulator, iOS 26.5 | Pass: typed-`#`, delete-`#`, Add a tag, repeated delete, continuous keyboard/focus sampling, explicit focus release, and running Delete reachability/action |

The first current-source Simulator run deliberately exposed the remaining
delete-time blur and drove the synchronous continuity lease; the frozen run
then passed both dedicated XCUITests. The simulator environment initially
resolved Expo Router through another worktree's shared `node_modules` symlink;
that run was discarded, dependencies were given worktree-local paths, and all
reported Simulator evidence above comes from the correct follow-up source.

The physical iPhone 11 and iPhone 17 Pro devices were offline during
implementation. Source confirms that build 87 still passed and rendered the
running Delete action, while the large-screen Simulator proves the corrected
reachability path. Exact physical keyboard animation/frame pacing and the
iPhone 17 Pro viewport remain the explicit acceptance checks after installing
the draft build; they are not inferred from Simulator results.
