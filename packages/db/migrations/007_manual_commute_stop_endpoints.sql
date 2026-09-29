-- A user-confirmed interruption has two non-semantic boundaries. These rows
-- are neither stays nor places and cannot create an activity on their own.
create table if not exists public.location_manual_stop_endpoints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  parent_commute_segment_id uuid not null references public.commute_segments(id) on delete cascade,
  boundary_kind text not null check (boundary_kind in ('stop_started', 'stop_ended')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (parent_commute_segment_id, boundary_kind)
);

create index if not exists idx_manual_stop_endpoints_owner_time
  on public.location_manual_stop_endpoints(workspace_id, user_id, occurred_at);

alter table public.commute_segments
  alter column from_stay_segment_id drop not null,
  alter column to_stay_segment_id drop not null,
  add column if not exists from_manual_stop_endpoint_id uuid references public.location_manual_stop_endpoints(id) on delete cascade,
  add column if not exists to_manual_stop_endpoint_id uuid references public.location_manual_stop_endpoints(id) on delete cascade;

-- A confirmed interruption's children and manual endpoints depend on its
-- parent. SET NULL would update a child while its manual endpoint still
-- requires that parent; delete the dependent commute graph instead.
do $$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.commute_segments'::regclass
      and conname = 'commute_segments_parent_segment_id_fkey' and confdeltype = 'c') then
    alter table public.commute_segments drop constraint if exists commute_segments_parent_segment_id_fkey;
    alter table public.commute_segments add constraint commute_segments_parent_segment_id_fkey
      foreign key (parent_segment_id) references public.commute_segments(id) on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.commute_segments'::regclass and conname = 'commute_segments_from_endpoint_xor') then
    alter table public.commute_segments add constraint commute_segments_from_endpoint_xor check (
      (from_stay_segment_id is not null)::integer + (from_manual_stop_endpoint_id is not null)::integer = 1
    );
  end if;
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.commute_segments'::regclass and conname = 'commute_segments_to_endpoint_xor') then
    alter table public.commute_segments add constraint commute_segments_to_endpoint_xor check (
      (to_stay_segment_id is not null)::integer + (to_manual_stop_endpoint_id is not null)::integer = 1
    );
  end if;
end;
$$;

create index if not exists idx_commute_manual_origin
  on public.commute_segments(from_manual_stop_endpoint_id)
  where from_manual_stop_endpoint_id is not null;
create index if not exists idx_commute_manual_destination
  on public.commute_segments(to_manual_stop_endpoint_id)
  where to_manual_stop_endpoint_id is not null;

create or replace function public.dayframe_enforce_manual_stop_endpoint_owner()
returns trigger language plpgsql set search_path = public as $$
declare
  parent_start timestamptz;
  parent_stop timestamptz;
begin
  if tg_op = 'UPDATE' and (
    new.workspace_id is distinct from old.workspace_id or
    new.user_id is distinct from old.user_id or
    new.parent_commute_segment_id is distinct from old.parent_commute_segment_id or
    new.boundary_kind is distinct from old.boundary_kind or
    new.occurred_at is distinct from old.occurred_at
  ) then raise exception 'Manual stop boundaries are immutable'; end if;
  select started_at, stopped_at into parent_start, parent_stop
    from public.commute_segments
    where id = new.parent_commute_segment_id
      and workspace_id = new.workspace_id and user_id = new.user_id;
  if parent_start is null then raise exception 'Manual stop parent must belong to its owner'; end if;
  if not (new.occurred_at > parent_start and new.occurred_at < parent_stop) then
    raise exception 'Manual stop boundary must be inside its parent commute';
  end if;
  if exists (
    select 1 from public.location_manual_stop_endpoints other
    where other.parent_commute_segment_id = new.parent_commute_segment_id and other.id <> new.id
      and ((new.boundary_kind = 'stop_started' and other.boundary_kind = 'stop_ended'
            and new.occurred_at >= other.occurred_at)
        or (new.boundary_kind = 'stop_ended' and other.boundary_kind = 'stop_started'
            and new.occurred_at <= other.occurred_at))
  ) then raise exception 'Manual stop boundaries must be ordered'; end if;
  return new;
