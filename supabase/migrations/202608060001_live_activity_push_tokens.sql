create table if not exists public.live_activity_push_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  token text not null unique,
  activity_id text not null,
  active_entry_id uuid references public.time_entries(id) on delete set null,
  environment text not null default 'production'
    check (environment in ('development', 'production')),
  last_registered_at timestamptz not null default now(),
  last_delivered_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists live_activity_push_tokens_user_active_idx
  on public.live_activity_push_tokens (workspace_id, user_id, last_registered_at desc)
  where invalidated_at is null;

alter table public.live_activity_push_tokens enable row level security;

drop policy if exists "users can read own live activity tokens" on public.live_activity_push_tokens;
create policy "users can read own live activity tokens"
on public.live_activity_push_tokens
for select
using (
  user_id = auth.uid()
  and public.dayframe_is_workspace_member(workspace_id)
);

drop policy if exists "users can manage own live activity tokens" on public.live_activity_push_tokens;
create policy "users can manage own live activity tokens"
on public.live_activity_push_tokens
for all
using (
  user_id = auth.uid()
  and public.dayframe_is_workspace_member(workspace_id)
)
with check (
  user_id = auth.uid()
  and public.dayframe_is_workspace_member(workspace_id)
);
