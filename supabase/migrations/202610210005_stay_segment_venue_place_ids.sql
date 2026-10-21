-- Venue Place IDs (location v3 PR 8, PRD D19 A7, design §6.3 and §14). Apple's terms allow storing
-- Place IDs but not its map data, so Dayframe keeps the ID and the iPhone looks the name up next
-- to an Apple map; no Apple names, addresses or coordinates are added here.
--
-- venue_place_id: the Apple venue the person picked when recording this stay (their confirmed
-- choice; "you picked it here before" for the venue ranker, design §6.1).
-- suggested_venue_place_id: the venue the iPhone's ranker was confident about while the stay was
-- on screen (design §6.3); the iPhone shows its name, web shows "Unknown place".
--
-- A Place ID points at a place the person was, so it is treated as location data: exported with
-- stay_segments, deleted with the workspace, kept out of logs and analytics. Additive; apply to
-- staging before the server Preview that writes them, and to production before that server
-- deploys (migration → server → phone). No RLS change: stay_segments' owner policies cover them.
alter table public.stay_segments
  add column if not exists venue_place_id text;
alter table public.stay_segments
  add column if not exists suggested_venue_place_id text;

-- "Venues you picked near here": the person's confirmed venues within 150 m of a stay.
create index if not exists idx_stay_segments_venue_history
  on public.stay_segments using gist(centre)
  where venue_place_id is not null;
