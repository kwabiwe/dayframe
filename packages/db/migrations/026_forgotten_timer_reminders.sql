create schema if not exists dayframe_sync;
revoke all on schema dayframe_sync from public;

-- One reminder and one durable Keep running choice per exact block.
create table if not exists dayframe_sync.forgotten_timer_reminders (
  entry_id uuid primary key references public.time_entries(id) on delete cascade,
  attempted_at timestamptz,
  kept_at timestamptz,
  check (attempted_at is not null or kept_at is not null)
);

create index if not exists idx_time_entries_open_started
  on public.time_entries (started_at, id)
  where stopped_at is null;
