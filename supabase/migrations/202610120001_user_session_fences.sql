-- Forgot password (UIA-317): the password-reset session fence (packages/db migration 011). The
-- Dayframe server alone reads and writes it; Supabase's anon and authenticated roles get no
-- grants and no policies, so a user's own JWT can neither clear the fence nor push it ahead.
create table if not exists public.user_session_fences (
  user_id uuid primary key references public.users(id) on delete cascade,
  sessions_valid_after timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.user_session_fences enable row level security;

revoke all on table public.user_session_fences from anon, authenticated;
