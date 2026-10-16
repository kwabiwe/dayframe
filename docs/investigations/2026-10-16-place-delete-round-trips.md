# Deleting a saved place failed with round-trip history (16 Oct 2026)

Evidence record for location v3 bug 6 (owner notes item 6). Code at `origin/main` `35d6b2ba`; production and staging read only, counts only. No place names, addresses or coordinates are recorded here.

## Symptom

On iPhone, Places › a place › Delete showed "Couldn't delete this place. Try again." for most real places; trying again never helped.

## Findings

- The route ran one `delete from places`. Every location reference to a place (`stay_segments.place_id`, `commute_segments.from_place_id` / `to_place_id`, `location_evidence.saved_place_id`, `time_entries.place_id`, …) is `ON DELETE SET NULL`; geofences and match feedback cascade.
- Postgres applies `SET NULL` as one update per referencing column. Each update of `commute_segments` fires the `dayframe_commute_owner_links` before-update trigger, which re-checks both place columns. A round trip or "time away" row names the place at both ends, so clearing one end finds the other still pointing at the place being deleted; the trigger raises and the whole delete rolls back. The route returned a bodiless 500 and the iPhone its generic alert.
- Production: 4 of 6 places had such rows (Home had 99). Staging: the old home place had 76. The place's role is not involved.
- Why tests missed it: the only delete test mocked the query, and the Postgres validator deleted journeys before the place.

## Fix (#449)

- `deletePlace` clears both journey ends in one update and then deletes, in one transaction. Past blocks, stays and journeys keep their times and lose the link.
- Location writers take the per-user owner advisory lock and lock stays before journeys; the delete takes the same lock for every user whose history can name the place (user-id order) before touching rows, so it waits for a running replay instead of deadlocking with it. It waits up to 10 s for each lock (then a "busy" 409) and retries a deadlock or serialization abort.
- A database refusal answers 409 with a sentence; the iPhone and web Places show it (web: inside the open dialog).

## Coverage and limits

- `scripts/validate-location-v2-db.ts` › `validatePlaceDeleteWithSamePlaceJourneys` on the real schema (base and ordered): the plain delete is still refused by the trigger (kept visible), the fixed delete succeeds and keeps history unlinked, a cross-workspace delete is a no-op, a delete waiting past its lock timeout is busy, and a second session holding the owner lock and a stay, then locking a journey, makes the delete wait and succeed. Without the owner lock that two-session case ends in `deadlock detected`.
- Not covered: a non-location writer (a block edit setting its place to the one being deleted) can still meet the delete in a deadlock; Postgres aborts one side and the delete retries.
- Guardrail recorded in `.codex/reference/database.md` (Migration Safety).
