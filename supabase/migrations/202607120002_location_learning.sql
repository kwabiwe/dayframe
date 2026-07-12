create table if not exists public.learned_places (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  place_id uuid references public.places(id) on delete set null,
  cluster_key text not null,
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  radius_meters integer not null default 160,
  visit_count integer not null default 1,
  sample_count integer not null default 1,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_started_at timestamptz,
  last_stopped_at timestamptz,
  confidence text not null default 'low',
  status text not null default 'candidate',
  raw_location_retention_days integer not null default 7,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learned_places_radius_positive check (radius_meters > 0),
  constraint learned_places_visit_count_positive check (visit_count > 0),
  constraint learned_places_sample_count_positive check (sample_count > 0),
  constraint learned_places_status_check check (status in ('candidate', 'accepted', 'ignored')),
  unique (workspace_id, user_id, cluster_key)
);

create index if not exists idx_learned_places_workspace_status
on public.learned_places(workspace_id, user_id, status, last_seen_at desc);

alter table public.learned_places enable row level security;

drop policy if exists "workspace members can read" on public.learned_places;
create policy "workspace members can read"
on public.learned_places
for select
using (public.dayframe_is_workspace_member(workspace_id));

drop policy if exists "workspace members can write" on public.learned_places;
create policy "workspace members can write"
on public.learned_places
for all
using (public.dayframe_is_workspace_member(workspace_id))
with check (public.dayframe_is_workspace_member(workspace_id));
