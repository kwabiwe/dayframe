alter table public.time_entries
  add column if not exists user_edited_at timestamptz;

-- Historical explicit edits predate the provenance column. Protect every
-- changed Health sleep row conservatively; row-level evidence can later
-- distinguish an old category repair from a user edit without risking a
-- silent overwrite now.
update public.time_entries
set user_edited_at = updated_at
where source = 'health_sleep'
  and user_edited_at is null
  and updated_at > created_at;

create index if not exists idx_time_entries_health_sleep_reconciliation
on public.time_entries(workspace_id, user_id, started_at, stopped_at)
where source = 'health_sleep'
  and stopped_at is not null
  and user_edited_at is null
  and review_status in ('confirmed', 'accepted');
