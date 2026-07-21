create extension if not exists pgcrypto;
create extension if not exists postgis;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text,
  daily_goal_minutes integer not null default 480 check (daily_goal_minutes between 1 and 1440),
  weekly_goal_minutes integer not null default 2400 check (weekly_goal_minutes between 1 and 10080),
  created_at timestamptz not null default now()
);

alter table users add column if not exists password_hash text;
alter table users add column if not exists daily_goal_minutes integer not null default 480;
alter table users add column if not exists weekly_goal_minutes integer not null default 2400;

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  user_agent text,
  last_used_at timestamptz
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  color text not null default 'steel',
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  color text not null default 'steel',
  is_pinned boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  color text not null default 'lime',
  billable boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  color text not null default 'steel',
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tags_workspace_normalized_name_key unique (workspace_id, normalized_name),
  constraint tags_id_workspace_key unique (id, workspace_id)
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  platform text not null,
  name text not null,
  push_token text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists event_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  source text not null,
  display_name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, source)
);

create table if not exists places (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  latitude double precision,
  longitude double precision,
  radius_meters integer not null default 100,
  priority integer not null default 5,
  default_project_id uuid references projects(id) on delete set null,
  default_category_id uuid references categories(id) on delete set null,
  default_activity_description text,
  auto_start boolean not null default false,
  logging_enabled boolean not null default true,
  raw_location_retention_days integer not null default 7,
  created_at timestamptz not null default now()
);

create table if not exists learned_places (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  place_id uuid references places(id) on delete set null,
  cluster_key text not null,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters integer not null default 160,
  visit_count integer not null default 1,
  distinct_day_count integer not null default 1,
  sample_count integer not null default 1,
  total_dwell_seconds bigint not null default 0,
  longest_dwell_seconds bigint not null default 0,
  average_accuracy_meters double precision,
  max_cluster_spread_meters double precision,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_started_at timestamptz,
  last_stopped_at timestamptz,
  confidence text not null default 'low',
  classification text not null default 'noise',
  status text not null default 'candidate',
  address jsonb,
  poi_name text,
  formatted_address text,
  geocoded_at timestamptz,
  raw_location_retention_days integer not null default 7,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learned_places_radius_positive check (radius_meters > 0),
  constraint learned_places_visit_count_positive check (visit_count > 0),
  constraint learned_places_distinct_day_count_positive check (distinct_day_count > 0),
  constraint learned_places_sample_count_positive check (sample_count > 0),
  constraint learned_places_total_dwell_nonnegative check (total_dwell_seconds >= 0),
  constraint learned_places_longest_dwell_nonnegative check (longest_dwell_seconds >= 0),
  constraint learned_places_classification_check check (classification in ('place_candidate', 'one_off_activity', 'noise')),
  constraint learned_places_status_check check (status in ('candidate', 'accepted', 'ignored')),
  unique (workspace_id, user_id, cluster_key)
);

create table if not exists geofences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  place_id uuid not null references places(id) on delete cascade,
  center geography(Point, 4326),
  radius_meters integer not null default 100,
  priority integer not null default 5,
  is_broad boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  trigger_source text not null,
  trigger_type text not null,
  place_id uuid references places(id) on delete set null,
  action text not null,
  project_id uuid references projects(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  activity_description text,
  confidence_threshold text not null default 'medium_high',
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  device_id uuid references devices(id) on delete set null,
  client_event_id text,
  source text not null,
  event_type text not null,
  occurred_at timestamptz not null,
  confidence text not null,
  raw_payload jsonb not null default '{}',
  suggested_project_id uuid references projects(id) on delete set null,
  suggested_category_id uuid references categories(id) on delete set null,
  suggested_place_id uuid references places(id) on delete set null,
  review_status text not null default 'confirmed',
  created_at timestamptz not null default now()
);

