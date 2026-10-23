-- Location timeline reads (location v4 step 8, GET /api/timeline). See packages/db/migrations/021.
-- A day's trips by start time; the person's open and very long stays, which the day's bounded stay read
-- (31 days back) can't reach; and a block's source event by the segment it names (`clientSegmentId`, or
-- a Review correction's `segmentId`), so a block moved to another day keeps its link without a scan.
--
-- Additive, no backfill, no RLS change. Apply to staging, then production, before the server that reads
-- with them deploys (migration → server).
create index if not exists idx_commute_segments_user_time
  on public.commute_segments(workspace_id, user_id, started_at)
  include (stopped_at)
  where status <> 'superseded';
create index if not exists idx_stay_segments_open_or_long
  on public.stay_segments(workspace_id, user_id, started_at)
  include (stopped_at)
  where status <> 'superseded' and client_segment_id is not null
    and (stopped_at is null or stopped_at - started_at > interval '31 days');
create index if not exists idx_activity_events_client_segment
  on public.activity_events(workspace_id, user_id, (raw_payload ->> 'clientSegmentId'))
  where raw_payload ? 'clientSegmentId';
create index if not exists idx_activity_events_segment
  on public.activity_events(workspace_id, user_id, (raw_payload ->> 'segmentId'))
  where raw_payload ? 'segmentId';
