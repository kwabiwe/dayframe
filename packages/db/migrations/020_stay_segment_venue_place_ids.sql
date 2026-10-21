-- Venue Place IDs (location v3 PR 8, design §6.3 and A7): Apple Place IDs, never names.
alter table stay_segments add column if not exists venue_place_id text;
alter table stay_segments add column if not exists suggested_venue_place_id text;
create index if not exists idx_stay_segments_venue_history
  on stay_segments using gist(centre)
  where venue_place_id is not null;