create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  place_id uuid references places(id) on delete set null,
  source text not null default 'manual_app',
  confidence text not null default 'high',
  review_status text not null default 'confirmed',
  description text,
  started_at timestamptz not null,
  stopped_at timestamptz,
  created_from_event_id uuid references activity_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint time_entries_stops_after_start check (stopped_at is null or stopped_at > started_at),
  constraint time_entries_id_workspace_key unique (id, workspace_id)
);

create table if not exists time_entry_tags (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  time_entry_id uuid not null,
  tag_id uuid not null,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint time_entry_tags_entry_workspace_fkey
    foreign key (time_entry_id, workspace_id) references time_entries(id, workspace_id) on delete cascade,
  constraint time_entry_tags_tag_workspace_fkey
    foreign key (tag_id, workspace_id) references tags(id, workspace_id) on delete cascade,
  primary key (time_entry_id, tag_id)
);

create table if not exists stay_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  place_id uuid references places(id) on delete set null,
  learned_place_id uuid references learned_places(id) on delete set null,
  device_id text,
  client_segment_id text,
  algorithm_version text,
  status text not null default 'candidate',
  source text not null default 'legacy',
  started_at timestamptz not null,
  stopped_at timestamptz,
  start_lower_bound_at timestamptz,
  start_upper_bound_at timestamptz,
  stop_lower_bound_at timestamptz,
  stop_upper_bound_at timestamptz,
  centre geography(Point, 4326),
  radius_m double precision,
  max_spread_m double precision,
  confidence text not null default 'low',
  arrival_confidence text,
  departure_confidence text,
  raw_sample_count integer not null default 0,
  sample_count integer not null default 0,
  continuity_status text not null default 'uncertain_gap',
  review_status text not null default 'needs_review',
  created_from_event_id uuid references activity_events(id) on delete set null,
  parent_segment_id uuid references stay_segments(id) on delete set null,
  superseded_by_segment_id uuid references stay_segments(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  event_id uuid references activity_events(id) on delete set null,
  location_segment_id uuid,
  type text not null,
  title text not null,
  suggested_project_id uuid references projects(id) on delete set null,
  suggested_category_id uuid references categories(id) on delete set null,
  suggested_place_id uuid references places(id) on delete set null,
  suggested_started_at timestamptz,
  suggested_stopped_at timestamptz,
  confidence text not null default 'low',
  status text not null default 'open',
  ignored_scope text,
  notes text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists calendar_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  external_id text,
  title text not null,
  started_at timestamptz not null,
  stopped_at timestamptz not null,
  suggested_project_id uuid references projects(id) on delete set null,
  confidence text not null default 'hint',
  created_at timestamptz not null default now()
);

create table if not exists health_sleep_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  external_sample_id text,
  provider text not null default 'healthkit',
  source_name text,
  sleep_stage text not null default 'asleep_unspecified',
  started_at timestamptz not null,
  stopped_at timestamptz not null,
  source_device_id uuid references devices(id) on delete set null,
  raw_payload jsonb not null default '{}',
  imported_at timestamptz not null default now(),
  unique (workspace_id, provider, external_sample_id)
);

create table if not exists health_workouts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  external_sample_id text,
  provider text not null default 'healthkit',
  workout_type text not null,
  started_at timestamptz not null,
  stopped_at timestamptz not null,
  duration_seconds integer,
  distance_meters double precision,
  energy_kcal double precision,
  source_device_id uuid references devices(id) on delete set null,
  raw_payload jsonb not null default '{}',
  imported_at timestamptz not null default now()
);

create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  status text not null default 'not_connected',
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider)
);

create table if not exists integration_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  scopes text[] not null default '{}',
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists external_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  external_workspace_id text,
  display_name text,
  token_secret_ref text,
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, external_workspace_id)
);

create table if not exists external_entity_refs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  external_id text not null,
  entity_type text not null,
  entity_id uuid not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, entity_type, external_id)
);

