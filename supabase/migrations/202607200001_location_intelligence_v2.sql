-- Location Intelligence V2: user-owned raw evidence, contiguous stays,
-- journey segments, evidence lineage, correction feedback and review ownership.

alter table public.review_items
  add column if not exists user_id uuid references public.users(id) on delete cascade,
  add column if not exists location_segment_id uuid;

update public.review_items review
set user_id = event.user_id
from public.activity_events event
where review.event_id = event.id
  and review.user_id is null;

create or replace function public.dayframe_apply_review_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  event_owner uuid;
  event_workspace uuid;
begin
  if new.event_id is not null then
    select user_id, workspace_id into event_owner, event_workspace
    from public.activity_events where id = new.event_id;
    if event_owner is null then
      raise exception 'Review event does not exist';
    end if;
    if new.user_id is null then
      new.user_id := event_owner;
    elsif new.user_id <> event_owner then
      raise exception 'Review owner must match event owner';
    end if;
    if new.workspace_id <> event_workspace then
      raise exception 'Review workspace must match event workspace';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dayframe_review_owner on public.review_items;
create trigger dayframe_review_owner
before insert or update of event_id, user_id, workspace_id on public.review_items
for each row execute function public.dayframe_apply_review_owner();

do $$
begin
  if not exists (select 1 from public.review_items where user_id is null) then
    alter table public.review_items alter column user_id set not null;
  end if;
end $$;

create table if not exists public.location_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  device_id text not null,
  client_evidence_id text not null,
  client_batch_id text not null,
  evidence_type text not null,
  occurred_at timestamptz not null,
  ended_at timestamptz,
  coordinate geography(Point, 4326),
  horizontal_accuracy_m double precision,
  altitude_m double precision,
  speed_mps double precision,
  course_degrees double precision,
  saved_place_id uuid references public.places(id) on delete set null,
  geofence_identifier text,
  accepted boolean not null default true,
  rejection_reason text,
  algorithm_version text not null,
  time_zone text not null,
  is_simulated boolean,
  metadata jsonb not null default '{}',
  received_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint location_evidence_type_check check (evidence_type in (
    'standard_location', 'significant_change', 'visit', 'geofence_enter',
    'geofence_exit', 'geofence_state', 'location_paused', 'location_resumed', 'provider_status'
  )),
  constraint location_evidence_client_id_length check (char_length(client_evidence_id) between 1 and 160),
  constraint location_evidence_device_id_length check (char_length(device_id) between 1 and 160),
  constraint location_evidence_batch_id_length check (char_length(client_batch_id) between 1 and 160),
  constraint location_evidence_accuracy_check check (horizontal_accuracy_m is null or horizontal_accuracy_m >= 0),
  constraint location_evidence_speed_check check (speed_mps is null or speed_mps >= 0),
  constraint location_evidence_course_check check (course_degrees is null or course_degrees between 0 and 360),
  constraint location_evidence_time_check check (ended_at is null or ended_at >= occurred_at),
  constraint location_evidence_expiry_check check (expires_at > created_at),
  unique (workspace_id, user_id, device_id, client_evidence_id)
);

