# Location physical stops and trips with stops — 1 October 2026

Evidence record for the physical-stop PR. Canonical behaviour lives in [PRD](../PRD.md) and [Location learning guardrails](../../.codex/reference/location-learning.md); delivery state lives in the [tracker](../feature-fix-tracker.md). Private traces, phone copies and probes stay outside Git.

## Problem

Stop existence was decided by the same gates that decide whether a stop is worth showing: saved/learned stays needed five minutes of timestamped support and unknown stays ten minutes. Working stays were also formed per place identity. A genuine stop that was short, or that straddled a saved-place edge or mixed accuracy classes, was erased before journey formation, and the journeys either side merged into one same-place round trip that counted stop time as travel.

## Evidence (retained staging traces, offline replay at `f5a967a`)

- 29 Sep pickup: completed native Visit 550 s, slow accurate fixes spread over 92 s within about 34 m, movement either side. The working stay was dropped at the 600 s unknown gate. Output: one 710 s Home round trip.
- 25 Sep car-park and local walking: every coordinate from about 18:19 to 18:42 UTC stayed within about 86 m of a 25-minute broad Visit, with 11–13 m/s movement either side. Identity transitions split it into fragments of at most 398 s, each dropped. Removing the nearby saved place did not change the result, so a duration-only exception would not fix it. Output: one 2,393 s Home round trip.
- Owner labels for three further Visits on 28–29 Sep: kerbside drop-offs or pickups of about 30–60 seconds. iOS reported 297 s, 372 s and 430 s. One case had two slow fixes one second apart. **A native Visit's duration therefore cannot establish a stop**, and slow fixes must be spread over time.
- Google Timeline on the same phone (comparison, not ground truth) merged those brief stops into drives and showed the 8–12 minute stops as uncertain visits. Dayframe boundaries matched it within about one minute.

## Owner decisions

- A short stop between journeys is recorded as **one trip containing the stop** (option A), not separate drive/stop/drive items. Longer stops that qualify as their own visit still split journeys.
- A brief stop at a saved place should later influence the trip's name; brief stops at unknown places should not. Naming is follow-up work.

## Change

- `physicalStops.ts` detects stops independently of identity: accurate (≤65 m) independent slow fixes clustered within 100 m. Movement must be observed on both sides. Corroboration requires either a completed Visit plus at least two slow fixes spread at least 60 s, or three slow fixes spread at least 180 s. Stop times come from observed movement; a Visit estimate is only clamped inside those bounds. Stops shorter than 180 s are ignored.
- Uncovered corroborated stops become ordinary unknown stays with `formation: "physical_stop"` and nearby saved places as candidates only.
- Legs meeting at an unknown stay below the 20-minute visit Review threshold are assembled into one trip with coordinate-free `stops`. The trip keeps the endpoint-based identity of the former round trip. Trips with stops are never automatically logged (`journey_contains_stop`).
- No migration: stops and formation use existing segment `metadata`. `algorithmVersion` is unchanged because it keys evidence and segment rows.

## Independent review fixes (Codex, at `929f813`)

- Nearby round trips disappeared when neither leg qualified alone. Trips are now derived and qualified over the whole span with stops as waypoints.
- Accepted broad (>65 m) fixes showing movement were ignored and bridged into a stop. They now break clusters and count as departure when certainly beyond the stop.
- Replay could retire an open leg's Review when its decided partner blocked the merged trip. Replay now falls back to the trip's unaffected legs.
- Review evidence reported a recorded stop as an evidence gap with a split suggestion. Stop intervals are now removed first.

A re-review at `e0bf5f6` found two more issues:

- The engine still counted a recorded stop's interval as a route observation gap, lowering confidence and continuity. Stop intervals are now subtracted from engine gaps too; real unobserved gaps beside a stop are still reported.
- Two slow clusters about 140 m apart could form two stops with identical boundaries, because clusters split at 100 m while departure needs 150 m. Clusters now end only where departure is evident, and overlapping stops are rejected.

A third review at `c51c3ba` found that replay checked only a trip's endpoint stays. If a late fix split an already-decided stay into short stops, the stops were correctly held but their enclosing trip could still persist across the decided time. Replay now also treats a trip as blocked when any interior stop is held, then applies the same leg fallback; legs touching the held stop are excluded.

A review of the stacked arrival PR at `acbda42` found two more issues in this PR:

- A trip could absorb a stop when one side of it had no movement evidence, claiming unobserved time as travel. Every portion of a trip now needs an accurate movement sample; otherwise the legs are kept.
- A decided or manual row could keep an interior stop's ID while late evidence moved the engine's boundaries, and replay still wrote the enclosing trip. Replay now blocks such trips. A further review found that the aligned fallback legs kept stale route evidence and metrics, so they are now re-derived inside the decided stop's persisted boundaries and omitted if they no longer qualify (both persistence profiles).

A later re-review (`bd8c9e5`) found that stop clustering ignored an accurate Visit elsewhere, so slow fixes either side of a Visit 1.5 km away formed one stop. A credible Visit elsewhere now splits the cluster and bounds the stop, without counting as a slow fix.

Each has a regression test that failed before its fix. The offline corpus result below is unchanged by these fixes.

## Offline corpus result (private, times only)

Comparing `main` with the change over the retained 25–29 Sep trace and the 25 Sep staging snapshot:

- The 29 Sep pickup is now a physical stop (about 501 s) inside the same Home trip ID.
- The 29 Sep morning and 27 Sep stops of 11–12 minutes now sit inside one trip each, instead of two short journeys.
- The 25 Sep local stop (about 24.5 minutes) now separates two journeys of about 7–8 minutes, with the stop as an unknown visit listing the nearby saved place as a candidate.
- The three labelled brief stops are unchanged. No other segment changed.
- Engine time on a laptop: 409 rows 3.7 → 5.0 ms; a synthetic 7-day replication of 2,863 rows 59 → 78 ms. This is not device or hosted evidence.

## Not established

- The thresholds are hypotheses checked against a small labelled set. Long stationary traffic queues in which iOS reports a Visit are not represented. A false split would show as two journeys; a commute merge action does not exist yet.
- No hosted, staging, device or production validation is claimed here.
- Output timeliness (quiet arrivals promoted only after departure, foreground-only native drain) and segment identity churn are unchanged and remain follow-ups.
