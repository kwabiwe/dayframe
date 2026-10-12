-- Goal saves are ordered by the server (UI audit UIA-309, web Settings steppers). Every change
-- to an account's daily or weekly goal bumps goals_revision in the same update, and every read
-- of the goals returns it, so a client can tell the newest goal from an older copy (a late page
-- load, a delayed save acknowledgement) without trusting its own clock.
--
-- No RLS change: the column sits on public.users, whose existing policies already cover it.
alter table public.users add column if not exists goals_revision bigint not null default 0;
-- Additive; apply to staging before the server Preview that reads goals_revision, and to
-- production before that server deploys.