alter table public.stay_segments
  add column if not exists device_id text,
  add column if not exists client_segment_id text,
  add column if not exists algorithm_version text,
  add column if not exists status text not null default 'candidate',
  add column if not exists source text not null default 'legacy',
  add column if not exists learned_place_id uuid references public.learned_places(id) on delete set null,
  add column if not exists centre geography(Point, 4326),
  add column if not exists radius_m double precision,
  add column if not exists max_spread_m double precision,
  add column if not exists sample_count integer not null default 0,
  add column if not exists continuity_status text not null default 'uncertain_gap',
  add column if not exists start_lower_bound_at timestamptz,
  add column if not exists start_upper_bound_at timestamptz,
  add column if not exists stop_lower_bound_at timestamptz,
  add column if not exists stop_upper_bound_at timestamptz,
  add column if not exists arrival_confidence text,
  add column if not exists departure_confidence text,
  add column if not exists created_from_event_id uuid references public.activity_events(id) on delete set null,
  add column if not exists parent_segment_id uuid references public.stay_segments(id) on delete set null,
  add column if not exists superseded_by_segment_id uuid references public.stay_segments(id) on delete set null,
  add column if not exists metadata jsonb not null default '{}',
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.commute_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  device_id text not null,
  client_segment_id text not null,
  algorithm_version text not null,
  status text not null default 'candidate',
  started_at timestamptz not null,
  stopped_at timestamptz not null,
  start_lower_bound_at timestamptz,
  start_upper_bound_at timestamptz,
  stop_lower_bound_at timestamptz,
  stop_upper_bound_at timestamptz,
  from_stay_segment_id uuid not null references public.stay_segments(id) on delete cascade,
  to_stay_segment_id uuid not null references public.stay_segments(id) on delete cascade,
  from_place_id uuid references public.places(id) on delete set null,
  to_place_id uuid references public.places(id) on delete set null,
  route_distance_m double precision,
  straight_line_distance_m double precision,
  route_sample_count integer not null default 0,
  max_gap_seconds integer,
  continuity_status text not null default 'uncertain_gap',
  confidence text not null default 'low',
  created_from_event_id uuid references public.activity_events(id) on delete set null,
  parent_segment_id uuid references public.commute_segments(id) on delete set null,
  superseded_by_segment_id uuid references public.commute_segments(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commute_segments_time_check check (stopped_at > started_at),
  constraint commute_segments_distance_check check (
    (route_distance_m is null or route_distance_m >= 0) and
    (straight_line_distance_m is null or straight_line_distance_m >= 0)
  ),
  constraint commute_segments_samples_check check (route_sample_count >= 0),
  unique (workspace_id, user_id, device_id, client_segment_id)
);

create table if not exists public.location_segment_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  evidence_id uuid not null references public.location_evidence(id) on delete cascade,
  stay_segment_id uuid references public.stay_segments(id) on delete cascade,
  commute_segment_id uuid references public.commute_segments(id) on delete cascade,
  sequence_index integer not null,
  role text not null,
  created_at timestamptz not null default now(),
  constraint location_segment_evidence_one_segment check (
    (stay_segment_id is not null)::integer + (commute_segment_id is not null)::integer = 1
  ),
  constraint location_segment_evidence_sequence check (sequence_index >= 0),
  constraint location_segment_evidence_role check (role in (
    'inside', 'outside', 'arrival_anchor', 'departure_anchor', 'route',
    'gap_boundary', 'rejected_outlier', 'manual_boundary'
  ))
);

create table if not exists public.place_match_feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  place_id uuid references public.places(id) on delete cascade,
  anchor geography(Point, 4326),
  radius_m double precision not null,
  source_cluster_key text,
  rejected_label text,
  correction_count integer not null default 1,
  first_corrected_at timestamptz not null default now(),
  last_corrected_at timestamptz not null default now(),
  status text not null default 'active',
  expires_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_match_feedback_radius_check check (radius_m between 20 and 160),
  constraint place_match_feedback_count_check check (correction_count > 0),
  constraint place_match_feedback_label_length check (rejected_label is null or char_length(rejected_label) <= 160)
);

