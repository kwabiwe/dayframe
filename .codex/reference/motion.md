# Interaction Motion

Use this reference whenever a feature introduces or changes navigation, a sheet or overlay, a gesture, list insertion/removal/reordering, expanding content, progress or status feedback, an Undo path, or any other visible movement.

## Product Requirement

Motion must make state changes feel continuous and causally connected across Dayframe. A feature is not visually complete when its gesture is smooth but the resulting content, feedback, rollback, or dismissal appears or disappears abruptly.

Consistency means using the same semantic motion language, durations, accessibility behaviour, and ownership rules. It does not mean forcing every platform surface through the same animation library. Native navigation should remain native; local React Native state changes should use a local UI-thread transition; a targeted Swift surface should stay native only when the interaction genuinely requires native ownership.

## Required Motion Contract

Before implementing a moving interaction, record a short motion contract in the investigation note or PR description:

- trigger: the user or system action that starts the change
- owner: the single layer responsible for the animation
- entrance/update/exit: how new, changed, and removed content behaves
- surrounding layout: how adjacent content reflows rather than jumps
- interruption: what happens after rapid repeat actions, dismissal, navigation, or gesture cancellation
- async outcome: optimistic state, success, Undo, timeout, and failure rollback where applicable
- accessibility: Reduce Motion, VoiceOver/focus continuity, Dynamic Type, and Reduce Transparency where relevant

If one of these states does not apply, say so. Do not leave it implicit.

## Ownership Rules

| Interaction | Preferred owner |
| --- | --- |
| Screen push, pop, and interactive back | Expo Router/native stack using the shared theme canvas |
| Primary tab changes | Native tab controller |
| Existing full-screen or bottom sheet | The established React Native/native modal or sheet owner |
| Local notice, menu, picker, confirmation, expansion, or list mutation | Reanimated/UI-thread presence and layout transition, or an existing shared motion primitive |
| Drag, swipe, pinch, scroll, or other direct manipulation | One gesture and animation owner that updates continuously with the fingers |
| Platform interaction that React Native cannot reproduce reliably | A targeted Swift/SwiftUI surface that preserves the documented React ownership boundary |

`LayoutAnimation`, including `Keyboard.scheduleLayoutAnimation`, does nothing in this app: with React Native 0.85 on the New Architecture, Reanimated 4's legacy layout-animation proxy (the default while `ENABLE_SHARED_ELEMENT_TRANSITIONS` is off) replaces the UIManager animation delegate, and its `uiManagerDidConfigureNextLayoutAnimation` is empty. Enabling that flag would revive React Native's driver, so revisit this rule if it is ever turned on. The old `scheduleLayoutTransition` helper and every call were removed on 7 October 2026, and `layoutAnimationRemoval.contract.test.ts` keeps them out. Never name it as the owner of a transition; use Reanimated `layout`, `entering` and `exiting` (the `localLayoutTransition` and presence helpers) instead.

Do not introduce Swift solely to make an otherwise ordinary React Native entrance, exit, or list reflow smooth. Do not animate the same state change from multiple layers.

## Timing And Behaviour

- Animations run on the UI thread. RN `Animated` values always use `useNativeDriver: true` (opacity and transforms); anything that needs layout uses Reanimated. A JS-thread animation drops frames exactly when the JS thread is busy, such as during Stop's outbox write and re-render (investigation 2026-10-07; `framePacing.contract.test.ts` enforces it).
- A native-driver animation does not update the JS-side `Animated.Value`. When a view may mount after the animation (a list header, a remounted section), set the final value in the completion callback; otherwise the late view starts from the stale JS value. Today's screen entrance fade left the whole header transparent this way (Simulator, 7 October 2026; `framePacing.contract.test.ts`).
- Do not rebuild per-minute data on the per-second clock. Today's history, the day cards and the native Calendar model read `minuteClock(now, newestShownTimestamp(entries, now))`, which holds still within a minute but never falls behind a start or stop already shown; only the live elapsed time ticks every second.
- On surfaces not yet migrated to Blocks, reuse `MOBILE_MOTION` on iOS: approximately 140 ms for control feedback, 220 ms for local layout, 260 ms for sheets, and 280 ms for screen transitions.
- On other unmigrated surfaces, follow the brand guide's 120–220 ms control and 180–300 ms panel ranges. On migrated Blocks surfaces the named springs below replace these durations for the moves they list; `MOBILE_MOTION` still covers whatever the springs do not list (presence fades, layout reflow, rollback). Prefer standard ease-out timing; exits may be shorter while staying in the same curve family.
- On surfaces not yet migrated to Blocks, keep movement restrained: opacity plus a small translation when it clarifies origin, with no theatrical scale, bounce or decorative loop. Migrated Blocks surfaces use the prototype motion vocabulary below.
- Direct manipulation must track the finger continuously and must not hand off to a separately rebuilt layout with a release-time snap.
- Animate both presence and consequence: the control or notice entering is not sufficient if the affected row, surrounding list, timeout dismissal, Undo restoration, or failure rollback still jumps.
- Preserve geometry during async work. Avoid loading UI that moves content when optimistic feedback is the established product contract.
- A second rapid action must either replace, queue, or merge with the current transition deterministically. Give timeout/Undo feedback a monotonically increasing token or equivalent stable identity, clear the superseded timer, and verify that stale timers, exits, or completion callbacks cannot dismiss or restore newer state.

## Dayframe Blocks Springs And Haptics

The owner approved the Blocks springs and haptics on 5 October 2026 and, on 7 October 2026, the full motion of the interactive prototype (`design/blocks/ios.html`, `web.html` and `onboarding.html` on the local `agent/dayframe-redesign-concept` branch; spring values in its `assets/blocks.js`). Migrated surfaces should move the way the prototype moves. That supersedes the earlier "landing spring and breathing ring only" limit. The per-surface sections further down (for example the Today Phase 2 contract) remain each surface's contract until the PR that rebuilds that surface to the prototype rewrites them. See `docs/brand-style-guide.md`, Dayframe Blocks.

Springs (starting values from the prototype; tune on a physical iPhone):

| Spring | Stiffness / damping | Used for |
| --- | --- | --- |
| `snap` | 560 / 38 | Controls, thumbs, press-down on the Play orb |
| `sheet` | 340 / 34 | Sheets, panels, pushed pages, and a sheet or page returning after a cancelled drag |
| `land` | 320 / 21 | A block landing (start, stop, log, restore, delete), with one small overshoot; a row, live card or Review card returning after a cancelled swipe |
| `pop` | 420 / 18 | Small celebratory pops: a row block or icon confirming a change, bloom tiles, the "All framed" heading |
| `roll` | 260 / 26 | Odometer digits on the live timer |

