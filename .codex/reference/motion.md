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

- Conditionally mounting or removing a visible surface with no entrance or exit treatment.
- Animating a swiped row while leaving its action stationary or animating the action while the resulting list reflow jumps.
- Giving entrance motion to a notice but no exit, timeout, replacement, or Undo-restoration motion.
- Applying a global layout animation without confirming which subsequent state update it will capture.
- Combining native navigation, a JavaScript transform, and a local layout animation for one transition.
- Rewriting a smooth native route or sheet in Swift to repair an unrelated local React Native state change.
- Declaring motion complete from unit tests or still screenshots alone.
