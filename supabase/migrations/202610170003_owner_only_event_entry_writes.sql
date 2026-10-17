-- Owner-only writes for activity events and time entries (owner decision, 17 Oct 2026).
--
-- Members of a workspace keep reading each other's events and entries ("workspace members can
-- read" from 202607020001 is unchanged), but only a row's own user may insert, change or delete
-- it, as the location tables already require (202607200001, 202610170001). Moving a row to
-- another user or workspace is refused by the same check.
--
-- The Dayframe server connects as the tables' owner, which RLS does not apply to, so the app is
-- unaffected; this closes the signed-in client path (PostgREST with a user's JWT).
-- Hosted only: local schema history has no RLS (packages/db/migrations).

alter table public.activity_events enable row level security;
alter table public.time_entries enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['activity_events', 'time_entries']
  loop
    execute format('drop policy if exists "workspace members can write" on public.%I', table_name);
    execute format('drop policy if exists "users can write own rows" on public.%I', table_name);
    execute format(
      'create policy "users can write own rows" on public.%I for all using (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id)) with check (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id))',
      table_name
    );
  end loop;
end $$;
