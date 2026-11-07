-- The foreground timer probe also detects completed-block changes. The counter
-- belongs to the same workspace and user as the affected blocks.
create schema if not exists dayframe_sync;
revoke all on schema dayframe_sync from public;

create table if not exists dayframe_sync.completed_entry_revisions (
  workspace_id uuid not null,
  user_id uuid not null,
  revision bigint not null check (revision > 0),
  primary key (workspace_id, user_id),
  foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id) on delete cascade
);

create or replace function dayframe_sync.bump_completed_entry_revisions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  owners text;
begin
  if tg_op = 'INSERT' then
    owners := 'select workspace_id, user_id from new_entries where stopped_at is not null';
  elsif tg_op = 'DELETE' then
    owners := 'select workspace_id, user_id from old_entries where stopped_at is not null';
  else
    owners := $owners$
      select n.workspace_id, n.user_id
      from new_entries n left join old_entries o using (id)
      where n.stopped_at is not null and n is distinct from o
      union
      select o.workspace_id, o.user_id
      from old_entries o left join new_entries n using (id)
      where o.stopped_at is not null and n is distinct from o
    $owners$;
  end if;

  -- Row locks serialize increments for the same owner until the mutation commits.
  -- Take them in a consistent order within a statement that touches several owners.
  execute format($bump$
    insert into dayframe_sync.completed_entry_revisions as current_revision (workspace_id, user_id, revision)
    select distinct affected.workspace_id, affected.user_id, 1
    from (%s) affected
    join public.workspace_members members using (workspace_id, user_id)
    order by affected.workspace_id, affected.user_id
    on conflict (workspace_id, user_id)
    do update set revision = current_revision.revision + 1
  $bump$, owners);
  return null;
end;
$$;

revoke all on function dayframe_sync.bump_completed_entry_revisions() from public;

drop trigger if exists completed_entry_revision_insert on public.time_entries;
create trigger completed_entry_revision_insert after insert on public.time_entries
referencing new table as new_entries for each statement execute function dayframe_sync.bump_completed_entry_revisions();

drop trigger if exists completed_entry_revision_update on public.time_entries;
create trigger completed_entry_revision_update after update on public.time_entries
referencing old table as old_entries new table as new_entries
for each statement execute function dayframe_sync.bump_completed_entry_revisions();

drop trigger if exists completed_entry_revision_delete on public.time_entries;
create trigger completed_entry_revision_delete after delete on public.time_entries
referencing old table as old_entries for each statement execute function dayframe_sync.bump_completed_entry_revisions();
