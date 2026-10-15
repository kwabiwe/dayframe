-- Per-place "Log automatically" (owner decision 14 Oct 2026): visits at a place with auto_log on
-- become blocks without a Review card when the server's conservative checks pass. Off by default,
-- never backfilled. No RLS change: the column sits on public.places, whose existing workspace
-- policies already cover it.
--
-- Additive; apply to staging before the server Preview that reads auto_log, and to production
-- before that server deploys (migration → server → phone).
alter table public.places
  add column if not exists auto_log boolean not null default false;
