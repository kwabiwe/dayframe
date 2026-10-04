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

**Re-review (Codex, at `70a0e67`).** A fresh Visit in the return episode only replaced the reused support when it ended later, so an equal or earlier fresh end lost a valid stay that `c18ad1c` kept. The late-departure rule now reads a separate value: the latest end of a Visit that arrived within the current stay. Interval-support selection is back to its earlier behaviour, so silence bridging is unchanged; replacing the support instead would have created a new Home stay from the stale Visit when silence followed. Regressions for equal and earlier fresh ends (with a later-end control) fail on `70a0e67`; corpus output is identical.

## Staging drive — 4 October (QA account, read-only SQL; times UTC)

Staging served `bd08751`. The School had just been saved (100 m radius). Google showed: left Home 06:49, a one-minute drop-off at the School around 06:51, a stop 06:53–07:17 at a shop 67–81 m from the School pin, and home by 07:23. Dayframe showed Home ending 06:49 and a three-minute Home → Home round trip 07:17–07:21; the outbound drive and the 24-minute stop were missing.

**Root cause** (confirmed with an instrumented replay, not inferred):
- The stop's arrival-only Visit (06:53:00, 12 m) was corroborated by the School geofence entry 41 s later. The phone then went silent for 22 minutes.
- iOS's completed callback for the same Visit (06:53:00–07:17:43) arrived 30 minutes after the departure with a 94 m accuracy. Any completed callback switched the arrival's presence off, but at 94 m this one was too broad to be used, so nothing replaced it.
- The silence then closed the stay at its last fix after two minutes, below the five-minute floor, so the stop was dropped and the journeys either side with it.

This is the same class as the 3 Oct gym bug: the completed callback replaced the arrival's presence without guaranteeing it could take over.

**Research.** One iOS Visit yields up to two callbacks sharing the Visit's arrival time: an arrival with an open departure, then a departure callback whose coordinate is the Visit's averaged position and whose accuracy is only an estimate of the region's radius (times are generally within a minute or two). Across 42 staging Visits (26 Sep–4 Oct) the completion was less precise than its arrival in most pairs (for example 2 → 59 m, 12 → 94 m), beyond 65 m in four, and up to 348 m away from it at brief stops. The app maps both callbacks directly (arrival time → `occurredAt`, departure → `endedAt` unless open), so pairing by device and arrival time is reliable.

**Rule.** A completed callback never removes a corroborated arrival's presence; it can only end it. When it is spatially compatible with the place and not contradicted by another Visit inside it, it is the arrival's interval support: presence ends at its reported departure, and it joins the stay with the arrival whatever the delivery order. Broad support stays at medium confidence, so it is never logged automatically. With presence, the stay ends at the earliest departure evidence however late the reported departure is. Completion-only stays keep the five-minute rule and the episode check from the re-reviews above.

**Result.**
- A shape-derived fixture (`schoolVisitFixture.ts`) reproduces the staging output on `bd08751`. With the fix, once the Visits drain: drive 06:49:32–06:53:00 (the drop-off stays inside it), School stay 06:53:00–07:17:43 at medium confidence, drive 07:17:48–07:21:35, then Home. That matches Google. Tests also cover delivery order, a silent phone after leaving (the stay ends at the reported departure, not hours later), and three controls: no arrival callback, no corroboration, and an incompatible completion.
- The gym stay is unchanged at 06:07:48–07:14:08 at every processing time.
- Retained staging week (26 Sep–4 Oct, replayed with today's places): two timing changes, both this pattern. One is 4 Oct. The other is the 29 Sep ~9-minute pickup, which becomes a School stay 16:35:01–16:44:11 (Google 16:35–16:43), consistent with four other school visits the engine already recorded when their completion happened to be precise. Without the School place: no changes at all. Finalised segments later retracted during as-received replay fall from 44 to 41 (unchanged without the School).
- Private 25–29 Sep corpus: no timing changes.
- Stay identities are unchanged wherever the previous engine already produced the stay (0 ID-only changes in the corpus and the staging week).

**Re-review (Codex, at `565f620`).** Three findings, all fixed with regressions that fail on `565f620`:
- An incompatible completion was ignored for presence but still segmented as ordinary evidence. When its ID sorted after the arrival it contradicted the arrival's corroboration and removed the stay. Companions are now paired before corroboration and never contradict their own arrival.
- With two completions, the earlier bounded presence but the other still joined and extended the stay (00:10 became 00:30). Every companion is now resolved together: the earliest usable one is selected, and the rest are consumed unused, including for reuse.
- Moving an accurate completion behind its arrival changed existing stay IDs once, and replay then orphaned a decided stay's neighbouring journeys. An accurate completion now keeps its earlier position, so no identity changes; only broad completions, never used before, follow the arrival.

**Re-review (Codex, at `4e1fd5c`).** Two paths still saw unused companions:
- Physical-stop detection received every accepted callback, so an unused companion could erase a trip's observed stop, and enabled mode could then log the whole journey as travel. The engine now runs again without unused companions, so nothing downstream sees them.
- An unused companion could be the implied-speed predecessor of its own arrival's inside fix. The fix was rejected, the arrival lost its corroboration and was never recognised as a companion's arrival. A completed Visit's coordinate averages its whole interval, so it is no longer used as a speed predecessor at all.

Both regressions fail on `4e1fd5c` in the reported orders. Neither change alters the corpus, the staging-week output or its rejections.

Still to drive on staging: a 30–60 second kerbside drop-off, a 20+ minute stop near a saved place, a school run then staying Home, and an ordinary drive with traffic.

## Not established

- Remaining delay comes from foreground-only native Visit drain and deferred location delivery on the phone. On 4 Oct nothing could appear until both Visit callbacks reached the server 30 minutes after the stop. These need a mobile change (follow-up).
- A broad completion whose arrival callback lies just outside the saved place's radius is still unused. On 30 Sep a 29-minute visit near the School (arrival 126 m from the pin, completion 85 m broad) is hidden inside a 32-minute Home round trip on both engines (follow-up; addressed by PR #221, which lets a long Visit carry a parked stop through silence).
- Segment identity still changes in other cases as late evidence lands (follow-up).
- No device or production validation of the 3–4 Oct fixes is claimed here.
