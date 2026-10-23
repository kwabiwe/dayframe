-- Timeline corrections (Location v4 §4, §14; build step 11). See packages/db/migrations/021. Owner-only
-- like the other location tables. Additive; apply to staging before the server Preview that writes it,
-- and to production before that server deploys (migration → server → phone).
create table if not exists public.location_timeline_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  subject text not null check (subject in ('place', 'trip', 'leg')),
  kind text not null check (kind in ('place', 'times', 'merge', 'split', 'delete', 'leg_mode', 'leg_boundary', 'leg_split', 'leg_merge')),
  span_started_at timestamptz not null,
  span_stopped_at timestamptz not null check (span_stopped_at > span_started_at),
  target jsonb not null default '{}'::jsonb check (
    jsonb_typeof(target) = 'object'
    and not (target ?| array['latitude', 'longitude', 'lat', 'lng', 'centre', 'center', 'coordinates'])
  ),
  created_from_event_id uuid references public.activity_events(id) on delete set null,
  created_at timestamptz not null default now(),
  replaced_at timestamptz,
  replaced_by_id uuid references public.location_timeline_corrections(id) on delete set null
);
create index if not exists idx_location_timeline_corrections_span
  on public.location_timeline_corrections(workspace_id, user_id, span_started_at, span_stopped_at)
  where replaced_at is null;

alter table public.location_timeline_corrections enable row level security;
drop policy if exists "users can read own location data" on public.location_timeline_corrections;
create policy "users can read own location data" on public.location_timeline_corrections
  for select using (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id));
drop policy if exists "users can write own location data" on public.location_timeline_corrections;
create policy "users can write own location data" on public.location_timeline_corrections
  for all using (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id));