Prototype moves allowed on migrated surfaces:

- **Drop-in.** Tiles and blocks drop into place on first paint and when Review is finished ("All framed"), with a short stagger (the prototype uses about 35–90 ms per item).
- **Pop.** A changed block or icon scales from about 0.6–1.5 back to rest with `pop`.
- **Rolling digits.** The live timer's changing digits roll with `roll`; unchanged digits stay still.
- **Stop flight.** On Stop the live block shrinks and flies into its row in Today's list (the prototype uses 620 ms, `cubic-bezier(.3,.7,.2,1)`), then the row block pops and the row briefly highlights.
- **Swipes and throws.** Rows swipe (right: Start again; left: Delete) and Review cards throw off-screen with LOG IT / SKIP stamps, tracking the finger and rotating slightly; a released row or card that does not commit springs back with `land`.
- **Bloom.** Holding the Play orb for about 360 ms opens the activity bloom; its tiles fly out from the orb with `pop`, staggered by about 18 ms.
- **Breathing ring.** Only the single live block carries it: an opacity-only cycle of about 2.4 s on its inner edge.
- **Block pull-to-refresh.** The refresh indicator is a row of six small blocks that pulse while a deliberate pull refreshes.

Still not allowed: glows, confetti, parallax, motion that loops while nothing is happening (other than the live ring and an active pull-to-refresh), and any landing, pop, flight or other celebratory motion on a background refresh, reconciliation, hydration or rollback. Those still use the ordinary presence and layout transitions, so a rollback or Undo restoration never jumps.

The ownership rules above still apply. Each spring belongs to the same single animation owner as the state change, runs on the UI thread (Reanimated, or a native surface where this reference already allows one), and never stacks with another layer's transition. Direct manipulation (swipes, card throws, the bloom, the duration dial, ribbon scrubbing) has one gesture owner that tracks the finger continuously.

Haptics:

| Moment | Haptic |
| --- | --- |
| Start | Medium impact |
| Stop | One composite haptic, scheduled once: success, then a soft impact as the block lands |
| Scrub a time, or spin the duration dial | Selection tick per minute or entry |
| Log or skip a Review item | Success, or a light impact |
| Delete | Warning |
| Undo that restores an entry | Light impact |

- Haptics confirm a committed action. They never fire for a background refresh, a reconciliation, an automatic failure rollback or a rejected gesture.
- Rapid repeats fire one haptic, or one composite sequence, per committed action.
- A Settings switch turns haptics off. The system haptics setting always wins.
- Haptics are never the only feedback: the visible state change, Undo and VoiceOver announcement still happen.
- Web has no haptics; the same moments use the landing motion only.

Reduce Motion replaces every spring, drop-in, pop, rolling digit, flight, throw, bloom fly-out and the breathing ring with an opacity change or an immediate state change. It keeps the same states, haptics, Undo and announcements; swipe and bloom gestures still work and VoiceOver has an equivalent action for each.

## Reduce Motion And Accessibility

- Read the system Reduce Motion preference through the existing app helpers or the animation library's system mode.
- Remove nonessential translation, scale, parallax, spring effects and the Blocks prototype moves (drop-ins, pops, rolling digits, flights, throws, the bloom fly-out and the breathing ring) when Reduce Motion is enabled. Use an immediate state change or restrained opacity only when needed to preserve context.
- Never suppress the state change, Undo opportunity, error, focus move, or VoiceOver announcement merely because motion is reduced.
- Do not use animation as the only explanation of what changed.
- Check that Dynamic Type does not change measured geometry in a way that clips or snaps during a transition.

## Validation And PR Evidence

Every PR that adds or changes movement must include:

- the motion contract and chosen owner
- comparison with the nearest existing Dayframe interaction pattern
- normal-motion and Reduce Motion checks for entrance, update, exit, cancellation, and async rollback states that apply
- rapid-repeat and interrupted-interaction checks
- Dynamic Type and VoiceOver checks when content, focus, or announcements change
- a simulator recording for ordinary presence/layout motion, or a physical-iPhone recording when direct manipulation, native surfaces, frame pacing, background behaviour, or device-only APIs matter
- an explicit note for any validation that could not be run; screenshots alone do not prove motion quality

Tests should protect state ordering, timers, rollback, stable keys, and animation ownership where practical. Manual evidence remains required for continuity, gesture feel, and frame pacing.

## Today live block, landings and quick start (Blocks Phase 2)

