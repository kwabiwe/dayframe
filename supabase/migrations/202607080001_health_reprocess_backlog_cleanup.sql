create index if not exists idx_review_items_open_health_event
on public.review_items(workspace_id, event_id, suggested_started_at desc, created_at desc)
where status = 'open';

create index if not exists idx_activity_events_health_review_lookup
on public.activity_events(workspace_id, user_id, event_type, occurred_at desc, id)
where event_type in ('health_sleep_import', 'health_workout_import');

create index if not exists idx_time_entries_confirmed_overlap_lookup
on public.time_entries(workspace_id, user_id, started_at, stopped_at)
where review_status = 'confirmed';

create index if not exists idx_time_entries_completed_health_overlap_lookup
on public.time_entries(workspace_id, user_id, started_at, stopped_at)
where review_status in ('confirmed', 'accepted');

create index if not exists idx_time_entries_created_from_event_lookup
on public.time_entries(workspace_id, user_id, created_from_event_id)
where created_from_event_id is not null;

with ignored_sleep_stages as (
  select ri.id as review_item_id,
         ae.id as event_id
  from public.review_items ri
  join public.activity_events ae on ae.id = ri.event_id
  where ri.status = 'open'
    and ae.event_type = 'health_sleep_import'
    and not (ae.raw_payload ? 'samples')
    and coalesce(ae.raw_payload->>'sleepStage', '') in ('awake', 'in_bed')
)
update public.review_items ri
set status = 'ignored',
    ignored_scope = 'once',
    resolved_at = coalesce(ri.resolved_at, now()),
    notes = coalesce(ri.notes, 'Ignored legacy non-sleep Health stage during backlog cleanup.')
from ignored_sleep_stages ignored
where ri.id = ignored.review_item_id;

with ignored_sleep_stages as (
  select ae.id as event_id
  from public.review_items ri
  join public.activity_events ae on ae.id = ri.event_id
  where ri.status = 'ignored'
    and ae.event_type = 'health_sleep_import'
    and not (ae.raw_payload ? 'samples')
    and coalesce(ae.raw_payload->>'sleepStage', '') in ('awake', 'in_bed')
)
update public.activity_events ae
set review_status = 'ignored'
from ignored_sleep_stages ignored
where ae.id = ignored.event_id;

with covered_sleep_stages as (
  select distinct ri.id as review_item_id,
         ae.id as event_id
  from public.review_items ri
  join public.activity_events ae on ae.id = ri.event_id
  join public.time_entries te
    on te.workspace_id = ri.workspace_id
   and te.user_id = ae.user_id
  left join public.categories c on c.id = te.category_id
  where ri.status = 'open'
    and ae.event_type = 'health_sleep_import'
    and not (ae.raw_payload ? 'samples')
    and coalesce(ae.raw_payload->>'sleepStage', 'asleep_unspecified') not in ('awake', 'in_bed')
    and ri.suggested_started_at is not null
    and ri.suggested_stopped_at is not null
    and te.review_status in ('confirmed', 'accepted')
    and te.stopped_at is not null
    and te.started_at <= ri.suggested_started_at + interval '5 minutes'
    and te.stopped_at >= ri.suggested_stopped_at - interval '5 minutes'
    and (
      te.source = 'health_sleep'
      or (
        lower(coalesce(c.name, '')) = 'health'
        and lower(coalesce(te.description, '')) = 'sleep'
      )
    )
)
update public.review_items ri
set status = 'accepted',
    ignored_scope = null,
    resolved_at = coalesce(ri.resolved_at, now()),
    notes = coalesce(ri.notes, 'Accepted legacy Health sleep stage already covered by a confirmed Sleep entry.')
from covered_sleep_stages covered
where ri.id = covered.review_item_id;

with covered_sleep_stages as (
  select ae.id as event_id
  from public.review_items ri
  join public.activity_events ae on ae.id = ri.event_id
  where ri.status = 'accepted'
    and ae.event_type = 'health_sleep_import'
    and not (ae.raw_payload ? 'samples')
    and coalesce(ae.raw_payload->>'sleepStage', 'asleep_unspecified') not in ('awake', 'in_bed')
)
update public.activity_events ae
set review_status = 'confirmed'
from covered_sleep_stages covered
where ae.id = covered.event_id;
