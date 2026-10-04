# Stop beside a saved place — 4 October 2026

Status: In review (PR #222). Evidence is private staging data, summarised here as times, counts and distances from saved-place pins only.

## What happened

A 4 Oct evening test on staging (combined PR #219 + #221 build): drive from Home about 20:08 BST, parked about 20:12 in a car park beside the School, left about 20:36, home about 20:39. Google's timeline showed the stop from 20:13 to 20:36.

Dayframe showed a commute from 20:09 to 20:27, then a School stay from 20:27 to 20:36. The first twenty minutes of the stop were reported as travel.

## Evidence

- Every reading had reached the server by 20:42, so this was not a delivery delay. The drive home was recorded but still `closed` until its ten-minute finalisation lag passed.
- The parked fixes were 123–126 m from the School pin (radius 100 m), at 3.5–7.8 m accuracy and 0–0.06 m/s: three stationary fixes and a significant-change mirror. None was a strong match; all were plausible (inside the 25 m tolerance band plus accuracy).
- The phone was silent from 20:15:06 to 20:27:16, which is 12 min 10 s, just over the twelve-minute continuity limit.
- Saved-place silence may be bridged only between strong fixes, so the stay closed at 20:15:06 (too short to keep) and restarted at 20:27:16. Without the School saved, the same readings would have been an unknown cluster, and unknown clusters bridge up to sixty minutes. The saved place made continuity stricter.
- The physical-stop detector found the whole stop, but a promoted stay takes precedence over any physical stop it overlaps.
- The drive away passed inside the circle (86–91 m at 9–11 m/s) and triggered a School geofence entry at 20:36:27. These are moving readings, not presence.
- The morning stop at the same school (07:53–08:17) parked 67–76 m from the pin, inside the circle, so it stays a School visit.

## Decision and change

The owner chose option 1: the cluster's centre decides. PR #222:

- treats a saved stay with still fixes and no accurate fix inside the circle (an edge cluster: tolerance-band and plausible matches only) as an unknown cluster for silence, membership and departure;
- labels a stay as the saved place only when the centre of its still accurate fixes lies inside the circle, or when iOS placed the device inside during that visit before the last still fix: a genuine geofence entry not followed by an exit, or a Visit wholly inside the circle. Otherwise the stay is unknown, with the place as a candidate. (The first version also accepted a corroborated arrival and a Visit only strongly matched; both reviews below narrowed it.)

The synthetic `schoolEdgeStopFixture` reproduces the server's output exactly on `main`. With the change, the same evidence gives one unknown stay from 19:13:16 to 19:36:41 UTC (20:13–20:36 BST), with the School as a candidate. Across the 25–29 Sep corpus and the 26 Sep–4 Oct staging week, output and identities are unchanged. In 47 saved stays there, the still centre never left its circle; the largest was 94 %, a gym visit corroborated by its geofence entry.

## Review fixes

The first Codex review found four ways the rules could still mislabel or merge stays, and the capture simulator added two more:

- Readings could join an edge stay past a pending exit, giving invalid departure bounds.
- A nearby reading could absorb a separate Visit elsewhere, merging two visits.
- A lone Visit beside the circle, with no still reading, became the saved place.
- A reading inside the matcher's 25 m tolerance band, but outside the circle, counted as iOS placing the device inside.
- A drive through the circle before parking left a geofence entry, followed by its exit, that counted as presence.
- A completed Visit's averaged coordinate could land inside the circle.

Fixed:

- Edge membership now waits for pending exits and outside evidence to resolve.
- Edge stays are defined by having still fixes and no accurate fix inside the circle. A first definition by still-fix centre was rejected because it merged a real drop-off into the next stop.
- iOS inside proof needs either a Visit wholly inside the circle or a latest genuine geofence transition that is an entry; simulated callbacks and snapshot pairs do not count.
- Without a still fix, only that proof keeps the place.

Each fix has a regression, including comparisons of stays with and without the place saved.

A second review found four more gaps:

- Corroborated arrivals and broad-Visit support kept the saved identity although their corroboration rests on tolerance-band matches. They now shape timing only, and identity always needs the still centre or this episode's iOS proof.
- Snapshot pairs straddling the proof window were not recognised. They are now paired across the whole journal.
- A Visit reused from an earlier episode could prove a later one. Reused Visits are marked and excluded.
- An in-band return reading could still erase a Visit elsewhere. A credible Visit elsewhere now ends an edge cluster.

The edge scan is now incremental: dense edge input costs about the same as with no place saved.

A third review found three ways an edge cluster still differed from an unknown one:

- A same-place reading on the far side of the circle joined the cluster, merging two stops into one saved visit. Now a still reading of the place's band beyond the cluster starts a new stay.
- A displaced completed Visit processed before its own arrival callback ended its own stay. Now a Visit is elsewhere only when every callback for it is.
- A geofence exit followed by readings in the band produced inverted bounds. Now same-place exits do not affect an edge cluster, which was never inside the circle; its readings show when it left.

Every case from all three reviews is a regression test.

## Not established

- No staging or device validation yet.
- A stay that begins with a reading just beyond the tolerance band and then moves into it starts at its first in-band reading. Merging the earlier reading could fold a neighbouring shop visit into the place, so it is not done.
- A genuine visit whose readings centre just outside a small circle and that iOS never confirms becomes a candidate rather than the place. Enlarging that place's radius resolves it.
