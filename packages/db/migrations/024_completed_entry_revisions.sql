-- The foreground timer probe also detects completed-block changes. The marker
-- belongs to the same workspace and user as the affected blocks.
create schema if not exists dayframe_sync;
revoke all on schema dayframe_sync from public;

create table if not exists dayframe_sync.completed_entry_revisions (
  workspace_id uuid not null,
  user_id uuid not null,
  revision uuid not null,
  primary key (workspace_id, user_id)
);

-- A transaction owns these rows exclusively. They are drained before commit, so
-- they never become a visible change journal. Taking a shared owner lock here
-- would invert the lock order of entry edits and tag renames.
create table if not exists dayframe_sync.pending_completed_entry_owners (
  transaction_id xid8 not null,
  workspace_id uuid not null,
  user_id uuid not null,
  primary key (transaction_id, workspace_id, user_id)
);

create or replace function dayframe_sync.queue_completed_entry_owners()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  owners text;
  links text;
begin
  if tg_table_name = 'workspace_members' then
    if tg_op = 'DELETE' then
      owners := 'select workspace_id, user_id from old_members';
    else
      owners := $owners$
        select workspace_id, user_id from old_members
        except select workspace_id, user_id from new_members
      $owners$;
    end if;
  elsif tg_table_name = 'time_entry_tags' then
    if tg_op = 'INSERT' then
      links := 'select workspace_id, time_entry_id from new_links';
    elsif tg_op = 'DELETE' then
      links := 'select workspace_id, time_entry_id from old_links';
    else
      links := $links$
        select workspace_id, time_entry_id
        from new_links n full join old_links o using (workspace_id, time_entry_id, tag_id)
        where n.tag_id is null or o.tag_id is null
      $links$;
    end if;
    owners := format($owners$
      select entry.workspace_id, entry.user_id
      from (%s) affected_links
      join public.time_entries entry
        on entry.workspace_id = affected_links.workspace_id and entry.id = affected_links.time_entry_id
      where entry.stopped_at is not null
    $owners$, links);
  elsif tg_op = 'INSERT' then
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

  execute format($queue$
    insert into dayframe_sync.pending_completed_entry_owners (transaction_id, workspace_id, user_id)
    select pg_current_xact_id(), affected.workspace_id, affected.user_id
    from (%s) affected
    on conflict do nothing
  $queue$, owners);
  return null;
end;
$$;

create or replace function dayframe_sync.commit_completed_entry_revisions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  -- The first deferred invocation drains the transaction's whole set, taking
  -- owner locks in a stable order only after the entry/tag writes are complete.
  insert into dayframe_sync.completed_entry_revisions (workspace_id, user_id, revision)
  select workspace_id, user_id, gen_random_uuid()
  from dayframe_sync.pending_completed_entry_owners
  where transaction_id = new.transaction_id
  order by workspace_id, user_id
  on conflict (workspace_id, user_id)
  do update set revision = excluded.revision;

  -- Read membership after taking the revision locks. A concurrent workspace
  -- removal uses this same commit path instead of an immediate FK cascade.
  delete from dayframe_sync.completed_entry_revisions revision
  using dayframe_sync.pending_completed_entry_owners pending
  where pending.transaction_id = new.transaction_id
    and (revision.workspace_id, revision.user_id) = (pending.workspace_id, pending.user_id)
    and not exists (
      select 1 from public.workspace_members member
      where (member.workspace_id, member.user_id) = (pending.workspace_id, pending.user_id)
    );

  delete from dayframe_sync.pending_completed_entry_owners where transaction_id = new.transaction_id;
  return null;
end;
$$;

revoke all on function dayframe_sync.queue_completed_entry_owners() from public;
revoke all on function dayframe_sync.commit_completed_entry_revisions() from public;

drop trigger if exists completed_entry_revision_commit on dayframe_sync.pending_completed_entry_owners;
create constraint trigger completed_entry_revision_commit
after insert on dayframe_sync.pending_completed_entry_owners
deferrable initially deferred for each row
execute function dayframe_sync.commit_completed_entry_revisions();

drop trigger if exists completed_entry_revision_insert on public.time_entries;
create trigger completed_entry_revision_insert after insert on public.time_entries
referencing new table as new_entries for each statement execute function dayframe_sync.queue_completed_entry_owners();

drop trigger if exists completed_entry_revision_update on public.time_entries;
create trigger completed_entry_revision_update after update on public.time_entries
referencing old table as old_entries new table as new_entries
for each statement execute function dayframe_sync.queue_completed_entry_owners();

drop trigger if exists completed_entry_revision_delete on public.time_entries;
create trigger completed_entry_revision_delete after delete on public.time_entries
referencing old table as old_entries for each statement execute function dayframe_sync.queue_completed_entry_owners();


drop trigger if exists completed_entry_revision_tag_insert on public.time_entry_tags;
create trigger completed_entry_revision_tag_insert after insert on public.time_entry_tags
referencing new table as new_links for each statement execute function dayframe_sync.queue_completed_entry_owners();

drop trigger if exists completed_entry_revision_tag_update on public.time_entry_tags;
create trigger completed_entry_revision_tag_update after update on public.time_entry_tags
referencing old table as old_links new table as new_links
for each statement execute function dayframe_sync.queue_completed_entry_owners();

drop trigger if exists completed_entry_revision_tag_delete on public.time_entry_tags;
create trigger completed_entry_revision_tag_delete after delete on public.time_entry_tags
referencing old table as old_links for each statement execute function dayframe_sync.queue_completed_entry_owners();

drop trigger if exists completed_entry_revision_member_delete on public.workspace_members;
create trigger completed_entry_revision_member_delete after delete on public.workspace_members
referencing old table as old_members for each statement execute function dayframe_sync.queue_completed_entry_owners();

drop trigger if exists completed_entry_revision_member_update on public.workspace_members;
create trigger completed_entry_revision_member_update after update on public.workspace_members
referencing old table as old_members new table as new_members
for each statement execute function dayframe_sync.queue_completed_entry_owners();
