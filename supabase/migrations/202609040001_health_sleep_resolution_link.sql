-- Additive; apply to staging before the sync-server Preview. Production requires
-- separate approval. No historical links are guessed or backfilled.
alter table public.activity_events
  add column if not exists resolved_time_entry_id uuid
    references public.time_entries(id) on delete set null;

create index if not exists activity_events_resolved_entry_idx
  on public.activity_events (workspace_id, user_id, resolved_time_entry_id)
  where resolved_time_entry_id is not null;
