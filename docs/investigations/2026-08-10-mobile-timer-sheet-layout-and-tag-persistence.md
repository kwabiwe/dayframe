# Mobile timer-sheet layout and tag persistence

## Scope and baseline

This follow-up starts from `origin/main` at
`c2a91c6b6ecaefe8f18dda1ae9c87b4cd2ffaa41`, the merge of PR #163 and the
source shipped as internal TestFlight `0.1.0 (88)`. It is limited to the shared
Running Timer, Completed Entry Edit, Add Past Time and Review-edit sheet:

- remove the heading separator from Tags and Suggestions;
- persist a newly created tag independently of the time-entry draft;
- replace vertical form scrolling with one density-adaptive fixed layout;
- relocate time and duration actions according to the field they affect;
- keep Suggestions closed when deleting the only hashtag leaves Description
  empty; and
- return the native dial's rectangular outer whitespace to the sheet drag
  gesture without making the visible dial part of dismissal.

No database migration, API-schema replacement, production deployment, merge or
TestFlight upload is part of this draft.

## Evidence and root causes

### New tags were draft-only

`ActiveTimerEditSheet` consumed a new hashtag into `selectedTagNames`, but it
never called the existing tag API. The tag row was created later only as a side
effect of Save/Done synchronising `tagNames` onto a time entry. Discarding the
draft therefore discarded the only path that wrote the tag.

The hosted API already has the correct idempotent boundary: `POST /api/tags`
normalises the name and converges concurrent workspace-scoped creates onto one
row. Mobile now calls that route at the Create action, merges the returned row
into the current bootstrap catalogue, and keeps the call alive independently
of sheet dismissal. Time-entry Save may safely race it because the server path
is idempotent.

### Empty Suggestions briefly reopened

When `#` was deleted, the tag reducer correctly made the hashtag inactive. The
sheet reducer reconciled that event against the previous non-empty suggestion
count before the result effect published the now-empty query. It could
therefore enter `opening`, then close one render later.

The native text-change event now suppresses Suggestions synchronously when an
edit leaves Description empty, before the result effect can reconcile the old
count. A later non-empty edit releases that suppression and retains the
existing dynamic ranking and panel update path. Initial sheet presentations
keep their existing curated-history behaviour; this change is scoped to the
awkward empty transition during active editing.

### Scrolling was a reachability workaround

PR #163 deliberately enabled the form `ScrollView` whenever Delete existed so
an early fitting measurement could not strand the action below the viewport.
That solved reachability but made Delete depend on a scroll interaction.

The form is now non-scrolling. Standard-height devices keep the established
geometry; compact height or large Dynamic Type selects a bounded compact or
condensed spacing/dial height. Field-specific actions occupy the existing
whitespace above the visible ring, Round Duration moves inside a stopped dial,
and Delete follows the dial directly. Keyboard inset no longer adds scroll
padding; lower controls may be occluded until the keyboard is dismissed.

### The dial owned a rectangular hit box

The visible native control is circular, but `DayframeDurationDialExpoView`
accepted its full rectangular bounds and the wrapping native gesture blocked
the sheet pan for that whole area. Native hit testing now accepts only the
circle required by the ring plus its 44-point adjustable handles. Rectangular
corner whitespace falls through to the existing sheet pan. The ring/handle
region and the inside Round Duration action each continue to block the sheet
dismiss gesture.

## Layout contract

- **Running:** keep the hero, Start/End row and dial sequence; show
  `SET TO LAST STOP TIME` as unfilled text under Start when eligible; omit Round
  Duration; place Delete directly below the dial.
- **Completed/Add:** show Set to last stop time under Start when eligible; show
  `ROUND STOP TIME` as unfilled text under End; show Round Duration inside the
  dial below its duration; place Delete below the dial where that sheet owns a
  destructive/discard action.
- **Panels:** retain the framed raised surface, muted heading, rounded corners
  and inset result-row dividers; remove only the separator immediately below
  each heading.
- **Scrolling:** the timer form itself never scrolls. Horizontal Category and
  bounded Tags/Suggestions result scrolling remain controls within the fixed
  sheet, not sheet scrolling.

## Motion, focus and gesture contract

| Interaction | Owner | Contract |
| --- | --- | --- |
| Type or delete `#` | Native Description responder plus sheet reducer | Keyboard/focus remain continuous. Empty Description closes both panels and cannot reopen Suggestions; later matching text uses the existing 140 ms update path. |
| Create a tag | Existing tag row press plus caller-owned API mutation | Selection is immediate with no spinner or layout shift. The independent idempotent API call survives dismissal. Failure restores the hashtag only when the user has not typed something newer. |
| Change device height/Dynamic Type | React fixed-layout density | Geometry changes with the next render and has no separate animation owner. Standard geometry remains unchanged; compact/condensed layouts reduce spacing and dial height. |
| Drag outer dial whitespace | `SwipeDismissSheet` | The existing continuous sheet pan owns the drag, interruption, dirty-draft veto and Reduce Motion exit. |
| Adjust the visible dial | Native duration dial | The ring/handles remain native direct manipulation and block sheet dismissal. Cancellation restores the interaction snapshot. |
| Press Round Duration inside the dial | React action with a native gesture blocker | The action rounds once and never starts sheet dismissal. |

Async tag creation has no Undo path. Concurrent create/entry-save converges on
the existing server constraint. VoiceOver receives the existing create-row
label plus a failure announcement; Reduce Motion changes no persistence or
focus outcome.

## Validation plan

- focused mobile API, tag, reducer, layout and gesture-contract tests;
- full mobile and repository test suites plus all TypeScript checks and lint;
- Swift package tests for dial hit ownership;
- clean iOS Simulator build and the production-component sheet QA route;
- Running, Completed and Add layouts at small and current large iPhone sizes;
- typed/Add-a-tag creation followed by discard and bootstrap verification;
- delete-`#` keyboard/focus continuity and no empty Suggestions reopen;
- outer-whitespace sheet drag versus ring/handle adjustment in normal and
  Reduce Motion.

Physical-iPhone gesture feel and keyboard frame pacing remain required before
merge; Simulator/source/unit evidence will not be relabelled as device proof.
