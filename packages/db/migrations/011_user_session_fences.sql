-- Forgot password (UIA-317): when a reset changes a password, every Dayframe sign-in for that
-- user ends, including one that verified the old password and is still finishing. A reset records
-- the database time here (revoking existing sessions in the same transaction, under the user
-- row's lock); creating a session takes that lock and refuses a sign-in authenticated at or before
-- it. No row means no reset has happened. Server-owned: hosted clients have no access (see the
-- matching supabase migration), so nobody can clear or move their own fence.
create table if not exists user_session_fences (
  user_id uuid primary key references users(id) on delete cascade,
  sessions_valid_after timestamptz not null,
  updated_at timestamptz not null default now()
);