create table if not exists import_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  provider text not null,
  mode text not null default 'dry_run',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running',
  summary jsonb not null default '{}',
  error text
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists location_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  device_id text not null,
  client_evidence_id text not null,
  client_batch_id text not null,
  evidence_type text not null check (evidence_type in (
    'standard_location', 'significant_change', 'visit', 'geofence_enter',
    'geofence_exit', 'geofence_state', 'location_paused', 'location_resumed', 'provider_status'
  )),
  occurred_at timestamptz not null,
  ended_at timestamptz check (ended_at is null or ended_at >= occurred_at),
  coordinate geography(Point, 4326),
  horizontal_accuracy_m double precision check (horizontal_accuracy_m is null or horizontal_accuracy_m >= 0),
  altitude_m double precision,
  speed_mps double precision check (speed_mps is null or speed_mps >= 0),
  course_degrees double precision check (course_degrees is null or course_degrees between 0 and 360),
  saved_place_id uuid references places(id) on delete set null,
  geofence_identifier text,
  accepted boolean not null default true,
  rejection_reason text,
  algorithm_version text not null,
  time_zone text not null,
  is_simulated boolean,
  metadata jsonb not null default '{}',
  received_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id, device_id, client_evidence_id)
);

create table if not exists commute_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  device_id text not null,
  client_segment_id text not null,
  algorithm_version text not null,
  status text not null default 'candidate',
  started_at timestamptz not null,
  stopped_at timestamptz not null check (stopped_at > started_at),
  start_lower_bound_at timestamptz,
  start_upper_bound_at timestamptz,
  stop_lower_bound_at timestamptz,
  stop_upper_bound_at timestamptz,
  from_stay_segment_id uuid not null references stay_segments(id) on delete cascade,
  to_stay_segment_id uuid not null references stay_segments(id) on delete cascade,
  from_place_id uuid references places(id) on delete set null,
  to_place_id uuid references places(id) on delete set null,
  route_distance_m double precision,
  straight_line_distance_m double precision,
  route_sample_count integer not null default 0,
  max_gap_seconds integer,
  continuity_status text not null default 'uncertain_gap',
  confidence text not null default 'low',
  created_from_event_id uuid references activity_events(id) on delete set null,
  parent_segment_id uuid references commute_segments(id) on delete set null,
  superseded_by_segment_id uuid references commute_segments(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, device_id, client_segment_id)
);

create table if not exists location_segment_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  evidence_id uuid not null references location_evidence(id) on delete cascade,
  stay_segment_id uuid references stay_segments(id) on delete cascade,
  commute_segment_id uuid references commute_segments(id) on delete cascade,
  sequence_index integer not null check (sequence_index >= 0),
  role text not null check (role in (
    'inside', 'outside', 'arrival_anchor', 'departure_anchor', 'route',
    'gap_boundary', 'rejected_outlier', 'manual_boundary'
  )),
  created_at timestamptz not null default now(),
  check ((stay_segment_id is not null)::integer + (commute_segment_id is not null)::integer = 1)
);

create table if not exists place_match_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  place_id uuid references places(id) on delete cascade,
  anchor geography(Point, 4326),
  radius_m double precision not null check (radius_m between 20 and 160),
  source_cluster_key text,
  rejected_label text,
  correction_count integer not null default 1 check (correction_count > 0),
  first_corrected_at timestamptz not null default now(),
  last_corrected_at timestamptz not null default now(),
  status text not null default 'active',
  expires_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function dayframe_enforce_location_owner_links()
