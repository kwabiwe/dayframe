-- Places search, sections and last visit (location v3 PR 16c): each place's last visit and its
-- visits in the last 30 days are read from the person's current stays at that place.
create index if not exists idx_stay_segments_place_visits
  on stay_segments(workspace_id, user_id, place_id, started_at)
  include (stopped_at)
  where place_id is not null and status <> 'superseded';
