-- Archive place (location v3 PR 15, PRD D19 A10): an archived place keeps its name on past blocks,
-- Reports and exports, but stops matching, geofences, nearby suggestions and pickers until it is
-- restored. Null means active. No RLS change: the column sits on public.places, whose existing
-- workspace policies already cover it.
--
-- Additive; apply to staging before the server Preview that reads archived_at, and to production
-- before that server deploys (migration → server → phone).
alter table public.places
  add column if not exists archived_at timestamptz;

-- "Replace the old place": the new place matches only evidence from the moment it replaced the
-- archived one, so replayed history before then keeps the old place's visits and blocks. Null
-- means it matches all evidence (every other place).
alter table public.places
  add column if not exists matching_starts_at timestamptz;
