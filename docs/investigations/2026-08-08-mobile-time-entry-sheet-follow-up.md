# Mobile time-entry sheet follow-up

## Scope and baseline

This follow-up is stacked on PR #161 at exact commit
`f68c89d809520aab4be172a165cb1d72a78eea16`, the source shipped as internal
TestFlight `0.1.0 (86)`. It is draft PR #162 and intentionally leaves PR #161
unchanged and unmerged.

The requested fixes are limited to the shared iOS time-entry sheets:

- keep the duration dial's handles and range dot from dragging the sheet;
- restore a reachable Delete action without compressing the standard layout;
- confirm before discarding genuinely edited drafts;
- default Add Past Time to 30 minutes ending now;
- restore tag suggestions from both Add a tag and a manually typed `#`.

## Findings

### Duration dial gesture ownership

Two plausible causes were checked:

1. The native dial might be emitting discontinuous pan values. The native module
   already owns one `UIPanGestureRecognizer`, snapshots each interaction and
   reports accumulated relative movement, so this did not explain the sheet
   moving.
2. The React Native sheet pan might still be eligible over the native dial.
   Source inspection confirmed this: `SwipeDismissSheet` wrapped the entire
   surface in one pan recognizer while the dial only used
   `disallowInterruption(true)`. That stops an active dial gesture being
   interrupted but does not make the parent sheet pan wait for the dial.

The fix gives the sheet pan a Gesture Handler ref and makes the native dial
block that external gesture. This covers the whole native dial hit area,
including Play, Stop and the constant-duration dot, without moving pan updates
through JavaScript.

### Delete visibility

The running editor still received `onDelete` and still rendered the Delete
button after the dial. The action was below the visible viewport because form
scrolling was decided only by a coarse device-height/font-scale threshold.
The completed editor happened to fit.

The form now measures its viewport and content. Standard layouts remain fixed
when everything fits; compact, accessibility or genuinely overflowing content
gets bounded internal scrolling so Delete can be revealed. Add Past Time also
shows the same bottom Delete action; because its entry is still a local draft,
that action uses the discard path rather than calling the persistence delete
API.

### Unsaved changes

There was no immutable presentation-scoped draft baseline, so every user exit
was committed immediately. The sheet now snapshots Description, Category,
Tags, Start and—only for stopped/add modes—End. A native confirmation offers
Keep editing or Discard when those values differ.

The running timer's live End/elapsed value is intentionally excluded, so clock
ticks alone never create a false warning. Successful Save, Stop, Delete and
caller-owned dismissals use one scoped bypass and cannot be blocked by the
draft guard. A swipe veto returns the sheet to rest before the alert is shown.

### Add Past Time default

The Plus path previously substituted an active timer's start for End and could
substitute a recent stop for Start. It now captures `Date.now()` at the tap,
sets End to that instant and Start to exactly 30 minutes earlier. The existing
Set to last stop time quick action remains available.

### Tag suggestions

Two interacting causes were present:

1. Description used a controlled selection but updated it only from the later
   native selection event. After typing `#`, React could briefly restore the
   old caret, leaving `findActiveHashtag` with no active query.
2. Add a tag inserted `#` and requested focus, but the chooser depended only on
   reducer focus. A blur/refocus event coalesced by UIKit could therefore leave
   the command visible without mounting its suggestions.

The text-change path now derives the new caret from the text delta, while an
explicit hashtag-entry intent bridges the short native focus handoff. Blur,
background interaction and selection clear that intent deterministically.

## Motion and gesture contract

| Interaction | Owner | Contract |
| --- | --- | --- |
| Drag Play, Stop or range dot | Native duration dial | Direct manipulation remains native; the sheet pan must wait and never translate. |
| Swipe non-control sheet background/handle | `SwipeDismissSheet` | Existing threshold, keyboard handoff, return spring and committed exit remain unchanged. |
| Dirty swipe dismissal | Sheet draft guard + native alert | The sheet returns to rest; one alert offers Keep editing or Discard. |
| Tag chooser | Description field | Existing 140 ms bounded entrance remains; Reduce Motion uses the existing no-translation path. |
| Content overflow | Form `ScrollView` | No animation or geometry change when content fits; scrolling is enabled only when compact, accessible or measured overflow requires it. |

## Validation

| Check | Result |
| --- | --- |
| Focused gesture/draft/tag/Add tests | Pass: 39 tests across 5 files |
| Full mobile test suite | Pass: 61 files / 601 tests |
| Mobile TypeScript typecheck | Pass |
| `git diff --check` | Pass |
| Simulator/XCUITest/animation stress | Not run; explicitly outside the requested follow-up workflow |

Physical-device acceptance remains appropriate for the exact dial-versus-sheet
gesture overlap, Delete reachability, native discard alert and keyboard/tag
chooser behavior.
