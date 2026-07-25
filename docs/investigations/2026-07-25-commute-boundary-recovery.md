# Commute Boundary Recovery

## Report

On 24 July, Dayframe showed two review-first journeys beginning at 05:58
Europe/London and ending at 07:26 and 11:25. KB reported being asleep during
most of the first window and making only a short round trip at approximately
07:15–07:26.

## Production Evidence

- `/df` confirms a Sleep entry overlaps the false journey window.
- The last early Home sample was 05:58 local.
- Later accepted evidence still placed the phone at Home at 06:50 local.
- Core Location recorded the real Home exit at approximately 07:15 local.
- Route samples then showed the short trip and Home re-entry at approximately
  07:26 local.
- A later provider/status burst created another Home boundary at 11:25 without
  new route evidence.
- Region restoration emitted near-simultaneous Home exit/enter callbacks. The
  matching exit incorrectly closed the genuine 07:26 Home return after only a
  few minutes, so that short stay later disappeared from a complete replay.
- The replay engine used the promoted pre-gap Home stay's old stop time for
  both commutes. A short same-place stay after the gap was below the promotion
  threshold, so its more recent Home evidence did not correct the boundary.

Coordinates, device identifiers, and raw evidence identifiers remain only in
local diagnostic output and are not committed.

## Root Cause

`deriveCommutes` treated adjacent promoted stay timestamps as authoritative
even when accepted evidence after the first stay still matched the departure
place. The segmenter also treated a near-simultaneous same-place exit/enter
restoration pair as a real departure, and commute derivation allowed an
endpoint-only journey between two stays at the same saved place. Together,
those rules reused a stale 05:58 boundary and turned a later provider callback
into a second multi-hour journey.

## Fix

- Advance the departure boundary to the latest accepted evidence that still
  matches the departure stay.
- Exclude evidence matching either endpoint from route samples.
- Treat a same-place geofence exit/enter pair within five seconds as monitoring
  restoration rather than a real departure.
- Require at least two actual route samples for a same-known-place round trip.
  Same-place provider/registration gaps with no route are no longer commutes.
- Preserve endpoint-only journeys between different places as uncertain,
  review-first candidates.

## Success Criteria

- The production-shaped regression yields one short same-place round trip
  beginning at the real departure evidence, not the stale pre-sleep sample.
- A later same-place provider callback without new route evidence yields no
  commute.
- Existing different-place endpoint-only and route-distance behavior remains
  covered.
- Shared, web, mobile, database/replay, full repository, deployment, and
  release checks pass before handoff.
- Existing false Review rows are left unchanged unless KB explicitly asks to
  remove or correct them.

## Local Production-Evidence Replay

The retained production evidence was exported to a local mode-0600 temporary
file and replayed without committing coordinates or identifiers.

- At the 06:32 UTC processing snapshot, the patched engine yields exactly one
  journey: `06:15:03Z`–`06:26:58Z` (715 seconds / 11 minutes 55 seconds), with
  four route samples.
- A complete retained-evidence replay yields no multi-hour journey and no
  provider-burst journey.
- The temporary raw-evidence file must be removed after validation.
