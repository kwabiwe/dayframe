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
- Corroboration could pair a bare Visit with a same-place reading from a separate earlier episode, across readings elsewhere. Corroboration must now come from the same episode.

The base PR's fallback-leg rebuild (stale route evidence on reconciled legs) is fixed there and merged in.

Each has a regression test that failed before its fix.

## Result

- On a shape-derived synthetic fixture (same times, accuracies, speeds and receipt times, synthetic geometry), the unchanged engine reproduces the staging output exactly. With the change, Home starts at 07:43:15 and one trip runs 07:26:56–07:43:15 with the school stop inside. As received at 07:53:30, before the buffered fixes, the Home arrival is already recognised.
- On the private 25–29 Sep corpus, one final-output change versus the physical-stops PR: the 29 Sep 18:10–18:26 BST outing that `main` lost entirely is now one Home round trip (18:10:02–18:25:45). The owner labelled its stop as a ~30-second station drop-off, and Google showed 18:09–18:26. A geofence registration pair no longer ends Home presence.
- In minute-by-minute as-received replay, the median time from journey end to first output fell from 196 to 75 minutes. Journeys first appearing only after the user left the destination fell from 11 of 13 to 7 of 12.

## Not established

- Remaining delay comes from foreground-only native Visit drain and deferred location delivery on the phone. These need a mobile change (follow-up).
- Segment identity still changes as late evidence lands, so one Review can be replaced (follow-up).
- No staging, device or production validation is claimed here.
