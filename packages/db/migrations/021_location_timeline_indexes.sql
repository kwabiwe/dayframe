-- Location timeline reads (location v4 step 8, GET /api/timeline): a day's trips by start time, the
-- person's open and very long stays (which the day's bounded stay read can't reach), and a block's
-- source event by the segment it names. Additive, no backfill, no RLS change.
create index if not exists idx_commute_segments_user_time
  on commute_segments(workspace_id, user_id, started_at)
  include (stopped_at)
  where status <> 'superseded';
create index if not exists idx_stay_segments_open_or_long
  on stay_segments(workspace_id, user_id, started_at)
  include (stopped_at)
  where status <> 'superseded' and client_segment_id is not null
    and (stopped_at is null or stopped_at - started_at > interval '31 days');
create index if not exists idx_activity_events_client_segment
  on activity_events(workspace_id, user_id, (raw_payload ->> 'clientSegmentId'))
  where raw_payload ? 'clientSegmentId';
create index if not exists idx_activity_events_segment
  on activity_events(workspace_id, user_id, (raw_payload ->> 'segmentId'))
  where raw_payload ? 'segmentId';
