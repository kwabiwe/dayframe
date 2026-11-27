create table if not exists dayframe_sync.forgotten_timer_devices (
  workspace_id uuid not null,
  user_id uuid not null,
  session_id uuid not null references public.auth_sessions(id) on delete cascade,
  token text not null check (char_length(token) between 32 and 512 and token ~ '^[a-f0-9]+$'),
  environment text not null check (environment in ('development', 'production')),
  primary key (workspace_id, user_id),
  unique (environment, token),
  foreign key (workspace_id, user_id) references public.workspace_members(workspace_id, user_id) on delete cascade
);

alter table dayframe_sync.forgotten_timer_devices enable row level security;
revoke all on table dayframe_sync.forgotten_timer_devices from anon, authenticated;