returns trigger
language plpgsql
as $$
begin
  if tg_table_name = 'location_evidence' then
    if new.saved_place_id is not null and not exists (
      select 1 from places where id = new.saved_place_id and workspace_id = new.workspace_id
    ) then raise exception 'Location evidence place must belong to its workspace'; end if;
  elsif tg_table_name = 'stay_segments' then
    if new.place_id is not null and not exists (
      select 1 from places where id = new.place_id and workspace_id = new.workspace_id
    ) then raise exception 'Stay place must belong to its workspace'; end if;
    if new.learned_place_id is not null and not exists (
      select 1 from learned_places
      where id = new.learned_place_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Learned place must belong to the stay owner'; end if;
    if new.created_from_event_id is not null and not exists (
      select 1 from activity_events
      where id = new.created_from_event_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Stay event must belong to the stay owner'; end if;
    if new.parent_segment_id is not null and not exists (
      select 1 from stay_segments
      where id = new.parent_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Parent stay must belong to the stay owner'; end if;
    if new.superseded_by_segment_id is not null and not exists (
      select 1 from stay_segments
      where id = new.superseded_by_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Superseding stay must belong to the stay owner'; end if;
  elsif tg_table_name = 'commute_segments' then
    if not exists (
      select 1 from stay_segments
      where id = new.from_stay_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) or not exists (
      select 1 from stay_segments
      where id = new.to_stay_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Commute endpoints must belong to the commute owner'; end if;
    if new.from_place_id is not null and not exists (
      select 1 from places where id = new.from_place_id and workspace_id = new.workspace_id
    ) then raise exception 'Commute origin place must belong to its workspace'; end if;
    if new.to_place_id is not null and not exists (
      select 1 from places where id = new.to_place_id and workspace_id = new.workspace_id
    ) then raise exception 'Commute destination place must belong to its workspace'; end if;
    if new.created_from_event_id is not null and not exists (
      select 1 from activity_events
      where id = new.created_from_event_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Commute event must belong to the commute owner'; end if;
    if new.parent_segment_id is not null and not exists (
      select 1 from commute_segments
      where id = new.parent_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Parent commute must belong to the commute owner'; end if;
    if new.superseded_by_segment_id is not null and not exists (
      select 1 from commute_segments
      where id = new.superseded_by_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Superseding commute must belong to the commute owner'; end if;
  elsif tg_table_name = 'location_segment_evidence' then
    if not exists (
      select 1 from location_evidence
      where id = new.evidence_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Evidence link must belong to its owner'; end if;
    if new.stay_segment_id is not null and not exists (
      select 1 from stay_segments
      where id = new.stay_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Stay evidence link must belong to its owner'; end if;
    if new.commute_segment_id is not null and not exists (
      select 1 from commute_segments
      where id = new.commute_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Commute evidence link must belong to its owner'; end if;
  elsif tg_table_name = 'place_match_feedback' then
    if new.place_id is not null and not exists (
      select 1 from places where id = new.place_id and workspace_id = new.workspace_id
    ) then raise exception 'Place feedback must belong to its workspace'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dayframe_location_evidence_owner_links on location_evidence;
create trigger dayframe_location_evidence_owner_links before insert or update on location_evidence
for each row execute function dayframe_enforce_location_owner_links();
drop trigger if exists dayframe_stay_owner_links on stay_segments;
create trigger dayframe_stay_owner_links before insert or update on stay_segments
for each row execute function dayframe_enforce_location_owner_links();
drop trigger if exists dayframe_commute_owner_links on commute_segments;
create trigger dayframe_commute_owner_links before insert or update on commute_segments
for each row execute function dayframe_enforce_location_owner_links();
drop trigger if exists dayframe_segment_evidence_owner_links on location_segment_evidence;
create trigger dayframe_segment_evidence_owner_links before insert or update on location_segment_evidence
for each row execute function dayframe_enforce_location_owner_links();
drop trigger if exists dayframe_place_feedback_owner_links on place_match_feedback;
create trigger dayframe_place_feedback_owner_links before insert or update on place_match_feedback
for each row execute function dayframe_enforce_location_owner_links();

create or replace function dayframe_apply_review_owner()
returns trigger
language plpgsql
as $$
declare
  event_owner uuid;
  event_workspace uuid;
begin
  if new.event_id is not null then
    select user_id, workspace_id into event_owner, event_workspace
    from activity_events where id = new.event_id;
    if event_owner is null then raise exception 'Review event does not exist'; end if;
    if new.user_id is null then new.user_id := event_owner;
    elsif new.user_id <> event_owner then raise exception 'Review owner must match event owner'; end if;
    if new.workspace_id <> event_workspace then raise exception 'Review workspace must match event workspace'; end if;
  end if;
  if new.location_segment_id is not null and not exists (
    select 1 from stay_segments
    where id = new.location_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    union all
    select 1 from commute_segments
    where id = new.location_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
  ) then raise exception 'Review segment must belong to the review owner'; end if;
  return new;
end;
$$;

drop trigger if exists dayframe_review_owner on review_items;
create trigger dayframe_review_owner
before insert or update of event_id, user_id, workspace_id, location_segment_id on review_items
for each row execute function dayframe_apply_review_owner();

alter table activity_events add column if not exists client_event_id text;
alter table automation_rules add column if not exists activity_description text;
alter table categories add column if not exists is_pinned boolean not null default false;
alter table health_workouts add column if not exists external_sample_id text;
alter table health_workouts add column if not exists provider text not null default 'healthkit';
alter table health_workouts add column if not exists duration_seconds integer;
alter table health_workouts add column if not exists distance_meters double precision;
alter table health_workouts add column if not exists energy_kcal double precision;
alter table health_workouts add column if not exists raw_payload jsonb not null default '{}';
alter table review_items add column if not exists user_id uuid references users(id) on delete cascade;
alter table review_items add column if not exists location_segment_id uuid;

update review_items review
set user_id = event.user_id
from activity_events event
where review.event_id = event.id and review.user_id is null;

create or replace function dayframe_apply_review_owner()
returns trigger
language plpgsql
as $$
declare
  event_owner uuid;
  event_workspace uuid;
begin
  if new.event_id is not null then
    select user_id, workspace_id into event_owner, event_workspace
    from activity_events where id = new.event_id;
    if event_owner is null then raise exception 'Review event does not exist'; end if;
    if new.user_id is null then
      new.user_id := event_owner;
    elsif new.user_id <> event_owner then
      raise exception 'Review owner must match event owner';
    end if;
    if new.workspace_id <> event_workspace then
      raise exception 'Review workspace must match event workspace';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dayframe_review_owner on review_items;
create trigger dayframe_review_owner
before insert or update of event_id, user_id, workspace_id on review_items
for each row execute function dayframe_apply_review_owner();

alter table stay_segments add column if not exists learned_place_id uuid references learned_places(id) on delete set null;
alter table stay_segments add column if not exists device_id text;
alter table stay_segments add column if not exists client_segment_id text;
alter table stay_segments add column if not exists algorithm_version text;
alter table stay_segments add column if not exists status text not null default 'candidate';
alter table stay_segments add column if not exists source text not null default 'legacy';
alter table stay_segments add column if not exists start_lower_bound_at timestamptz;
alter table stay_segments add column if not exists start_upper_bound_at timestamptz;
alter table stay_segments add column if not exists stop_lower_bound_at timestamptz;
alter table stay_segments add column if not exists stop_upper_bound_at timestamptz;
alter table stay_segments add column if not exists centre geography(Point, 4326);
alter table stay_segments add column if not exists radius_m double precision;
alter table stay_segments add column if not exists max_spread_m double precision;
alter table stay_segments add column if not exists arrival_confidence text;
alter table stay_segments add column if not exists departure_confidence text;
alter table stay_segments add column if not exists sample_count integer not null default 0;
alter table stay_segments add column if not exists continuity_status text not null default 'uncertain_gap';
alter table stay_segments add column if not exists created_from_event_id uuid references activity_events(id) on delete set null;
alter table stay_segments add column if not exists parent_segment_id uuid references stay_segments(id) on delete set null;
alter table stay_segments add column if not exists superseded_by_segment_id uuid references stay_segments(id) on delete set null;
alter table stay_segments add column if not exists metadata jsonb not null default '{}';
alter table stay_segments add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_time_entries_workspace_started on time_entries(workspace_id, started_at desc);
create index if not exists idx_time_entries_active on time_entries(workspace_id, user_id) where stopped_at is null;
create index if not exists idx_activity_events_workspace_occurred on activity_events(workspace_id, occurred_at desc);
create unique index if not exists idx_activity_events_client_event_id on activity_events(workspace_id, user_id, client_event_id) where client_event_id is not null;
create index if not exists idx_categories_workspace_pinned on categories(workspace_id, is_pinned desc, name) where is_archived = false;
create index if not exists idx_learned_places_workspace_status on learned_places(workspace_id, user_id, status, last_seen_at desc);
create index if not exists idx_review_items_workspace_status on review_items(workspace_id, status, created_at desc);
create index if not exists idx_review_items_user_status on review_items(workspace_id, user_id, status, created_at desc);
create index if not exists idx_review_items_open_health_event on review_items(workspace_id, event_id, suggested_started_at desc, created_at desc) where status = 'open';
create index if not exists idx_activity_events_health_review_lookup on activity_events(workspace_id, user_id, event_type, occurred_at desc, id) where event_type in ('health_sleep_import', 'health_workout_import');
create index if not exists idx_time_entries_confirmed_overlap_lookup on time_entries(workspace_id, user_id, started_at, stopped_at) where review_status = 'confirmed';
create index if not exists idx_time_entries_completed_health_overlap_lookup on time_entries(workspace_id, user_id, started_at, stopped_at) where review_status in ('confirmed', 'accepted');
create index if not exists idx_time_entries_created_from_event_lookup on time_entries(workspace_id, user_id, created_from_event_id) where created_from_event_id is not null;
create unique index if not exists idx_health_sleep_segments_external_sample on health_sleep_segments(workspace_id, provider, external_sample_id) where external_sample_id is not null;
create unique index if not exists idx_health_workouts_external_sample on health_workouts(workspace_id, provider, external_sample_id) where external_sample_id is not null;
create index if not exists idx_geofences_center on geofences using gist(center);
create index if not exists idx_location_evidence_user_time on location_evidence(workspace_id, user_id, occurred_at);
create index if not exists idx_location_evidence_user_expiry on location_evidence(workspace_id, user_id, expires_at);
create index if not exists idx_location_evidence_batch on location_evidence(workspace_id, user_id, client_batch_id);
create index if not exists idx_location_evidence_coordinate on location_evidence using gist(coordinate);
create unique index if not exists idx_stay_segments_client_segment on stay_segments(workspace_id, user_id, device_id, client_segment_id) where device_id is not null and client_segment_id is not null;
create index if not exists idx_stay_segments_user_time on stay_segments(workspace_id, user_id, started_at, stopped_at);
create index if not exists idx_stay_segments_centre on stay_segments using gist(centre);
create index if not exists idx_place_match_feedback_user_place on place_match_feedback(workspace_id, user_id, place_id, last_corrected_at desc);
create index if not exists idx_place_match_feedback_anchor on place_match_feedback using gist(anchor);

create or replace function dayframe_delete_expired_location_evidence()
returns bigint
language plpgsql
as $$
declare
  deleted_count bigint;
begin
  delete from location_evidence evidence
  using (
    select id from location_evidence
    where expires_at < now()
    order by expires_at
    limit 10000
  ) expired
  where evidence.id = expired.id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
create index if not exists idx_integration_tokens_workspace on integration_tokens(workspace_id) where revoked_at is null;
create index if not exists idx_external_refs_workspace on external_entity_refs(workspace_id, provider, entity_type);
create index if not exists idx_import_runs_workspace on import_runs(workspace_id, provider, started_at desc);
create index if not exists idx_auth_sessions_token_hash on auth_sessions(token_hash) where revoked_at is null;
create index if not exists idx_auth_sessions_user_expiry on auth_sessions(user_id, expires_at desc);
