# Location arrival presence after a still phone — 2 October 2026

Evidence record for the arrival-presence PR, stacked on the [physical stops](2026-10-01-location-physical-stops.md) PR. Canonical behaviour lives in [PRD](../PRD.md) and [Location learning guardrails](../../.codex/reference/location-learning.md); delivery state lives in the [tracker](../feature-fix-tracker.md). Raw evidence stays outside Git.

## Field case (staging QA account, read-only SQL; times UTC)

Staging served PR #213's approved head, so this reflects `main`'s engine.

- 07:26:56: left Home (geofence exit, fast fixes).
- 07:27:57–07:41:57: completed native Visit at an unsaved school.
- 07:42:31: driving back.
- 07:43:15–07:46:51: Home arrival with an arrival-only Visit 19 m from Home, a geofence entry, and slowing fixes down to 0 m/s within 20 m.
- Then a still phone: no readings for 36 minutes, until 08:22:56 (Home again).

Output was a 41-minute return journey (07:41:57–08:22:56), with Home starting at 08:22:56. The Home arrival had only about 3.6 minutes of timestamped support (below five) and the silence exceeded the 30-minute point-only bridge, so it was discarded. The fixes from 07:42:37–07:46:51 reached the server at 08:23:25, held on the phone by deferred location delivery. The Review appeared at 08:56 and was replaced at 09:01.

## Change

- A corroborated arrival-only Visit at a saved place establishes presence. Corroboration is that place's geofence entry or an accurate strong inside fix within five minutes, and the Visit must have no completed callback for the same arrival.
- Presence bridges silence to the next same-place observation, up to 18 hours. An open stay counts its dwell to processing time within the same cap.
- Exits, outside or other-place readings, and the completed Visit's departure still end it. Point-only gaps keep the thirty-minute rule. Learned places are unchanged.
- A trip through recorded stops qualifies when a complete chain of already-qualified legs joins its endpoints, even if its combined route is below the same-place minimum. The school run is about 1.75 km against a 1.8 km minimum.

## Review fixes (Codex, at `acbda42`)

- An open stay counted clock-based presence despite an unresolved outside reading 1.1 km away, finalising a trip to Home. Clock-based presence is now suspended while an exit or outside reading is unresolved.
- A quiet departure (exit plus outside readings with no later Home reading) removed the recognised arrival, because presence only helped open stays. Presence now carries into closing stays: silence no longer closes a present stay, departure is judged by the ordinary rules, and the stay ends at the departure evidence.
- Two findings in the base PR (absorbing stops without movement on both sides, and decided stop rows keeping their ID) are fixed there and merged in.

A re-review at `b7f013d` found two more:

- A present stay closed by another place could run to that later reading, ignoring an earlier buffered outside reading, and so pass the five-minute floor. It now ends at the earliest credible departure.
- Corroboration could pair a bare Visit with a same-place reading from a separate earlier episode, across readings elsewhere. Corroboration must now come from the same episode. A further re-review (`b8d94f8`) found that an accurate Visit at another place was not yet treated as a boundary; it now is, with a positive control for fresh corroboration after it.

The base PR's fallback-leg rebuild (stale route evidence on reconciled legs) is fixed there and merged in.

Each has a regression test that failed before its fix.

## Result

- On a shape-derived synthetic fixture (same times, accuracies, speeds and receipt times, synthetic geometry), the unchanged engine reproduces the staging output exactly. With the change, Home starts at 07:43:15 and one trip runs 07:26:56–07:43:15 with the school stop inside. As received at 07:53:30, before the buffered fixes, the Home arrival is already recognised.
- On the private 25–29 Sep corpus, one final-output change versus the physical-stops PR: the 29 Sep 18:10–18:26 BST outing that `main` lost entirely is now one Home round trip (18:10:02–18:25:45). The owner labelled its stop as a ~30-second station drop-off, and Google showed 18:09–18:26. A geofence registration pair no longer ends Home presence.
- In minute-by-minute as-received replay, the median time from journey end to first output fell from 196 to 75 minutes. Journeys first appearing only after the user left the destination fell from 11 of 13 to 7 of 12.

## Staging gym visit — 3 October (QA account, read-only SQL; times UTC)

Staging served this branch at `593b253`, with the matching signed Staging app on the test iPhone.

- 06:00–06:07: the drive to the gym matched Google. 06:07:48: arrival-only Visit, geofence entry and a still inside fix; then the phone was silent for 62 minutes.
- 07:14:08–07:14:14: outside readings and the gym geofence exit. 07:15:51–07:30:55: an owner-confirmed 15-minute stop at a shop, recorded inside one trip home (07:15:21–07:39:30), as decided for the physical-stops PR.
- The server first produced the correct gym stay, 06:07:48–07:14:08, and created its Review at 07:32:21.
- At 07:43:43 the completed Visit drained, 06:07:48–07:15:12, ending about a minute after the exit. A completed callback switches the open-arrival presence off, and the existing departure rule rejects a Visit end later than the departure evidence. The stay fell back to the midpoint of the silence, 06:43:14; the correct Review was retired and a wrong one created.

**Fix.** A completed saved-place Visit that ends after the departure evidence, by no more than `savedPlaceVisitDepartureLagMaximumMs` (five minutes), ends the stay at the earliest credible departure, as arrival presence does. The last inside observation is the lower bound and the departure evidence is the upper bound. A Visit running further past contradicting evidence keeps the midpoint, so the existing synthetic `A → B → A` tests, where the Visit overruns another place's evidence by 35 and 52 minutes, are unchanged.

**Result.**
- A shape-derived fixture (`gymVisitDepartureFixture.ts`: same times, accuracies, speeds and receipt times on one synthetic axis around the Gym) reproduces the staging failure on the unchanged engine. With the fix the gym stay is 06:07:48–07:14:08 at every processing time, before and after the completed Visit drains. Tests cover the five-minute bound on both sides.
- On the private 25–29 Sep corpus, two saved-place stays change, both the same pattern. On 25 Sep the completed Visit ended 9 seconds after the exit, and the stay now ends at the exit, 3 minutes 11 seconds later than the midpoint. On 27 Sep it ended 3 minutes 11 seconds after the first outside reading, and the stay now ends at that reading, 64 seconds later. As-received timeliness is unchanged.
- The stay's ID can still change when the completed callback sorts ahead of the arrival-only one (they share an occurrence time and tie-break on client ID). The re-issued Review then has the same, correct times. This is the existing identity follow-up.

**Re-review (Codex, at `c18ad1c`).** The late-Visit rule could use Visit support reused from an earlier, contradicted episode. A Home Visit spanning accurate Work readings was attached to a later single Home fix, so the exit created a five-minute Home stay that `main`, the physical-stops PR and `593b253` all omit; with Home logging enabled it could be logged automatically. The rule now applies only to a Visit that arrived within the current stay. The regression and an observed-dwell control (which `c18ad1c` also stretched to the exit) fail on `c18ad1c`; a fresh Visit in the return episode still counts, on both. The corpus output is identical to `c18ad1c`.

Still to drive on staging: a 30–60 second kerbside drop-off, a 20+ minute stop near a saved place, a school run then staying Home, and an ordinary drive with traffic.

## Not established

- Remaining delay comes from foreground-only native Visit drain and deferred location delivery on the phone. These need a mobile change (follow-up).
- Segment identity still changes as late evidence lands, so one Review can be replaced (follow-up).
- Staging evidence so far is the 2 Oct school run and the 3 Oct gym visit; no device or production validation of the 3 Oct fix is claimed here.
