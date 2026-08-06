create table if not exists live_activity_push_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  token text not null unique,
  activity_id text not null,
  active_entry_id uuid references time_entries(id) on delete set null,
  environment text not null default 'production'
    check (environment in ('development', 'production')),
  last_registered_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_delivered_at timestamptz,
  last_delivery_status integer,
  last_delivery_reason text,
  consecutive_failures integer not null default 0,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists live_activity_push_tokens_user_active_idx
  on live_activity_push_tokens (workspace_id, user_id, last_registered_at desc)
  where invalidated_at is null;
