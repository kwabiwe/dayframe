-- Learned names for location items (Location v3, PRD D19 A8). See packages/db/migrations/014.
-- Owner-only like the other location tables: pattern keys are location data (saved/learned place
-- IDs or 150 m cells). Additive; apply to staging before the server Preview that reads it, and to
-- production before that server deploys (migration → server → phone).
create table if not exists public.location_name_patterns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  pattern_key text not null check (length(pattern_key) between 1 and 300),
  band text not null check (band in ('morning', 'afternoon', 'evening', 'weekend')),
  name text check (name is null or length(btrim(name)) between 1 and 500),
  category_id uuid references public.categories(id) on delete set null,
  uses integer not null default 0 check (uses >= 0),
  category_uses integer not null default 0 check (category_uses >= 0),
  auto_log_opt_out boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, pattern_key, band)
);
create index if not exists idx_location_name_patterns_key
  on public.location_name_patterns(workspace_id, user_id, pattern_key);
-- A round trip's pattern reads its route links by commute (the existing indexes lead with evidence).
-- A plain build blocks writes to location_segment_evidence while it runs. Before applying, read the
-- table's size (pg_total_relation_size) on each project; if the build would take more than a few
-- seconds, create this one index first with CREATE INDEX CONCURRENTLY outside a transaction, after
-- which this statement is a no-op (Codex r2 on #458).
create index if not exists idx_segment_evidence_commute_lookup
  on public.location_segment_evidence(commute_segment_id, role)
  where commute_segment_id is not null;

alter table public.location_name_patterns enable row level security;
drop policy if exists "users can read own location data" on public.location_name_patterns;
create policy "users can read own location data" on public.location_name_patterns
  for select using (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id));
drop policy if exists "users can write own location data" on public.location_name_patterns;
create policy "users can write own location data" on public.location_name_patterns
  for all using (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id))
  with check (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id));
