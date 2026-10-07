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

`LayoutAnimation` (and `scheduleLayoutTransition` in `apps/mobile/src/lib/motion.ts`, which calls it) does nothing in this app: with React Native 0.85 on the New Architecture, Reanimated 4's legacy layout-animation proxy replaces the UIManager animation delegate, and its `uiManagerDidConfigureNextLayoutAnimation` is empty. Never name it as the owner of a transition; use Reanimated `layout`, `entering` and `exiting` (the `localLayoutTransition` and presence helpers) instead. Existing calls are inert and due for removal.

Do not introduce Swift solely to make an otherwise ordinary React Native entrance, exit, or list reflow smooth. Do not animate the same state change from multiple layers.

## Timing And Behaviour

- Reuse `MOBILE_MOTION` on iOS: approximately 140 ms for control feedback, 220 ms for local layout, 260 ms for sheets, and 280 ms for screen transitions.
- Follow the brand guide's 120–220 ms control and 180–300 ms panel ranges on other surfaces. Prefer standard ease-out timing; exits may be shorter while staying in the same curve family.
- Keep movement restrained. Use opacity plus a small translation when it clarifies origin; avoid theatrical scale, bounce, or decorative loops. The only exceptions are the Dayframe Blocks landing spring and live ring below.
- Direct manipulation must track the finger continuously and must not hand off to a separately rebuilt layout with a release-time snap.
- Animate both presence and consequence: the control or notice entering is not sufficient if the affected row, surrounding list, timeout dismissal, Undo restoration, or failure rollback still jumps.
- Preserve geometry during async work. Avoid loading UI that moves content when optimistic feedback is the established product contract.
- A second rapid action must either replace, queue, or merge with the current transition deterministically. Give timeout/Undo feedback a monotonically increasing token or equivalent stable identity, clear the superseded timer, and verify that stale timers, exits, or completion callbacks cannot dismiss or restore newer state.

## Dayframe Blocks Springs And Haptics

The owner approved these on 5 October 2026 (see `docs/brand-style-guide.md`, Dayframe Blocks). They apply to surfaces migrated to Blocks.

Springs:

- **Landing.** When an entry is started, stopped, logged, restored or deleted, its block lands with one small overshoot. Starting values from the prototype are stiffness 320 and damping 21; tune them on a physical iPhone.
- **Controls, sheets and panels.** These settle without visible overshoot. Starting values: controls and thumbs at stiffness 560 and damping 38; sheets and panels at 340 and 34.
- **Live block.** Only the single live block carries a breathing ring: an opacity-only cycle of about 2.4 s on its inner edge. Nothing else loops.
- **No other bounces.** There is no scale pop, glow or celebratory bounce elsewhere.

One owner rule still applies: the spring belongs to the same single animation owner as the state change, and never stacks with another layer's transition.

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

Reduce Motion replaces the springs and the breathing ring with an opacity change. It keeps the same states, haptics, Undo and announcements.

## Reduce Motion And Accessibility

- Read the system Reduce Motion preference through the existing app helpers or the animation library's system mode.
- Remove nonessential translation, scale, parallax, spring effects and the Blocks breathing ring when Reduce Motion is enabled. Use an immediate state change or restrained opacity only when needed to preserve context.
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

Reanimated is the only animation owner on Today. The card slot and the quick-start section carry `localLayoutTransition`, so a card that grows (larger text, or a time that wraps the action reserve onto its own line on a narrow phone) and the content below it move rather than jump. Idle card and live block crossfade at the same geometry with the shared presence fades after first paint; with Reduce Motion they swap in place and the live content's 140 ms fade is the single opacity change. The landing animates only the translation of the block's inner content in normal motion (it starts at its offset on the first frame) and never the card, ring or action track. The existing `activeTimerExpansion` still fades the card's details and actions on stop. Mosaic tiles are absolutely positioned, keyed by activity and each owns a `localLayoutTransition`, so whatever changes the totals (stop, switch, Add past time, edit, delete, Undo, Review, the midnight roll-over) the same tiles move and resize, and with Reduce Motion they settle at once; tiles have no entrance on first paint and fade in or out only when an activity is pinned or unpinned. Tile sizes come from the last seven calendar days and change only when entries change or the day rolls over, never on a timer tick. Haptics, Undo and announcements are unchanged under Reduce Motion.

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

## Today integrated Review donut and rows

The Today summary uses one local Reanimated/arc owner; native navigation owns
exact Review and Location pushes. On the first focused populated context, the
donut may make one restrained entrance. A hidden eager mount, timer tick,
minor bootstrap refresh, or cached hydration settles without replay. Source
keys own arc/row identity: a local Quick Confirm changes the same row to
saved-local while its provisional arc exits and adjacent rows reflow; it never
waits for HTTP or replays the whole chart. Explicit canonical materialisation
updates the solid category geometry once; a reused canonical entry wins rather
than producing a duplicate row/arc. Rejection restores only the explicitly
open source, and stale exit callbacks cannot remove a restored/newer key.

Reduce Motion settles geometry immediately while preserving the same summary
copy, exact-item routes and VoiceOver feedback. Focus stays on the transformed
row or advances once to the next logical row/Open Review; background receipts
never steal focus. Validate first-visible entrance, accept/materialise/restore,
rapid repeat, account/day replacement, measured-label reflow and the
Reduce-Motion path on the actual component.
