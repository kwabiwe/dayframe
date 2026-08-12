# Location Review nearby POIs and one-time locations

Date: 2026-08-12

## Problem

An unknown visit could show its map centre but required a user to invent a search query or save a permanent Dayframe place. The empty `No saved place` answer described an implementation state instead of helping answer where the visit happened. Apple map labels were visible context, but Dayframe had no explicit nearby-POI proposal or privacy-bounded one-time place identity.

## Approved behavior

- Unknown stay evidence automatically requests Apple points of interest within 750 metres and shows at most three under `Nearby places`.
- Results retain Apple relevance order; distance is a deterministic tie-breaker. They are nearby suggestions, never claims that Dayframe inferred the exact venue.
- A typed query of two or more characters replaces the nearby list through the existing MapKit completion search. Clearing restores the nearby results.
- Commutes and visits already matched to a saved place do not issue the proactive request.
- Selection updates the transient map proposal and defaults `Save for future visits` off. Off records the name once; on creates the existing saved-place/learning identity.
- Failure or offline state retains explicit search, map-pin selection, and recording without a place.

## Data and privacy contract

`time_entries.place_label` is a nullable, trimmed, 120-character one-time name. The database enforces that an entry has at most one of `place_id` and `place_label`. `record_poi_once` is stay-only and stores only the action's trimmed name. Apple identifiers, addresses, POI coordinates, and raw search responses remain native/React presentation data and do not enter `activity_events`, `time_entries`, audit metadata, logs, or exports.

Ordinary entry edits preserve a one-time label. Explicit saved-place edits clear it. Read models expose the coalesced `placeName` and `placeKind` (`saved`, `one_time`, or null). Reports group one-time labels using case-insensitive whitespace normalization; Timeline/history, Calendar, Search, integrations, and export present the name as a location.

## Motion contract

- Trigger: opening an unmatched stay starts nearby loading; entering the second query character replaces nearby content; clearing restores it; selection inserts the proposal and save toggle.
- Owner: React Native owns local section presence/layout transitions. The native MapKit module owns request lifetime only and never animates UI or map recentering.
- Entrance/update/exit: existing local presence/layout transitions apply to nearby/loading/results, typed results, and the selected-place/toggle row. The map proposal updates statically.
- Surrounding layout: the existing scroll view absorbs section height changes; no fixed screen coordinate or competing animation owner is introduced.
- Interruption: nearby and typed searches use independent request generations and cancellation. Clearing, reopening, navigation, or a newer request invalidates stale work.
- Async rollback: search failure replaces results with concise fallback copy while preserving manual actions and the draft. Resolution failure leaves selection, toggle, edits, and times intact.
- Reduce Motion: shared helpers make section changes immediate or opacity-only; map updates do not animate.

## Validation boundary

Focused tests cover native ordering/deduplication/cancellation/failure, mobile load/replacement/clear/stale/fallback contracts, schema and transactional one-time resolution, report/search/read/export paths, and Calendar/history location presentation. Hosted validation requires the new migration before the Preview API is exercised. Physical-device appearance, VoiceOver, Dynamic Type, Reduce Motion, and real nearby ranking remain individually recorded evidence; simulator results do not prove them.
