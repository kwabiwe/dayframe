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

Today on iPhone is the first migrated surface. `useBlockLanding` and `useBreathingRing` in `apps/mobile/src/lib/blocksMotion.ts` hold the springs and ring above. A committed Start (Play, a mosaic tile, a row's Start again) issues one tokenised landing request after the local start is accepted; the live block's content (chip, title, time) lands from 14 points below while the card, its ring and the Stop/Add past time track stay fixed. A committed Stop issues one request for the stopped entry and clears the live block's request (a rolled-back Stop must not replay the Start landing); that row's activity block lands 60 ms later, as the Stop composite's soft impact plays. Undo lands the restored rows. Requests expire after 1.2 s and are never issued by refresh, reconciliation, hydration or a rejected action, so remounts and cached bootstraps do not replay them; a second rapid action replaces the request.

Reanimated owns the Blocks transitions on Today. The card slot, the quick-start section and the Review nudge carry `localLayoutTransition`, so a card that grows (larger text, or a time that wraps the action reserve onto its own line on a narrow phone) and the content below it move rather than jump. Idle card and live block crossfade with the shared presence fades after first paint while the slot's layout transition carries the height change; with Reduce Motion they swap in place and the live content's 140 ms fade is the single opacity change. The landing animates only the translation of the block's inner content in normal motion (it starts at its offset on the first frame) and never the card, ring or actions. The existing RN `Animated` value `activeTimerExpansion` only fades the card's details and actions out during the retained Stop exit; on Start it is set to rest before the first paint, so it never stacks with the crossfade. Mosaic tiles are absolutely positioned, keyed by activity and each owns a `localLayoutTransition`, so whatever changes the totals (stop, switch, Add past time, edit, delete, Undo, Review, the midnight roll-over) the same tiles move and resize, and with Reduce Motion they settle at once; tiles have no entrance on first paint and fade in or out only when an activity is pinned or unpinned. Tile sizes come from the last seven calendar days and change only when entries change or the day rolls over, never on a timer tick. Haptics, Undo and announcements are unchanged under Reduce Motion.

## Anti-Patterns

Reports Revision 3 uses one fixed six-week calendar frame for month fades, not two
in-flow months. Outgoing calendar/row/donut visuals must cease interaction and
accessibility immediately. Donut exits retain IDs until zero-sweep completion;
cleanup checks the current transition generation and desired IDs so rapid removal,
restore and removal cannot delete a newer visual. Survivors interpolate to the
selected-only denominator. Category changes occur only through filter-sheet Apply;
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
- Entrance/update/exit: no roll on mount (a card that appears, a remount, a cached launch or a switch to another entry, which remounts the odometer, shows the digits at rest); a changed digit rolls to its new value (9 → 0 rolls back through the strip, as in the prototype); the clock leaves with its card. A new cell size (Dynamic Type, or the clock shrinking to fit a narrower card) re-places the strips without rolling.
- Interruption: a digit that changes again mid-roll retargets its spring from where it is.
- Async outcome: none; the clock follows the displayed entry's elapsed time, including a reconciled start time (which rolls the changed digits once).
- Accessibility: Reduce Motion sets each digit in place. The odometer is hidden from VoiceOver; the live block's value speaks the elapsed time in words.

## Live block swipe to switch and the Switch sheet (Blocks parity step 2b-2)

- Trigger: a leftward pan on the running live block; VoiceOver's "Switch" action on it; a tap on a recent block in the sheet.
- Owner: one `Gesture.Pan` on the live block (`useLiveSwipe` in `TodayLiveBlock`) drives a Reanimated shared offset on the UI thread. It activates after 8 points sideways and fails after 10 points vertically, so Today keeps scrolling, and is disabled while the block is only retained for the Stop exit. The card (with its ring and actions) follows the finger left only and tilts by offset/60 degrees; past 90 points it rubber-bands at 0.35 (`liveSwipeOffset`). A neutral "Switch" underlay shows behind it only while it is off its place. `SwipeDismissSheet` owns the sheet's presentation and exit.
- Entrance/update/exit: crossing 90 points of this gesture's own travel arms it with one `tick` (and again after disarming). Releasing springs the card home with `land`; releasing armed also opens the sheet. A pick starts that block through the Dashboard's existing Start owner (its haptic and landing) and dismisses the sheet; a second tap while it leaves does nothing.
- Interruption: a card grabbed while it springs home continues from where it is; a gesture the system cancels springs home and opens nothing.
- Async outcome: none of its own; Start is the Dashboard's optimistic owner.
- Accessibility: Reduce Motion keeps the finger tracking without the tilt and returns in 120 ms; the sheet uses the shared Reduce Motion path. VoiceOver uses the block's "Switch" action; each recent is one button ("Switch to Deep work, Work, last yesterday") with a hint.

The prototype's later Today moves (the Stop flight, drop-ins, block pull-to-refresh, the Play orb) arrive with steps 2b-3 and 3 and add their own contracts here.
