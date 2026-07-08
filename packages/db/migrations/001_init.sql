create extension if not exists pgcrypto;
create extension if not exists postgis;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null,
  password_hash text,
  created_at timestamptz not null default now()
);

alter table users add column if not exists password_hash text;

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
  color text not null default 'steel',
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
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
  raw_location_retention_days integer not null default 7,
  created_at timestamptz not null default now()
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
  constraint time_entries_stops_after_start check (stopped_at is null or stopped_at > started_at)
);

create table if not exists time_entry_tags (
  time_entry_id uuid not null references time_entries(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (time_entry_id, tag_id)
);

create table if not exists stay_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  place_id uuid references places(id) on delete set null,
  started_at timestamptz not null,
  stopped_at timestamptz,
  confidence text not null default 'low',
  raw_sample_count integer not null default 0,
  review_status text not null default 'needs_review',
  created_at timestamptz not null default now()
);

create table if not exists review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  event_id uuid references activity_events(id) on delete set null,
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

alter table activity_events add column if not exists client_event_id text;
alter table categories add column if not exists is_pinned boolean not null default false;
alter table health_workouts add column if not exists external_sample_id text;
alter table health_workouts add column if not exists provider text not null default 'healthkit';
alter table health_workouts add column if not exists duration_seconds integer;
alter table health_workouts add column if not exists distance_meters double precision;
alter table health_workouts add column if not exists energy_kcal double precision;
alter table health_workouts add column if not exists raw_payload jsonb not null default '{}';

create index if not exists idx_time_entries_workspace_started on time_entries(workspace_id, started_at desc);
create index if not exists idx_time_entries_active on time_entries(workspace_id, user_id) where stopped_at is null;
create index if not exists idx_activity_events_workspace_occurred on activity_events(workspace_id, occurred_at desc);
create unique index if not exists idx_activity_events_client_event_id on activity_events(workspace_id, user_id, client_event_id) where client_event_id is not null;
create index if not exists idx_categories_workspace_pinned on categories(workspace_id, is_pinned desc, name) where is_archived = false;
create index if not exists idx_review_items_workspace_status on review_items(workspace_id, status, created_at desc);
create index if not exists idx_review_items_open_health_event on review_items(workspace_id, event_id, suggested_started_at desc, created_at desc) where status = 'open';
create index if not exists idx_activity_events_health_review_lookup on activity_events(workspace_id, user_id, event_type, occurred_at desc, id) where event_type in ('health_sleep_import', 'health_workout_import');
create index if not exists idx_time_entries_confirmed_overlap_lookup on time_entries(workspace_id, user_id, started_at, stopped_at) where review_status = 'confirmed';
create index if not exists idx_time_entries_created_from_event_lookup on time_entries(workspace_id, user_id, created_from_event_id) where created_from_event_id is not null;
create unique index if not exists idx_health_sleep_segments_external_sample on health_sleep_segments(workspace_id, provider, external_sample_id) where external_sample_id is not null;
create unique index if not exists idx_health_workouts_external_sample on health_workouts(workspace_id, provider, external_sample_id) where external_sample_id is not null;
create index if not exists idx_geofences_center on geofences using gist(center);
create index if not exists idx_integration_tokens_workspace on integration_tokens(workspace_id) where revoked_at is null;
create index if not exists idx_external_refs_workspace on external_entity_refs(workspace_id, provider, entity_type);
create index if not exists idx_import_runs_workspace on import_runs(workspace_id, provider, started_at desc);
create index if not exists idx_auth_sessions_token_hash on auth_sessions(token_hash) where revoked_at is null;
create index if not exists idx_auth_sessions_user_expiry on auth_sessions(user_id, expires_at desc);
