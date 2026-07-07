create table if not exists public.health_sleep_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  external_sample_id text,
  provider text not null default 'healthkit',
  source_name text,
  sleep_stage text not null default 'asleep_unspecified',
  started_at timestamptz not null,
  stopped_at timestamptz not null,
  source_device_id uuid references public.devices(id) on delete set null,
  raw_payload jsonb not null default '{}',
  imported_at timestamptz not null default now()
);

alter table public.health_sleep_segments
  add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade,
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists external_sample_id text,
  add column if not exists provider text not null default 'healthkit',
  add column if not exists source_name text,
  add column if not exists sleep_stage text not null default 'asleep_unspecified',
  add column if not exists started_at timestamptz,
  add column if not exists stopped_at timestamptz,
  add column if not exists source_device_id uuid references public.devices(id) on delete set null,
  add column if not exists raw_payload jsonb not null default '{}',
  add column if not exists imported_at timestamptz not null default now();

create unique index if not exists idx_health_sleep_segments_external_sample
on public.health_sleep_segments(workspace_id, provider, external_sample_id)
where external_sample_id is not null;

alter table public.health_sleep_segments enable row level security;

drop policy if exists "workspace members can read" on public.health_sleep_segments;
create policy "workspace members can read"
on public.health_sleep_segments
for select
using (public.dayframe_is_workspace_member(workspace_id));

drop policy if exists "workspace members can write" on public.health_sleep_segments;
create policy "workspace members can write"
on public.health_sleep_segments
for all
using (public.dayframe_is_workspace_member(workspace_id))
with check (public.dayframe_is_workspace_member(workspace_id));
