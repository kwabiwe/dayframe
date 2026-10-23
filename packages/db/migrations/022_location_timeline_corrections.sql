-- Timeline corrections (Location v4 §4, §14; build step 11, the v4 design's table). A correction is what
-- the person set on their location timeline: a place's place or times, a trip that wasn't one, a leg's
-- mode. It is tied to the time it covers, written event-first (an activity_events row, then this row,
-- then the segments it changes, in one transaction) and applied again by every replay. Never
-- coordinates: the target holds place IDs, modes and times. Location data: kept per user, exported and
-- deleted with the workspace.
create table if not exists location_timeline_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  subject text not null check (subject in ('place', 'trip', 'leg')),
  kind text not null check (kind in ('place', 'times', 'merge', 'split', 'delete', 'leg_mode', 'leg_boundary', 'leg_split', 'leg_merge')),
  span_started_at timestamptz not null,
  span_stopped_at timestamptz not null check (span_stopped_at > span_started_at),
  target jsonb not null default '{}'::jsonb check (
    jsonb_typeof(target) = 'object'
    and not (target ?| array['latitude', 'longitude', 'lat', 'lng', 'centre', 'center', 'coordinates'])
  ),
  created_from_event_id uuid references activity_events(id) on delete set null,
  created_at timestamptz not null default now(),
  replaced_at timestamptz,
  replaced_by_id uuid references location_timeline_corrections(id) on delete set null
);
create index if not exists idx_location_timeline_corrections_span
  on location_timeline_corrections(workspace_id, user_id, span_started_at, span_stopped_at)
  where replaced_at is null;
