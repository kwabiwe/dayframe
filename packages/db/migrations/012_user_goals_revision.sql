-- Goal saves are ordered by the server (UI audit UIA-309, web Settings steppers). Every change
-- to an account's daily or weekly goal bumps goals_revision in the same update, and every read
-- of the goals returns it, so a client can tell the newest goal from an older copy (a late page
-- load, a delayed save acknowledgement) without trusting its own clock.
alter table users add column if not exists goals_revision bigint not null default 0;
