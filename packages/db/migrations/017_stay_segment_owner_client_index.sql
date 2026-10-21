-- Named patterns on Today (location v3 PR 14): stays found by owner and client segment id.
create index if not exists idx_stay_segments_owner_client
  on stay_segments(workspace_id, user_id, client_segment_id)
  where client_segment_id is not null;
