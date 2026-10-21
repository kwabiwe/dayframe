-- Places search, sections and last visit (location v3 PR 16c, design §11.1). Places shows each
-- place's last visit and sorts Frequent (visits in the last 30 days) and Recent (last visit). Both
-- are read from the person's current (not superseded) stays at the place, so a Review edit, split,
-- merge or replay that moves a stay to another place is reflected at once and nothing is copied.
-- This partial index keeps that read to the person's stays at saved places, in place order.
--
-- Additive and optional for correctness (without it the read is slower, not wrong); apply to
-- staging and then production in the usual order. No RLS change.
create index if not exists idx_stay_segments_place_visits
  on public.stay_segments(workspace_id, user_id, place_id, started_at)
  include (stopped_at)
  where place_id is not null and status <> 'superseded';
