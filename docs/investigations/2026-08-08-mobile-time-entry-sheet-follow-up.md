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
- restore tag suggestions from both Add a tag and a manually typed `#`;
- harden the chooser after physical-device testing exposed late native
  selection/blur events;
- remove the transient blank active-timer card after Delete; and
- unify the Tags and Suggestions panel framing.

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

### Tag suggestions and keyboard reliability

Two interacting causes were present:

1. Description used a controlled selection but updated it only from the later
   native selection event. After typing `#`, React could briefly restore the
   old caret, leaving `findActiveHashtag` with no active query.
2. Add a tag inserted `#` and requested focus, but the chooser depended only on
   reducer focus. A blur/refocus event coalesced by UIKit could therefore leave
   the command visible without mounting its suggestions.

The first follow-up derived the new caret from the text delta and bridged the
short native focus handoff with a Boolean intent. Physical-device testing then
showed two remaining ordering failures:

1. a delayed native selection event could echo the old caret after React had
   already committed the new text/caret, making the active hashtag disappear;
2. UIKit could deliver blur after Add a tag's press callback, clearing the
   Boolean intent before the chooser/focus handoff settled.

The final fix keeps authoritative Description text and selection in synchronous
refs, rejects only the known stale caret echo, and owns tag entry with a
presentation-scoped reducer plus monotonic focus request IDs. An unexpected
blur while a hashtag is active requests a newer bounded focus recovery instead
of clearing the chooser. Recovery verifies both native focus and visible
keyboard metrics, retries for at most three frames, and performs one guarded
blur/refocus only for the focused-without-keyboard responder race. Explicit
background/dismiss/cancel paths invalidate pending requests, and cancellation
also releases any temporary blur suppression.

### Deleted active-timer flash

Optimistic Delete correctly removed `data.activeEntry`, but
`presentedActiveEntry` deliberately retained the old entry until the editor's
coordinated exit completed. Today reused that presentation snapshot for the
dashboard card, so it briefly rendered the retained blank timer as `Add a task
description` before the delayed cleanup.

The dashboard and sheet now have separate presentation inputs. The sheet keeps
the retained entry and elapsed value for a coherent exit, while a pure
dashboard selector immediately excludes any entry whose ID belongs to the
pending deletion. The idle Today state is therefore already behind the exiting
sheet, with no intermediate blank card.

### Tags and Suggestions visual language

Both overlays now use the same compact framed surface: raised neutral body,
one-point strong outline, 14-point corners, filled muted heading, and inset
one-point dividers that stop 12 points from each side. The change uses the
existing semantic theme roles in both appearances and preserves each overlay's
current geometry and scrolling behavior.

## Motion and gesture contract

| Interaction | Owner | Contract |
| --- | --- | --- |
| Drag Play, Stop or range dot | Native duration dial | Direct manipulation remains native; the sheet pan must wait and never translate. |
| Swipe non-control sheet background/handle | `SwipeDismissSheet` | Existing threshold, keyboard handoff, return spring and committed exit remain unchanged. |
| Dirty swipe dismissal | Sheet draft guard + native alert | The sheet returns to rest; one alert offers Keep editing or Discard. |
| Tag chooser | Description field + tag-session reducer | Existing 140 ms bounded entrance remains; focus recovery is request-scoped and cancelled on exit; Reduce Motion uses the existing no-translation path. |
| Delete active timer | Dashboard + coordinated sheet exit | Today switches directly to idle while the sheet retains its snapshot only for exit; no blank active card is mounted between those states. |
| Content overflow | Form `ScrollView` | No animation or geometry change when content fits; scrolling is enabled only when compact, accessible or measured overflow requires it. |

## Validation

| Check | Result |
| --- | --- |
| Focused gesture/draft/tag/Add/delete tests | Pass: 128 tests across 6 files |
| Full mobile test suite | Pass: 62 files / 608 tests |
| Mobile TypeScript typecheck | Pass |
| `git diff --check` | Pass |
| Simulator/XCUITest/animation stress | Not run; explicitly outside the requested follow-up workflow |

Physical-device acceptance remains appropriate for the exact dial-versus-sheet
gesture overlap, Delete reachability, native discard alert and keyboard/tag
chooser behavior.

## Merge and TestFlight release

On 2026-08-09, PR #161 was merged first with merge commit `33a9d95`, then PR
#162 was retargeted from the PR #161 branch to `main`, marked ready and merged
with merge commit `91380dc`. GitHub reported both pull requests clean and
mergeable with all checks passing; no open pull requests remained after the
sequence. Vercel also completed the production deployment for `91380dc`.

The exact merged source at `91380dc` passed the following post-merge checks:

- 172 test files / 1,463 tests across mobile, web and shared workspaces;
- all TypeScript typechecks and lint, including the iOS configuration check;
- the brand-assets check and `git diff --check`; and
- a production web build using Webpack.

The standard Turbopack command encountered its known clean-worktree limitation
because the worktree's root `node_modules` symlink resolves outside the
filesystem root. This was an environment-only panic; the supported production
Webpack build completed successfully from the same source.

TestFlight `0.1.0 (87)` was archived with build number 87 and the production API
base `https://dayframe-web.vercel.app`, exported with App Store distribution
profiles, and uploaded under delivery/build ID
`74bc9ab3-acb0-46da-8f13-820547f81806`. App Store Connect reports `VALID`,
export compliance false and `IN_BETA_TESTING` through the internal
`Internal Health Debug` group. The app and Live Activity extension both carry
build 87, `get-task-allow=false` and `beta-reports-active=true`; en-GB testing
notes describe the time-entry, tag, deletion-flash and panel-style changes.
