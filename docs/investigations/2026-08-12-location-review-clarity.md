# Location Review clarity

Date: 2026-08-12

## Reported behaviour

The updated mobile Review card shows a medium-high commute without explaining
why it was not automatic. Its evidence map exposes `Significant location
change`, raw anchor pins, and sample-derived geometry as though they were user
actions. The commute editor then asks `Where were you?` and repeats `Route
detected`, while an unmatched visit promotes `No saved place` into a large
answer card.

The supplied screenshots are the primary visual evidence. They contain no
committed coordinates, tokens, or account data.

## Root cause

- The Review card used a generic kind summary even though Location V2 already
  supplies a structured `semanticReason` and the client can calculate overlap.
- The normal mobile map rendered the same technical anchors and samples used by
  the diagnostic presentation. Apple MapKit therefore exposed internal anchor
  labels as tappable callouts.
- The shared correction layout applied stay-oriented Where copy to commutes and
  converted the absence of a saved place into a prominent answer.

The 5 August commute is not evidence that medium-high automatic logging failed:
an existing open Review item remains review-owned, and its confirmed-time
overlap independently blocks automatic creation. Confidence is one condition,
not the complete automatic policy.

## Implementation boundary

- Translate Location V2 semantic reasons into concise user copy and fold a
  detected overlap into that one explanation.
- Keep confidence as its own five-step indicator.
- Hide technical anchors, raw sample circles, and rejected-sample details in the
  normal mobile map. Preserve them behind the existing detailed-map flag.
- Show Start and End markers for commutes, a solid observed approximation when
  available, and a labelled dashed direct fallback otherwise.
- Remove Where/Route-detected from commutes and remove the unmatched stay's
  large empty answer card.
- Do not change capture frequency, Location V2 thresholds, rollout mode,
  automatic eligibility, overlap policy, persistence, API schemas, or database
  storage.

## Motion contract

- Trigger: opening Location Evidence, receiving the loaded evidence DTO, or
  resolving/dismissing a Review item.
- Owner: Expo Router/native stack continues to own push/pop; the existing
  keyed Reanimated Review/card layout owner continues to own local reflow.
  MapKit remains static presentation and gains no animation owner.
- Entrance/update/exit: route entrance/exit and Review card removal retain their
  existing behavior. Reason copy and Start/End markers update in place without
  decorative travel.
- Surrounding layout: removing the commute Where section is static screen
  composition; Review card removal still reflows adjacent cards through the
  existing 220 ms local layout transition.
- Interruption: stable Review IDs and existing mutation/presentation tokens
  prevent a stale response or exit callback from replacing newer content.
- Async outcome: existing pending Review acknowledgement, success exit, and
  failure retention remain unchanged. No new optimistic state, Undo, or timeout
  is introduced.
- Accessibility: Reduce Motion makes existing local reflow immediate or
  opacity-only; map accessibility names describe the visit or approximate
  commute plus Start/End; Dynamic Type may wrap reason/caption copy; VoiceOver
  no longer encounters technical anchor actions.

## Documentation impact

- Product behavior: PRD and feature tracker updated.
- Architecture/API/schema: reviewed; no boundary or contract change.
- UI/motion: component, location, regression, and validation references updated.
- Release: mobile JavaScript changes require staging and a new verified binary
  before they are described as released.

## Validation evidence

- Focused mobile Review tests: passed, 31 tests across two files.
- Mobile typecheck: passed.
- Full mobile suite: passed, 638 tests across 66 files.
- Repository lint and documentation alignment checks: passed.
- The cold simulator build compiled the native dependency graph and exposed the
  repository's known generated CocoaPods checksum mismatch at the app target.
  After synchronising the ignored local Pods manifest to the intentionally
  unchanged committed lockfile, the single cached iOS 26.5 Simulator build
  completed successfully. No dependency lockfile change is included.
- Signed staging/device evidence is recorded after the exact PR Preview is
  ready and promoted; no physical-device or release result is inferred here.
