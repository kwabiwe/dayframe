-- "Log trips automatically" (PRD D19, owner decision A4, 16 Oct 2026). With it on, a Move between
-- two known places with a clear travel mode becomes a block instead of a Review card when it overlaps
-- no tracked time by more than five minutes and no timer runs. On by default; one switch per person.
--
-- No RLS change: the column sits on public.users, whose existing policies already cover it.
alter table public.users add column if not exists log_trips_automatically boolean not null default true;
-- Additive (a constant default is a catalogue-only change); apply to staging before the server
-- Preview that offers the switch, and to production before that server deploys. The server reads
-- the column so that a database without it logs no trips automatically rather than failing.
