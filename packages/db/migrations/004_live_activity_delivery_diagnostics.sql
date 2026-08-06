alter table live_activity_push_tokens
  add column if not exists last_attempt_at timestamptz,
  add column if not exists last_delivery_status integer,
  add column if not exists last_delivery_reason text,
  add column if not exists consecutive_failures integer not null default 0;
