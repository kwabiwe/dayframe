create or replace function public.dayframe_is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
  );
$$;

alter table public.users enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.devices enable row level security;

drop policy if exists "users can read own profile" on public.users;
create policy "users can read own profile"
on public.users
for select
using (id = auth.uid());

drop policy if exists "users can update own profile" on public.users;
create policy "users can update own profile"
on public.users
for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "members can read workspaces" on public.workspaces;
create policy "members can read workspaces"
on public.workspaces
for select
using (public.dayframe_is_workspace_member(id));

drop policy if exists "members can read workspace memberships" on public.workspace_members;
create policy "members can read workspace memberships"
on public.workspace_members
for select
using (user_id = auth.uid() or public.dayframe_is_workspace_member(workspace_id));

drop policy if exists "users can read own devices" on public.devices;
create policy "users can read own devices"
on public.devices
for select
using (user_id = auth.uid());

drop policy if exists "users can manage own devices" on public.devices;
create policy "users can manage own devices"
on public.devices
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clients',
    'categories',
    'projects',
    'tags',
    'event_sources',
    'places',
    'geofences',
    'automation_rules',
    'activity_events',
    'time_entries',
    'stay_segments',
    'review_items',
    'calendar_events',
    'health_sleep_segments',
    'health_workouts',
    'integrations',
    'external_accounts',
    'external_entity_refs',
    'import_runs',
    'audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "workspace members can read" on public.%I', table_name);
    execute format(
      'create policy "workspace members can read" on public.%I for select using (public.dayframe_is_workspace_member(workspace_id))',
      table_name
    );
    execute format('drop policy if exists "workspace members can write" on public.%I', table_name);
    execute format(
      'create policy "workspace members can write" on public.%I for all using (public.dayframe_is_workspace_member(workspace_id)) with check (public.dayframe_is_workspace_member(workspace_id))',
      table_name
    );
  end loop;
end $$;

alter table public.time_entry_tags enable row level security;

drop policy if exists "workspace members can read time entry tags" on public.time_entry_tags;
create policy "workspace members can read time entry tags"
on public.time_entry_tags
for select
using (
  exists (
    select 1
    from public.time_entries te
    where te.id = time_entry_id
      and public.dayframe_is_workspace_member(te.workspace_id)
  )
);

drop policy if exists "workspace members can write time entry tags" on public.time_entry_tags;
create policy "workspace members can write time entry tags"
on public.time_entry_tags
for all
using (
  exists (
    select 1
    from public.time_entries te
    where te.id = time_entry_id
      and public.dayframe_is_workspace_member(te.workspace_id)
  )
)
with check (
  exists (
    select 1
    from public.time_entries te
    where te.id = time_entry_id
      and public.dayframe_is_workspace_member(te.workspace_id)
  )
);
