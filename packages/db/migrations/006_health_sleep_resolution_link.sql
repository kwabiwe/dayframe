-- Explicit provenance for a revision/stage that resolves to another event's
-- logical Sleep entry. No historical links are guessed or backfilled.
alter table activity_events
  add column if not exists resolved_time_entry_id uuid
    references time_entries(id) on delete set null;

create index if not exists activity_events_resolved_entry_idx
  on activity_events (workspace_id, user_id, resolved_time_entry_id)
  where resolved_time_entry_id is not null;
