alter table public.activity_events
  add column if not exists client_event_id text;

create unique index if not exists idx_activity_events_client_event_id
on public.activity_events(workspace_id, user_id, client_event_id)
where client_event_id is not null;

alter table public.health_workouts
  add column if not exists external_sample_id text,
  add column if not exists provider text not null default 'healthkit',
  add column if not exists duration_seconds integer,
  add column if not exists distance_meters double precision,
  add column if not exists energy_kcal double precision,
  add column if not exists raw_payload jsonb not null default '{}';

create unique index if not exists idx_health_workouts_external_sample
on public.health_workouts(workspace_id, provider, external_sample_id)
where external_sample_id is not null;
