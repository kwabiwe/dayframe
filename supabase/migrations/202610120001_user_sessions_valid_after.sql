-- Forgot password (UIA-317): when a reset changes a password, every Dayframe sign-in for that
-- user ends, including one that verified the old password and is still finishing. A reset sets
-- this to the database time before and after the change (revoking existing sessions in the
-- same transaction); creating a session locks the user row and refuses a sign-in that was
-- authenticated before it. Null (the default) means no reset has happened. Additive and
-- nullable: older servers ignore it.
alter table users add column if not exists sessions_valid_after timestamptz;
-- No RLS change: the column sits on public.users, whose existing policies already cover it.
