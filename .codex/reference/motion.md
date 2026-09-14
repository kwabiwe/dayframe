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

Do not introduce Swift solely to make an otherwise ordinary React Native entrance, exit, or list reflow smooth. Do not animate the same state change from multiple layers.

## Timing And Behaviour

- Reuse `MOBILE_MOTION` on iOS: approximately 140 ms for control feedback, 220 ms for local layout, 260 ms for sheets, and 280 ms for screen transitions.
- Follow the brand guide's 120–220 ms control and 180–300 ms panel ranges on other surfaces. Prefer standard ease-out timing; exits may be shorter while staying in the same curve family.
- Keep movement restrained. Use opacity plus a small translation when it clarifies origin; avoid theatrical scale, bounce, or decorative loops.
- Direct manipulation must track the finger continuously and must not hand off to a separately rebuilt layout with a release-time snap.
- Animate both presence and consequence: the control or notice entering is not sufficient if the affected row, surrounding list, timeout dismissal, Undo restoration, or failure rollback still jumps.
- Preserve geometry during async work. Avoid loading UI that moves content when optimistic feedback is the established product contract.
- A second rapid action must either replace, queue, or merge with the current transition deterministically. Give timeout/Undo feedback a monotonically increasing token or equivalent stable identity, clear the superseded timer, and verify that stale timers, exits, or completion callbacks cannot dismiss or restore newer state.

## Reduce Motion And Accessibility

- Read the system Reduce Motion preference through the existing app helpers or the animation library's system mode.
- Remove nonessential translation, scale, parallax, and spring effects when Reduce Motion is enabled. Use an immediate state change or restrained opacity only when needed to preserve context.
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
the host mounted until the shared exit callback. Cancel, backdrop, escape and a
successful swipe all discard; rejected swipes retain the draft. Delayed callbacks
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