Today on iPhone is the first migrated surface. `useBlockLanding` and `useBreathingRing` in `apps/mobile/src/lib/blocksMotion.ts` hold the springs and ring above. A committed Start (Play, a mosaic tile, a row's Start again) issues one tokenised landing request after the local start is accepted; the live block's content (chip, title, time) lands from 14 points below while the card, its ring and the Stop/Add past time track stay fixed. A committed Stop clears the live block's request (a rolled-back Stop must not replay the Start landing) and, in normal motion, flies the block into its row (the Stop flight below); under Reduce Motion, or when the live block cannot be measured, it issues one landing request for the stopped entry instead, and that row's activity block lands 60 ms later as the Stop composite's soft impact plays. Undo lands the restored rows. Requests expire after 1.2 s and are never issued by refresh, reconciliation, hydration or a rejected action, so remounts and cached bootstraps do not replay them; a second rapid action replaces the request.

Reanimated owns the Blocks transitions on Today. The card slot, the quick-start section and the Review nudge carry `localLayoutTransition`, so a card that grows (larger text, or a time that wraps the action reserve onto its own line on a narrow phone) and the content below it move rather than jump. Idle card and live block crossfade with the shared presence fades after first paint while the slot's layout transition carries the height change; with Reduce Motion they swap in place and the live content's 140 ms fade is the single opacity change. The landing animates only the translation of the block's inner content in normal motion (it starts at its offset on the first frame) and never the card, ring or actions. The existing RN `Animated` value `activeTimerExpansion` only fades the card's details and actions out during the retained Stop exit; on Start it is set to rest before the first paint, so it never stacks with the crossfade. Mosaic tiles are absolutely positioned, keyed by activity and each owns a `localLayoutTransition`, so whatever changes the totals (stop, switch, Add past time, edit, delete, Undo, Review, the midnight roll-over) the same tiles move and resize, and with Reduce Motion they settle at once; tiles drop in on the app's first paint only (step 2b-3 below) and otherwise fade in or out only when an activity is pinned or unpinned. Tile sizes come from the last seven calendar days and change only when entries change or the day rolls over, never on a timer tick. Haptics, Undo and announcements are unchanged under Reduce Motion.

## Anti-Patterns

Reports Revision 3 uses one fixed six-week calendar frame for month fades, not two
in-flow months. Outgoing calendar/row/donut visuals must cease interaction and
accessibility immediately. (The animated donut and its exit rules were replaced by
the static Blocks ring in step 10b; see "Reports donut and filter" below.) Category changes occur only through filter-sheet Apply;
informational rows/slices never move focus. Month fade copies are immediately
touch/AX hidden; queued taps validate the current generation, including A–B–A.
One bounded
tooltip moves/replaces locally and keeps its selection on live timer ticks;
dedicated outside presses and range/filter/focus/background changes dismiss it.
The screen root must not translate every bubbled touch into a reset key: vertical
scrolling and the plot/tooltip actions retain the current selection. Reduce
Motion and background settle current state without replaying the entrance.
Validate the complete transition and rapid interruption on an identified binary;
mock timing and screenshots alone do not establish smooth device motion.

Reports Revision 3.2 routes both date and category sheets through the shared
`SwipeDismissSheet` owner inside a transparent Modal with no native animation.
Normal motion couples the sheet's slide and scrim; Reduce Motion keeps the shared
restrained opacity path. Only the centred handle owns the pan, leaving calendar,
search and list scrolling independent. Done/Apply or a discard route claims one
terminal result for one presentation ID, makes outgoing controls inert, and keeps
the host mounted until the shared exit callback. The backdrop, escape (including
the accessibility escape gesture) and a successful swipe all discard; there is no
visible Cancel; rejected swipes retain the draft. Delayed callbacks
cannot release a newer presentation, and opener focus returns only after the
current exit. Test rapid Apply/swipe, double actions, interrupted entrance,
keyboard-open handle drag, rejected/accepted drags and reopen in normal and
reduced motion; a source contract or still frame is not physical gesture evidence.

- Conditionally mounting or removing a visible surface with no entrance or exit treatment.
- Animating a swiped row while leaving its action stationary or animating the action while the resulting list reflow jumps.
- Giving entrance motion to a notice but no exit, timeout, replacement, or Undo-restoration motion.
- Applying a global layout animation without confirming which subsequent state update it will capture.
- Combining native navigation, a JavaScript transform, and a local layout animation for one transition.
- Rewriting a smooth native route or sheet in Swift to repair an unrelated local React Native state change.
- Declaring motion complete from unit tests or still screenshots alone.

## Location Review status and durable actions

Optional detail status enters below the stable activity/time summary with the existing local presence/layout primitives; absence reserves no empty height. The native stack exclusively owns Back and post-commit dismissal. One SQLite commit accepts a resolving/structural action; its one/two source effects drive the existing card exit/reflow. Failed commit preserves the draft; permanent conflict restores only proven-open sources at surviving anchors. Cancel presentation-only prefetch and stale callbacks at Back/closing transition, without cancelling durable intent. Verify entrance/update/exit, rapid repeat, cancelled swipe, status replacement, rollback, keyboard focus and Reduce Motion (no travel, unchanged semantic result). No global spacing or navigation rewrite follows from removing this local gap.

## Today goal frame and Review nudge (Blocks parity step 2a-1)

- Trigger: entries change (start, stop, edit, delete, Undo, refresh) or the minute changes; the Review count changes.
- Owner: the goal frame has no animation of its own; its cells re-render on the per-minute clock (`minuteClock`), never on the 1 s tick. The nudge owns its presence with the shared Reanimated `entering`/`exiting` fades; its parent `Reanimated.View` (with `localLayoutTransition`) moves it with the timer card and mosaic above.
- Entrance/update/exit: no nudge entrance on first paint, hydration or a cached launch; a nudge that appears later (the first item arrives) fades in; a count change updates the text in place; the last decision fades it out while the layout transition closes the gap.
- Interruption: a count that drops to zero and returns before the fade completes remounts the same card with a fresh fade; nothing waits on a timer.
- Async outcome: the nudge follows the cached presentation or the bootstrap count; it never optimistically changes on its own.
- Accessibility: Reduce Motion shortens the fades (90/70 ms) and keeps the layout settle immediate; the goal frame is one VoiceOver summary below the date header; the nudge is one button with an "Opens Review" hint.

## Today's blocks rows (Blocks parity step 2a-2a)

- Trigger: a horizontal pan on a row (Start again or Delete), a tap (edit, or open a group), VoiceOver actions, and list changes from stop, delete, Undo or refresh.
- Owner: one `Gesture.Pan` per row (`TodayBlockRow`) drives a Reanimated shared offset on the UI thread; it activates only after 8 points sideways and fails after 10 points vertically, so the list keeps vertical scrolling. The underlay for the direction of travel shows under the row. List insertion, removal and reflow stay with the Reanimated presence fades and `localLayoutTransition` on each row and the card.
- Entrance/update/exit: crossing 96 points arms the action with one `tick` haptic (it needs both 96 points of this gesture's own travel and the row shown past 96 points) (and again when it disarms and re-arms). Releasing armed right springs the row home with `land` and starts the block (the Start path owns its haptic and landing). Releasing armed left flies the row off to the left in 180 ms and hands the entries to the Dashboard's deletion owner, which plays the delete haptic, removes the row (fade + layout reflow) and shows Undo; Undo brings the row back with the existing row landing. Releasing unarmed springs home.
- Interruption: a new pan on the same row takes over from the current offset. If the list still holds a deleted row 900 ms after its fly-out (for example the deletion was refused), it springs back home.
- Async outcome: deletion and Start are the Dashboard's existing optimistic owners; the row never waits for the network.
- Accessibility: Reduce Motion keeps the finger tracking (direct manipulation) but replaces the fly-out with an immediate hand-off and the spring with a 120 ms return; VoiceOver uses the row's "Start again"/"Switch to …" and "Delete" actions instead of swiping.

"Earlier this week" (2a-2b) moves with the rows above it under the shared layout transition (it is the list footer, not a cell, so it owns that transition) and adds no other animation: a tap plays the selection haptic and hands off to the native tab switch; its rows rebuild on the per-minute clock, never the 1 s tick, and change in place.

## Today ribbon (Blocks parity step 2a-3)

- Trigger: a horizontal drag or a tap on the strip; VoiceOver adjust/activate; the per-minute clock and entry changes.
- Owner: one `Gesture.Race(Pan, Tap)` on the strip. The pan activates after 4 points sideways and fails after 10 points vertically, so the list keeps vertical scrolling; it reports the finger to JS, which picks the block (`ribbonHitAt`), shows the tooltip and lifts the block. The tap opens the block under it. The strip is one SVG redrawn only when its model or the hit changes (memoised; never on the 1 s tick).
- Entrance/update/exit: the tooltip and the lifted block appear with the finger and disappear when it lifts or the gesture is cancelled; no fades, as in the prototype. Entering a different block while scrubbing plays one `tick`.
- Interruption: a cancelled pan clears the tooltip; a finger that moves 4 points sideways becomes a scrub (the pan wins the race) and one that moves more than 10 points vertically is neither a tap nor a scrub.
- Async outcome: none; opening hands off to the existing editors and Review routes.
- Accessibility: nothing moves under Reduce Motion beyond the finger-following tooltip; VoiceOver uses the adjustable element instead of scrubbing.

## Live block rolling timer (Blocks parity step 2b-1)

- Trigger: the 1 s timer tick changes a digit of the live block's `H:MM:SS` clock.
- Owner: `LiveOdometer`. Each digit is a fixed cell clipping a 0–9 strip; a Reanimated shared offset per digit moves its strip on the UI thread with the `roll` spring (260/26). Only digits whose value changed move; separators never move. Cells are keyed from the right, so when the hours gain a digit only the new leading cell mounts.
- Entrance/update/exit: no roll on mount (a card that appears, a remount, a cached launch or a switch to another entry, which remounts the odometer keyed on the entry's start time, shows the digits at rest; the queued Start's id swap keeps it); a changed digit rolls to its new value (9 → 0 rolls back through the strip, as in the prototype); the clock leaves with its card. A new cell size (Dynamic Type, or the clock shrinking to fit a narrower card) re-places the strips without rolling.
- Interruption: a digit that changes again mid-roll retargets its spring from where it is.
- Async outcome: none; the clock follows the displayed entry's elapsed time. A reconciled start time is a different start, so the odometer remounts at rest rather than rolling.
- Accessibility: Reduce Motion sets each digit in place. The odometer is hidden from VoiceOver; the live block's value speaks the elapsed time in words.

## Live block swipe to switch and the Switch sheet (Blocks parity step 2b-2)

- Trigger: a leftward pan on the running live block; VoiceOver's "Switch" action on it; a tap on a recent block in the sheet.
- Owner: one `Gesture.Pan` on the live block (`useLiveSwipe` in `TodayLiveBlock`) drives a Reanimated shared offset on the UI thread. It activates after 8 points sideways and fails after 10 points vertically, so Today keeps scrolling; a touch that starts on Add past time or Stop never becomes a swipe; and it is disabled while the block is only retained for the Stop exit. The card (with its ring and actions) follows the finger left only and tilts by offset/60 degrees; past 90 points it rubber-bands at 0.35 (`liveSwipeOffset`). A neutral "Switch" underlay shows behind it only while it is off its place. `SwipeDismissSheet` owns the sheet's presentation and exit.
- Entrance/update/exit: crossing 90 points of this gesture's own travel arms it with one `tick` (and again after disarming). Releasing springs the card home with `land`; releasing armed also opens the sheet. A pick starts that block through the Dashboard's existing Start owner (its haptic and landing) and dismisses the sheet; a second tap while it leaves does nothing.
- Interruption: a card grabbed while it springs home continues from where it is (the raw pull is kept apart from the banded offset, so the band applies once); a gesture the system cancels springs home and opens nothing. The sheet's list is taken when it opens, so it never reshuffles while it is up or leaving; logout closes it.
- Async outcome: none of its own; Start is the Dashboard's optimistic owner.
- Accessibility: Reduce Motion keeps the finger tracking without the tilt and returns in 120 ms; the sheet uses the shared Reduce Motion path. VoiceOver uses the block's "Switch" action; each recent is one button ("Switch to Deep work, Work, yesterday", or "Start …" once the running block has stopped elsewhere) with a hint.

## Stop flight, first-paint drop-in and block pull-to-refresh (Blocks parity step 2b-3)

Stop flight:

- Trigger: Stop on the live block, or the Play orb's Stop while Today is showing. Stop from the editor sheet (which owns its own exit), the Live Activity or another device does not fly.
- Owner: `StopFlightOverlay`, one ghost drawn above the app (pointer events off) and animated on the UI thread with Reanimated. The Dashboard first measures the live block and its row block in window coordinates (`measureFlightNode`; the nodes register themselves, and only a group's own row, never an expanded child, is a landing place), shows the ghost exactly over the block and hides the block in the same render (`liveHidden`, which also takes it out of touch; the ghost catches touches where it flies), then calls Stop. No flight runs before the overlay has measured itself. Stop accepted: the ghost's content (chip, title, timer, actions) fades in 200 ms while it squashes (translateY 6, scale 1.02 × 0.94 at 16 %) and flies, shrinking, onto the row block over 620 ms (`cubic-bezier(.3,.7,.2,1)`, `stopFlightPose`); the idle card comes in at once with the shared presence fade. The row block is re-measured after the commit (the idle card is shorter, so the list moves up) and the ghost chases the new frame over 180 ms. On arrival the ghost leaves, the row block pops from 1.5 with `pop` (`useBlockPop`) and the row's background lights to `surfaceMuted` and fades back over 700 ms. The Stop composite's soft impact is scheduled for the arrival (620 ms).
- Entrance/update/exit: no row for the entry (none registered): the ghost fades where it is in 200 ms and the row landing plays instead. A row off-screen is still flown to, as in the prototype.
- Interruption: a second Stop tap while measuring is the same Stop; a new flight replaces an older one (its ghost unmounts, its callback never fires); Start during a flight shows the new live block under the ghost.
- Async outcome: a refused or failed Stop removes the ghost before any haptic and the live block, never unmounted, is visible again; nothing lands or pops. A Stop rolled back while the ghost flies (delivery rejected) removes the ghost at once and brings the block back. Logout clears the flight and every pending landing.
- Accessibility: Reduce Motion skips the flight entirely (the existing opacity path and row landing). The ghost is hidden from VoiceOver; the announcement and haptics are unchanged.

First-paint drop-in:

- Trigger: the first time the quick-start tiles appear in the app process.
- Owner: `useDropIn` on an inner view of each tile; the tile's slot keeps its own layout transition. Tiles fall from 18 points below at 92 % scale with `land`, fading in over 160 ms, staggered 80 ms + 45 ms per tile.
- Entrance/update/exit: once per process (`mosaicDroppedIn`); a later mount of Today, a refresh, hydration, an account switch or a tile pinned later shows tiles at rest (or with the existing pin fade). An interrupted drop-in settles at rest.
- Accessibility: Reduce Motion shows the tiles at rest at once.

Block pull-to-refresh:

- Trigger: a deliberate pull on Today.
- Owner: the native refresh control still owns the pull, its threshold and the held gap (its spinner is transparent). `TodayPullBlocks`, behind the list just inside the top safe area, reads the list's content offset on the UI thread (`useAnimatedScrollHandler`): six small blocks stand up one after another as the pull reaches 90 points (`pullBlockScale`), the row's opacity follows the pull, and while the refresh runs each block pulses (scale 1 → 0.4 → 1 over 500 ms, staggered 50 ms). When the refresh ends the row fades out over 200 ms.
- Interruption: a pull released early lets the blocks fall back with the offset; a refresh that ends mid-pulse stops the pulse and fades out.
- Async outcome: the indicator follows the Dashboard's `refreshing` state only; it never says "synced" (there is no toast yet).
- Accessibility: Reduce Motion keeps the blocks standing without the pulse; the indicator is hidden from VoiceOver (the native control still announces refreshing).

## Play orb and bloom (Blocks parity step 3)

- Trigger: a tap on the orb; a press held 360 ms; the finger sliding over the bloom; release; a tap on a bubble or outside once the bloom stays open; VoiceOver activating the native tab item underneath.
- Owner: `PlayOrb`, drawn by the Dashboard above the tab bar with a session, on an iPhone with iOS 26 or later (`playOrbSupported`, decided once per process; otherwise neither the orb nor its slot exists), centred on the tab bar's trailing slot (a disabled "search"-role native tab item that makes iOS move the tabs left and leave a circle at the trailing edge, as in the prototype; `playOrbFrame`). One gesture owner on the UI thread: `Gesture.Exclusive(Pan.activateAfterLongPress(360), Tap.maxDuration(360))`. Touch down presses the orb to 0.9 with `snap`; letting go springs it back with `pop`. The pan's activation opens the bloom; its updates pick the bubble under the finger (`bloomHit`, 44-point reach) on the UI thread and hand only changes to JS.
- Entrance/update/exit: the bloom's scrim and label fade in over 200 ms (the prototype's blur is not used; the scrim is darker instead) and up to nine bubbles fly out from the orb with `pop`, 18 ms apart: three on a 112-point arc, six on a 196-point arc (`bloomSpots`; pinned activities first, then the last seven days' use). Opening plays the medium (start) haptic; each bubble the finger enters lifts to 1.22 over 140 ms with one selection tick and names itself in the label. Release on a bubble starts that activity (or switches to it; the running activity opens its editor instead) and the bloom fades out over 160 ms; release after sliding elsewhere closes it; release without moving keeps it open ("Tap one to start · tap outside to cancel"). A tap starts a bare block and opens it, or stops the running block (the Stop flight on Today; a plain Stop on Calendar and Reports). While running the orb carries a coral ring that fills with the current minute's seconds, updated each second.
- Interruption: a hold the system cancels closes the bloom without choosing; the orb and bloom disappear with the tab bar (a Reports sheet); one pick per release.
- Async outcome: none of its own; Start and Stop are the Dashboard's existing optimistic owners, with their own haptics and landings.
- Accessibility: Reduce Motion presses the orb in place (no spring), shows the bubbles in place, keeps the fades short and holds no lift animation. Bubbles are hit-tested in window points from the orb's centre, so the press scale never skews the 44-point reach. A finger that slides more than 10 points before the bloom opens is neither a tap nor a hold (press, wait, then slide). The coral orb is hidden from VoiceOver; the native tab item underneath is the accessible element ("Start a block" or "Stop timer"): it is disabled, so activating it selects nothing, and its press runs the orb's tap. Choosing an activity without the bloom stays available through the quick-start mosaic, the Switch sheet and the entry sheet.

## Entry sheet time cards and dial shortcuts (Blocks parity step 4e)

- Trigger: a tap on `…` under the duration dial (or `×` while open); a tap on a shortcut pill; a turn of the dial; a new sheet presentation.
- Owner: `TimeEntryDurationDial` owns the open state; the hint and the shortcut row are siblings in one fixed-height row keyed `hint` / `shortcuts`, each with `localPresenceEntering`/`localPresenceExiting` (a 140 ms crossfade). The row's height never changes, so nothing around it moves.
- Entrance/update/exit: opening fades the hint out and the pills in; a shortcut applies its interval through the dial's existing `onChange` (the dial and the time cards update in the same render) and fades the pills back to the hint. The time cards have no motion of their own.
- Interruption: turning the dial while the pills are open closes them; a disabled sheet (a mutation in flight) disables `…` and the pills.
- Async outcome: none; shortcuts only change the draft.
- Accessibility: Reduce Motion keeps the swap as a short fade (90 ms in, 70 ms out) with no movement. `…` reports `expanded`; its label is "Time shortcuts" or "Hide time shortcuts"; each pill has a spoken label ("Set start to the last stop time, 21:22", "Round stop time", "Round duration").

## Review deck (Blocks parity step 5a)

- Trigger: Log it, Skip or a saved edit deciding the top card; a backlog page or refresh adding cards; Skip for now moving a legacy entry back.
- Owner: each card in `ReviewDeckStack` owns its depth (0–2) as one shared value; a change of depth springs to `translateY(depth × 14)` and `scale(1 − depth × 0.05)` with `BLOCKS_SPRING.land`. Cards enter and leave with `localPresenceEntering`/`localPresenceExiting` (a 140 ms fade). Since step 5b a decided card leaves at the throw and its decision is held for Undo; when the hold ends and the local save fails, the card comes back at its natural place with a fade and an alert.
- Entrance/update/exit: the top card fades out while the cards beneath land one step up; a card arriving at the bottom of the stack fades in at its depth. "All framed" appears without motion in 5a (its drop-in is step 5b).
- Interruption: a new decision while cards are landing retargets the springs from where they are.
- Async outcome: the existing Review outbox owns success and failure (step 5b: a failed local save after the hold brings the card back with an alert).
- Accessibility: Reduce Motion moves cards to their depth at once and keeps the short fades. Only the top card is exposed to VoiceOver; each round action has a spoken label.

## Review deck swipe, Undo and "All framed" (Blocks parity step 5b)

- Trigger: a horizontal drag on the top card; Log it / Skip (the buttons throw the card the same way); Undo on the toast; the deck emptying.
- Owner: the top card in `ReviewDeckStack` owns one `Gesture.Pan` (active after 12 points sideways, failing after 14 vertically so pull-to-refresh keeps the vertical axis) and its `dragX`/`dragY` shared values on the UI thread. The card follows the finger (40 % vertically), tilts dx/18° (no tilt with Reduce Motion), and the LOG IT (right, success fill) / SKIP (left; LATER when Skip only defers) stamps fade in with dx/110. Crossing ±110 points arms the throw with one selection tick; the finger must also have travelled 110 points that way, so a card caught on its way home does not arm at once. A direction the card cannot take resists at 20 % and never arms.
- Entrance/update/exit: a release past ±110 flies the card 520 points out in 340 ms (cubic-bezier .3, .6, .4, 1) while it lifts 40 points, then reports the throw; the cards beneath start moving up with `land` as the throw starts, not when the flight ends (the next card becomes interactive once the flight ends, so two flights never overlap; the LOG IT/SKIP stamp stays on the flying card); a short release springs home with `land`. The Review screen has no swipe-back at all (‹ Today goes back), so a right drag on a card, or a card springing home into the screen edge, never pops the screen. The card is then held (`reviewDeckHold.ts`): it leaves the deck, the next card lands one step up, and the inverse-colour toast ("Logged …" / "Skipped …" with the activity swatch and a 44-point Undo) rises in for 4.8 s, 12 points above the round actions (hanging out of flow under Back to Today once all is framed, or under the waiting copy when the last cached card was thrown, so Undo is always there and its exit moves nothing). While the thrown card is still flying, its Edit/More and the round actions are disabled and it no longer counts toward "N of M". Undo drops the hold, the card returns to the top flying in from the side it left with the `sheet` spring (no overshoot, so the opposite stamp never flashes), with the undo haptic. When this visit's own decisions empty the deck (the cards last on screen were all decided here, not removed by a refresh), "All framed" drops this visit's logged blocks from 260 points above (tilted −12°, `land`, 80 + i × 90 ms apart), pops the title from 0.8 with `pop` at 200 ms and plays the success haptic at 300 ms when something was logged.
- Interruption: deciding another card (a throw, More › Dismiss or a saved edit) saves the held one first (one toast at a time); a cancelled gesture (interrupted or backgrounded before release) never decides and the card springs home; a flight cut short by leaving or backgrounding is retired by the save outcome, so a card restored by a failed save is never left locked; a card restored by a failed save comes back as a fresh card; a throw reported after Review lost focus is saved at once; if a refresh changes the suggestion (time, activity, place or name) while it is held, nothing is saved and the card returns as it now is; Undo puts the card on top even over a Today ribbon focus; a held card whose item a capped refresh paged out is still saved, and Undo or a failed save brings it back from the copy the deck showed (into the loaded data, so More and Edit work on it); a direction the card loses mid-drag (its sync state changed) sends it home, and a Log it / Skip press for a direction it just lost does nothing; a card without a complete suggested window cannot be thrown to decide (only a left swipe or Skip for now moves it behind the rest); a card unmounted mid-flight cancels its fling and never reports a throw end, and a deferral flight whose card a refresh drops is retired and still moves the card behind the rest; returning to the foreground with another screen open does not reactivate Review; moving a card behind the rest or saving any edit saves a held one first; the space under the last control is always reserved for the toast, so Undo stays reachable at large text sizes; leaving Review, losing focus or backgrounding the app saves it at once; a throw cannot be re-armed mid-flight; the decision is taken as the throw starts, so leaving Review mid-flight still saves it, and Undo mid-flight brings the card back as a fresh card; catching a card that is springing home or flying back continues from where it is.
- Async outcome: nothing reaches the outbox until the hold ends, so Undo needs no server contract; a saved card stays out of the deck until its local projection drops it; a failed local save keeps the card (alert) and takes the decision out of "N of M".
- Accessibility: with Reduce Motion the throw reports at once (the card fades), a short release snaps home, Undo places the card without flying and "All framed" appears in place. The buttons remain the VoiceOver path for Log it and Skip, and each decision is announced with Undo available.

## Review deck bulk skip (Blocks parity step 5f)

- Trigger: More › Review all › "Skip older than 7 days" or "Skip all" on the top card, confirmed in one system alert that states the count.
- Owner: the same `reviewDeckHold.ts` hold as a thrown card, holding one batch decision (`kind: "batch"`); the deck owns no new animation. While older backlog pages are read before the alert, the nav count slot reads "Counting…" (no layout moves, no spinner).
- Entrance/update/exit: on confirm every covered card leaves the deck at once with the deck's presence fade (140 ms), the first card not covered lands one step up with `land` (or "All framed" / the waiting copy appears when nothing is left), the success-neutral skip haptic plays and the inverse toast "Skipped N moments" (neutral swatch, 44-point Undo) rises in for 4.8 s in the same place as a single card's toast. Undo drops the hold, the cards fade back in at their natural places (no flight: they were never thrown) with the undo haptic.
- Interruption: one toast at a time, so a throw, More › Dismiss, a saved edit or another bulk skip saves a held batch first, and a bulk skip saves a held card first; leaving Review, losing focus or backgrounding saves it at once; a moment a refresh changed (time, activity, place or name) or already saving while held is not saved and comes back; a moment resolved elsewhere is dropped quietly; only moments confirmed in the alert and still skippable when it is accepted are held.
- Async outcome: nothing reaches the outbox until the hold ends; then the batch claims its moments (no single decision can start for them) and `runReviewBulkSkip` writes them to the durable outbox one after another, re-checking each against the current data right before it is written (a refresh during an earlier write may have changed it; then it stays to review) and stopping if the signed-in account changes (the batch is bound to the account that held it, so a change during the Undo window or the writes saves nothing more, Undo puts nothing back, and the deck forgets its remembered cards when another account's data arrives; each remembered card is tagged with its account and read back only for it, so single-card Undo or a failed save can never restore another account's card); the deck is projected once onto the newest data and synced once; a moment whose local save fails comes back as a fresh card with one alert naming the count. A single decision whose flush saved the same moment through a held batch is not counted again.
- Accessibility: the menu rows sit under a "Review all" header with hints; the menu never grows past the screen (its actions scroll and a Cancel row stays visible); counting, the batch, Undo ("N moments are back") and any unsaved moments are announced. Reduce Motion keeps the same opacity-only presence fades.


## Reports top (Blocks parity step 10a)

- Trigger: Week / Month / More, tapping a week column, Apply in the filter or date sheet, data arriving.
- Owner: `ReportRangeSwitch` owns its thumb (one shared value pair, `BLOCKS_SPRING.control`; the first measurement places it without movement). The week columns' blocks grow from the bottom with `BLOCKS_SPRING.land`, 14 ms apart, once per mount when the first week with data appears (`growEntering`); later data, focus and range changes repaint in place. Focusing a day changes the hero text and the other columns' opacity at once. The goal streak enters with the shared presence fade. The donut has no entrance (step 10b replaced the animated Revision 3 donut; it is drawn at rest). Week/Month and day taps play the `tick` haptic.
- Interruption: changing range or filter during a focus clears the focus; a late previous-period read for an old range is ignored (keyed by its exact request).
- Accessibility: Reduce Motion places the thumb without a spring and shows the columns without the grow; the hero is one live-region element ("19 hours 47 minutes framed this week. 19 hours 47 minutes more than last week so far"); each column is a 44-point button with its day and total, selected while focused.

## Web command timer (Blocks parity step 11b)

- Trigger: elapsed time changing each second; a quick start pressed; the bar entering or leaving the live state.
- Owner: `Odometer` owns the rolling digits: each digit strip is a CSS `transform` transition with the `roll` spring (`linear()` set after mount, so the first paint is still); positions are keyed from the right so a new hours digit never shifts the seconds. Quick-start blocks lift 1 px on hover and press to 0.95 with a 140 ms ease-out. The live state changes the bar's ring colour in place; nothing else moves.
- Interruption: a digit that changes again mid-roll retargets from where it is.
- Accessibility: Reduce Motion removes the roll and the press scale (values change in place). The rolling strips are hidden from assistive technology; the clock button's label carries the start time and elapsed time.

## Web shell sidebar thumb (Blocks parity step 11a)

- Trigger: the route changes to another of the five sections (link, phone tab, or G then a letter).
- Owner: `ShellSidebarNav` owns one neutral thumb behind the sidebar links. Its first placement is still; later moves are a CSS `transform` transition using the `snap` spring as a `linear()` easing (`springTransition` in `apps/web/src/lib/blocks-motion.ts`), so a second route change retargets from wherever the thumb is. Window resizes re-place it without travel. A page outside the five sections (Settings) fades the thumb out (140 ms opacity); returning fades it back in.
- Surrounding layout: links, labels and the Review count never move; only the thumb travels. The phone tab bar has no animated element: the current tab is a neutral fill.
- Accessibility: Reduce Motion moves the thumb without travel (opacity only). The current link carries `aria-current="page"`; the Review link's name includes the count.

## Connectivity slot and avatar badge (Blocks parity step 10c)

- Trigger: confirmed offline, a live return to online, a rejected Stop/Edit/Delete appearing or resolving.
- Owner: the root `ConnectivityStatusProvider` owns state, expiry and announcements; each tab's `ConnectivityStatusIndicator` cross-fades the one glyph in its fixed 44-point slot (`FadeIn`/`FadeOut`, 140 ms; Reduce Motion 70/60 ms). Nothing rotates. The avatar badge appears and disappears in place with the attention count; nothing moves around it.
- Interruption: a new outage replaces "back online" at once; an account change clears any notice; the expiry timer is cleared when superseded.
- Accessibility: one announcement per distinct slot state and one per new rejection (not at launch); the slot is a text element, never a button; the badged avatar carries its own label and hint.

## Reports donut and filter (Blocks parity step 10b)

- Trigger: a finger on the ring, a row tap, VoiceOver increment/decrement, All / None / a row in the filter sheet.
- Owner: `ReportDonutCard` owns the highlighted activity; the highlight changes stroke width and opacity at once (no animation), the centre text and the row background change in the same render. The ring takes the touch with the responder system and refuses to hand it over until release; while a finger is on it the Reports scroll view turns `scrollEnabled` off (refusing the JS responder alone does not stop the native iOS pan), and release, termination or unmount turn it back on, so scrubbing never scrolls the page. The filter sheet keeps `SwipeDismissSheet` as its only transition owner.
- Interruption: a range or filter change that removes the highlighted activity clears the highlight; releasing the finger keeps the last highlight (tap its row, or step past the last activity, to return to the total).
- Accessibility: nothing moves, so Reduce Motion needs no other path; the ring is adjustable for VoiceOver; rows are 44-point buttons with their full name, percentage and duration; the `tick` haptic follows the Dayframe haptics setting.

## Calendar (Blocks parity step 9)

- Trigger: a week-strip day, a strip swipe (week) or timeline swipe (day), the − / + zoom buttons, a pinch, Today's "Earlier this week" days.
- Owner: SwiftUI owns the strip and blocks; `DayframeCalendarScrollCoordinator` stays the only owner of timeline geometry. The selected-day circle slides between days with `matchedGeometryEffect` on a spring (response 0.32, damping 0.82); the day's blocks keep the existing slide-and-fade from the swipe side (0.21 s). A zoom button publishes one zoom request; the coordinator animates the hour height by ×1.4 (or ÷1.4) over 260 ms ease-out cubic around the viewport centre with one display link, keeping the minute under the centre fixed (the pinch rule). The running block's inner ring breathes 0.35 ↔ 1 over 2.4 s. Day taps and zoom presses play the selection haptic; long-press creation keeps its slot haptics; all native haptics follow the Dayframe haptics setting.
- Interruption: a press during a running zoom chains from that step's target, so rapid presses each count; a pinch, a finger dragging the timeline or long-press creation stops the zoom at the geometry already shown; detaching the view stops it. Buttons are disabled at the zoom limits.
- Accessibility: Reduce Motion applies a zoom step at once, moves the selected circle without a spring, keeps the day change without a slide and holds the live ring at 0.6. The zoom buttons are 44 points, labelled "Zoom out" / "Zoom in"; the month title is a header; the timeline hint mentions the zoom buttons.

## Onboarding (Blocks parity step 8-1a)

- Trigger: Settings › Help › "Set up Dayframe again" opens the route (8-1c adds the first-sign-in gate); "Set up Dayframe", Allow / Continue / Not now, Back (previous step), Later (to the summary) and Open Today move through it.
- Owner: the stack fades the route in (Reduce Motion: none) and turns swipe-back off, so a swipe can never leave half-way through an iOS prompt. Inside, one keyed `Reanimated.View` per step (and per Location stage) owns step movement: it enters from 36 points on the side it comes from (forward from the right, Back from the left) with `BLOCKS_SPRING.sheet` and a 180 ms fade; the old step leaves at once. A forward move lands the finished step's progress block (from 14 points above at 60 % scale with `BLOCKS_SPRING.land`). The welcome's sample-day blocks drop from 260 points above with a 70 ms stagger (`land`) once per visit (Back to the welcome shows them at rest). Each step starts scrolled to its top (the scroll view is keyed by step) and VoiceOver focus moves to its heading. A step's result line enters with the shared presence fade under `localLayoutTransition`. The `tick` haptic plays on each step change.
- Interruption: one permission request (and the suggestions switch-on after Always, bounded to 15 s before Try again comes back) at a time — every step button, Back and Later are off meanwhile; coming back to the screen re-reads this account's suggestions; an answer arriving after the screen closed or was covered by another page, the session changed or ended, or the account changed is dropped; Back after an answer shows that answer again rather than asking twice.
- Accessibility: Reduce Motion fades steps (`localPresenceEntering`), sets progress blocks with a 160 ms opacity change and shows the sample day in place; each result is announced; the progress blocks read "Setup progress: N of M steps done"; samples are labelled as examples; every target is at least 44 points.

## Evening reminder rows (Blocks parity step 8-0)

- Trigger: the Evening reminder switch (or Open Settings when iOS has notifications off) and the Time stepper in Settings › Automatic tracking.
- Owner: the Time row enters and leaves with `localPresenceEntering` / `localPresenceExiting` when the reminder turns on or off; the switch, its subtitle and the time value update in place. The iOS permission alert is the system's. Nothing else moves.
- Interruption: one change at a time (the switch and stepper are off while a change saves); a refused permission leaves the switch off; changes from Settings, counts from replies and the time are applied in order, so a late count never undoes a newer choice.
- Accessibility: Reduce Motion makes the Time row appear and disappear without movement; the stepper is one adjustable control with its range as the hint; every target is at least 44 points.

## Settings detail pages (Blocks parity step 6a-3)

- Trigger: a Settings row opens Account, Location or Apple Health (the existing pushed-route transition, unchanged); on Apple Health, a type's switch.
- Owner: the route stack owns page movement; on Apple Health each type and each group is a `Reanimated.View` with the shared `localLayoutTransition`, and an enabled type's "Logs as" / Use default / Name rows enter and leave with `localPresenceEntering` / `localPresenceExiting`. Nothing else on these pages moves; status changes (access line, Sync now result, switch state) update in place.
- Entrance/update/exit: switching a type on fades its rows in while the rows and groups below slide down; switching it off fades them out while the rest slides up. Choosing an activity uses the All activities sheet's own motion. Use default fades its own row out while the Name row below moves up with the shared layout transition; a failed save brings the row back the same way.
- Interruption: toggling again mid-transition retargets from the current position; a failed save rolls the switch or mapping back with an alert and the rows follow.
- Accessibility: Reduce Motion keeps opacity-only presence and no layout movement. Rows keep 44-point targets and plain labels; every pill states its action.

## Location evidence in Blocks (Blocks parity step 5e)

- Trigger: Edit before logging opens the screen (existing pushed route); in More options, Use a map pin instead and Split near HH:MM.
- Owner: each group and each More options row is a `Reanimated.View` with the shared `localLayoutTransition`; the inline pin-name row and the Before/After split row enter and leave with `localPresenceEntering` / `localPresenceExiting`. Search results, nearby places, trip stops and the status note keep their existing presence owners. The header stays fixed.
- Entrance/update/exit: the pin row fades in under its row while the rest of the list slides down, and out when the pin is finished or used; choosing a split fades in its confirm row. Rows are always visible (no disclosure), so nothing else moves.
- Interruption: every More options row and pill is disabled while a save runs (the place, activity and map choices keep their earlier behaviour); finishing the pin keeps the drafted name and Use this pin until the pin is used; a failed save keeps the whole draft (unchanged mutation owner).
- Accessibility: Reduce Motion keeps opacity-only presence and no layout movement; rows are 52-point targets with plain titles and subtitles; the activity title is a header.
## Activities page and editor (Blocks parity step 6b-1)

- Trigger: New activity or an activity row opens the editor sheet; Save, Create, Cancel, a backdrop tap, a swipe down or a confirmed Archive closes it; the pin button toggles a pin.
- Owner: `SwipeDismissSheet` owns the editor's entrance, drag and exit (Reduce Motion: its opacity path); the page has no other movement. The preview block, icon and colour selections and the pin's fill update in place. After a save or archive the page's list re-renders from the reloaded data (a moved or archived row appears in or leaves its group without its own animation, as other Settings lists do).
- Interruption: activity changes run one at a time across the page and the sheet (a second is refused, never queued behind a stale answer); a save or archive in progress disables Save and Archive; leaving the sheet mid-save keeps whatever the server accepted (the next load shows it). A seventh pin is refused with an alert and nothing moves.
- Accessibility: icon and colour choices are radio groups with labels; the pin button names its action ("Add X to quick start"); all targets are at least 44 points.

## Places page and Home/Work sheet (Blocks parity step 7a)

- Trigger: Add place, a saved place row and a suggestion's Save open the place editor (existing pushed route); Set, Change and Clear open the Home/Work sheet; Save, Clear, Cancel, a backdrop tap, a swipe down or "Add a new place as Home/Work" closes it; a suggestion row opens the existing suggestion sheet.
- Owner: `SwipeDismissSheet` owns the Home/Work sheet's entrance, drag and exit (Reduce Motion: its opacity path). "Add a new place as …" pushes the editor only from the sheet's `onDismiss`, so the sheet's exit and the route push never overlap. Saved and suggested place rows and the status line keep the shared `localPresenceEntering` / `localPresenceExiting` / `localLayoutTransition`; the slot rows update in place after a save.
- Interruption: Save and Clear are one-shot, and while one is saving the sheet cannot be closed (Cancel, the backdrop and the swipe are off) and no other Home/Work sheet opens; a refused save keeps the sheet open with the reason announced; a typed rename survives choosing another place. An accepted change shows at once even if the refresh after it fails, and a page read that started before it is dropped.
- Accessibility: Reduce Motion keeps opacity-only presence and no layout movement; the saved-place choice is a radio group; Change, Clear and Set name their slot ("Change Home"); every target is at least 44 points.

## Place editor (Blocks parity step 7b)

- Trigger: Add place, a saved place row, a suggestion's Save or "Add a new place as Home/Work" pushes the editor; Cancel, Save (after the change is accepted), Delete (after it is accepted) or the back swipe leaves it; "Logs as" opens the All activities picker.
- Owner: the route stack owns the editor's entrance and exit; the head (Cancel, title, Save) stays put while the page scrolls. Each group is a `Reanimated.View` with the shared `localLayoutTransition`; search results, the chosen result, the "Logs as" / Default activity / Entry name rows and the coordinate fields enter and leave with `localPresenceEntering` / `localPresenceExiting`. `SwipeDismissSheet` owns the picker (Reduce Motion: its opacity path). The map card swaps between the empty card and the map in place; the map's circle and pin take the chosen activity's colour (neutral without one) and update in place.
- Interruption: Save and Delete are one-shot and lock each other; a refused save keeps the whole draft; leaving mid-save is allowed and a late answer never touches a closed editor or another account (unchanged owners).
- Accessibility: Reduce Motion keeps opacity-only presence and no layout movement; Save names why it is unavailable (the validation message as its hint); every target is at least 44 points.