create or replace function public.dayframe_enforce_location_owner_links()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'location_evidence' then
    if new.saved_place_id is not null and not exists (
      select 1 from public.places
      where id = new.saved_place_id and workspace_id = new.workspace_id
    ) then
      raise exception 'Location evidence place must belong to its workspace';
    end if;
  elsif tg_table_name = 'stay_segments' then
    if new.place_id is not null and not exists (
      select 1 from public.places where id = new.place_id and workspace_id = new.workspace_id
    ) then raise exception 'Stay place must belong to its workspace'; end if;
    if new.learned_place_id is not null and not exists (
      select 1 from public.learned_places
      where id = new.learned_place_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Learned place must belong to the stay owner'; end if;
    if new.created_from_event_id is not null and not exists (
      select 1 from public.activity_events
      where id = new.created_from_event_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Stay event must belong to the stay owner'; end if;
    if new.parent_segment_id is not null and not exists (
      select 1 from public.stay_segments
      where id = new.parent_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Parent stay must belong to the stay owner'; end if;
    if new.superseded_by_segment_id is not null and not exists (
      select 1 from public.stay_segments
      where id = new.superseded_by_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Superseding stay must belong to the stay owner'; end if;
  elsif tg_table_name = 'commute_segments' then
    if not exists (
      select 1 from public.stay_segments
      where id = new.from_stay_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) or not exists (
      select 1 from public.stay_segments
      where id = new.to_stay_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Commute endpoints must belong to the commute owner'; end if;
    if new.from_place_id is not null and not exists (
      select 1 from public.places where id = new.from_place_id and workspace_id = new.workspace_id
    ) then raise exception 'Commute origin place must belong to its workspace'; end if;
    if new.to_place_id is not null and not exists (
      select 1 from public.places where id = new.to_place_id and workspace_id = new.workspace_id
    ) then raise exception 'Commute destination place must belong to its workspace'; end if;
    if new.created_from_event_id is not null and not exists (
      select 1 from public.activity_events
      where id = new.created_from_event_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Commute event must belong to the commute owner'; end if;
    if new.parent_segment_id is not null and not exists (
      select 1 from public.commute_segments
      where id = new.parent_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Parent commute must belong to the commute owner'; end if;
    if new.superseded_by_segment_id is not null and not exists (
      select 1 from public.commute_segments
      where id = new.superseded_by_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Superseding commute must belong to the commute owner'; end if;
  elsif tg_table_name = 'location_segment_evidence' then
    if not exists (
      select 1 from public.location_evidence
      where id = new.evidence_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Evidence link must belong to its owner'; end if;
    if new.stay_segment_id is not null and not exists (
      select 1 from public.stay_segments
      where id = new.stay_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Stay evidence link must belong to its owner'; end if;
    if new.commute_segment_id is not null and not exists (
      select 1 from public.commute_segments
      where id = new.commute_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    ) then raise exception 'Commute evidence link must belong to its owner'; end if;
  elsif tg_table_name = 'place_match_feedback' then
    if new.place_id is not null and not exists (
      select 1 from public.places where id = new.place_id and workspace_id = new.workspace_id
    ) then raise exception 'Place feedback must belong to its workspace'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists dayframe_location_evidence_owner_links on public.location_evidence;
create trigger dayframe_location_evidence_owner_links
before insert or update on public.location_evidence
for each row execute function public.dayframe_enforce_location_owner_links();
drop trigger if exists dayframe_stay_owner_links on public.stay_segments;
create trigger dayframe_stay_owner_links
before insert or update on public.stay_segments
for each row execute function public.dayframe_enforce_location_owner_links();
drop trigger if exists dayframe_commute_owner_links on public.commute_segments;
create trigger dayframe_commute_owner_links
before insert or update on public.commute_segments
for each row execute function public.dayframe_enforce_location_owner_links();
drop trigger if exists dayframe_segment_evidence_owner_links on public.location_segment_evidence;
create trigger dayframe_segment_evidence_owner_links
before insert or update on public.location_segment_evidence
for each row execute function public.dayframe_enforce_location_owner_links();
drop trigger if exists dayframe_place_feedback_owner_links on public.place_match_feedback;
create trigger dayframe_place_feedback_owner_links
before insert or update on public.place_match_feedback
for each row execute function public.dayframe_enforce_location_owner_links();

create or replace function public.dayframe_apply_review_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  event_owner uuid;
  event_workspace uuid;
begin
  if new.event_id is not null then
    select user_id, workspace_id into event_owner, event_workspace
    from public.activity_events where id = new.event_id;
    if event_owner is null then raise exception 'Review event does not exist'; end if;
    if new.user_id is null then new.user_id := event_owner;
    elsif new.user_id <> event_owner then raise exception 'Review owner must match event owner'; end if;
    if new.workspace_id <> event_workspace then raise exception 'Review workspace must match event workspace'; end if;
  end if;
  if new.location_segment_id is not null and not exists (
    select 1 from public.stay_segments
    where id = new.location_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
    union all
    select 1 from public.commute_segments
    where id = new.location_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
  ) then
    raise exception 'Review segment must belong to the review owner';
  end if;
  return new;
end;
$$;

drop trigger if exists dayframe_review_owner on public.review_items;
create trigger dayframe_review_owner
before insert or update of event_id, user_id, workspace_id, location_segment_id on public.review_items
for each row execute function public.dayframe_apply_review_owner();

create index if not exists idx_location_evidence_user_time
  on public.location_evidence(workspace_id, user_id, occurred_at);
create index if not exists idx_location_evidence_user_expiry
  on public.location_evidence(workspace_id, user_id, expires_at);
create index if not exists idx_location_evidence_batch
  on public.location_evidence(workspace_id, user_id, client_batch_id);
create index if not exists idx_location_evidence_unassigned
  on public.location_evidence(workspace_id, user_id, occurred_at) where accepted = true;
create index if not exists idx_location_evidence_coordinate
  on public.location_evidence using gist(coordinate);
create unique index if not exists idx_stay_segments_client_segment
  on public.stay_segments(workspace_id, user_id, device_id, client_segment_id)
  where device_id is not null and client_segment_id is not null;
create index if not exists idx_stay_segments_user_time
  on public.stay_segments(workspace_id, user_id, started_at, stopped_at);
create index if not exists idx_stay_segments_centre
  on public.stay_segments using gist(centre);
create unique index if not exists idx_segment_evidence_stay_role
  on public.location_segment_evidence(evidence_id, stay_segment_id, role)
  where stay_segment_id is not null;
create unique index if not exists idx_segment_evidence_commute_role
  on public.location_segment_evidence(evidence_id, commute_segment_id, role)
  where commute_segment_id is not null;
create index if not exists idx_place_match_feedback_user_place
  on public.place_match_feedback(workspace_id, user_id, place_id, last_corrected_at desc);
create index if not exists idx_place_match_feedback_anchor
  on public.place_match_feedback using gist(anchor);
create index if not exists idx_review_items_user_status
  on public.review_items(workspace_id, user_id, status, created_at desc);

alter table public.location_evidence enable row level security;
alter table public.commute_segments enable row level security;
alter table public.location_segment_evidence enable row level security;
alter table public.place_match_feedback enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'location_evidence', 'stay_segments', 'commute_segments',
    'location_segment_evidence', 'place_match_feedback', 'review_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "workspace members can read" on public.%I', table_name);
    execute format('drop policy if exists "workspace members can write" on public.%I', table_name);
    execute format('drop policy if exists "users can read own location data" on public.%I', table_name);
    execute format(
      'create policy "users can read own location data" on public.%I for select using (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id))',
      table_name
    );
    execute format('drop policy if exists "users can write own location data" on public.%I', table_name);
    execute format(
      'create policy "users can write own location data" on public.%I for all using (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id)) with check (user_id = auth.uid() and public.dayframe_is_workspace_member(workspace_id))',
      table_name
    );
  end loop;
end $$;

create or replace function public.dayframe_delete_expired_location_evidence()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
begin
  delete from public.location_evidence evidence
  using (
    select id from public.location_evidence
    where expires_at < now()
    order by expires_at
    limit 10000
  ) expired
  where evidence.id = expired.id;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.dayframe_delete_expired_location_evidence() from public;
revoke all on function public.dayframe_delete_expired_location_evidence() from anon, authenticated;
grant execute on function public.dayframe_delete_expired_location_evidence() to service_role;
