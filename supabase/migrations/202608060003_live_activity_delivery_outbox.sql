create table if not exists public.live_activity_delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null unique references public.live_activity_push_tokens(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  revision bigint not null default 1,
  event text not null check (event in ('update', 'end')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'delivered', 'permanent_failure', 'expired')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null,
  leased_until timestamptz,
  last_attempt_at timestamptz,
  last_delivery_status integer,
  last_delivery_reason text,
  last_apns_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists live_activity_delivery_outbox_due_idx
  on public.live_activity_delivery_outbox (next_attempt_at, updated_at)
  where status = 'pending';

create index if not exists live_activity_delivery_outbox_scope_idx
  on public.live_activity_delivery_outbox (workspace_id, user_id, status, next_attempt_at);

alter table public.live_activity_delivery_outbox enable row level security;

revoke all on table public.live_activity_delivery_outbox from anon, authenticated;