end;
$$;

drop trigger if exists dayframe_manual_stop_endpoint_owner on public.location_manual_stop_endpoints;
create trigger dayframe_manual_stop_endpoint_owner
before insert or update on public.location_manual_stop_endpoints
for each row execute function public.dayframe_enforce_manual_stop_endpoint_owner();

-- The earlier shared trigger requires both stay FKs. Replace only its commute
-- trigger with an additive owner check; all other location triggers remain.
create or replace function public.dayframe_enforce_commute_endpoint_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.from_manual_stop_endpoint_id is not null or new.to_manual_stop_endpoint_id is not null)
      and new.continuity_status <> 'manual' then
    raise exception 'Manual-endpoint commutes must remain Review-only';
  end if;
  if (new.from_manual_stop_endpoint_id is not null and new.from_place_id is not null)
      or (new.to_manual_stop_endpoint_id is not null and new.to_place_id is not null) then
    raise exception 'Manual stop endpoints cannot assert a place';
  end if;
  if new.from_stay_segment_id is not null and not exists (
    select 1 from public.stay_segments
    where id = new.from_stay_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
  ) then raise exception 'Commute origin stay must belong to its owner'; end if;
  if new.to_stay_segment_id is not null and not exists (
    select 1 from public.stay_segments
    where id = new.to_stay_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
  ) then raise exception 'Commute destination stay must belong to its owner'; end if;
  if new.from_manual_stop_endpoint_id is not null and not exists (
    select 1 from public.location_manual_stop_endpoints
    where id = new.from_manual_stop_endpoint_id and workspace_id = new.workspace_id and user_id = new.user_id
      and boundary_kind = 'stop_ended' and parent_commute_segment_id = new.parent_segment_id
      and occurred_at = new.started_at
  ) then raise exception 'Commute origin manual stop must match its parent and start'; end if;
  if new.to_manual_stop_endpoint_id is not null and not exists (
    select 1 from public.location_manual_stop_endpoints
    where id = new.to_manual_stop_endpoint_id and workspace_id = new.workspace_id and user_id = new.user_id
      and boundary_kind = 'stop_started' and parent_commute_segment_id = new.parent_segment_id
      and occurred_at = new.stopped_at
  ) then raise exception 'Commute destination manual stop must match its parent and end'; end if;
  if new.from_place_id is not null and not exists (
    select 1 from public.places where id = new.from_place_id and workspace_id = new.workspace_id
  ) then raise exception 'Commute origin place must belong to its workspace'; end if;
  if new.to_place_id is not null and not exists (
    select 1 from public.places where id = new.to_place_id and workspace_id = new.workspace_id
  ) then raise exception 'Commute destination place must belong to its workspace'; end if;
  if new.created_from_event_id is not null and not exists (
    select 1 from public.activity_events
    where id = new.created_from_event_id and workspace_id = new.workspace_id and user_id = new.user_id
  ) then raise exception 'Commute event must belong to its owner'; end if;
  if new.parent_segment_id is not null and not exists (
    select 1 from public.commute_segments
    where id = new.parent_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
  ) then raise exception 'Parent commute must belong to its owner'; end if;
  if new.superseded_by_segment_id is not null and not exists (
    select 1 from public.commute_segments
    where id = new.superseded_by_segment_id and workspace_id = new.workspace_id and user_id = new.user_id
  ) then raise exception 'Superseding commute must belong to its owner'; end if;
  return new;
end;
$$;

drop trigger if exists dayframe_commute_owner_links on public.commute_segments;
create trigger dayframe_commute_owner_links
before insert or update on public.commute_segments
for each row execute function public.dayframe_enforce_commute_endpoint_owner();
