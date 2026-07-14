alter table public.learned_places
  add column if not exists distinct_day_count integer not null default 1,
  add column if not exists total_dwell_seconds bigint not null default 0,
  add column if not exists longest_dwell_seconds bigint not null default 0,
  add column if not exists average_accuracy_meters double precision,
  add column if not exists max_cluster_spread_meters double precision,
  add column if not exists classification text not null default 'noise',
  add column if not exists address jsonb,
  add column if not exists poi_name text,
  add column if not exists formatted_address text,
  add column if not exists geocoded_at timestamptz;

update public.learned_places
set visit_count = greatest(
      1,
      case
        when coalesce(raw_payload ->> 'visitCount', '') ~ '^[0-9]+$'
          then (raw_payload ->> 'visitCount')::integer
        else visit_count
      end
    ),
    sample_count = greatest(
      1,
      case
        when coalesce(raw_payload ->> 'sampleCount', '') ~ '^[0-9]+$'
          then (raw_payload ->> 'sampleCount')::integer
        else sample_count
      end
    ),
    distinct_day_count = greatest(
      1,
      case
        when coalesce(raw_payload ->> 'distinctDayCount', '') ~ '^[0-9]+$'
          then (raw_payload ->> 'distinctDayCount')::integer
        when first_seen_at::date <> last_seen_at::date then 2
        else 1
      end
    ),
    total_dwell_seconds = greatest(
      0,
      case
        when coalesce(raw_payload ->> 'totalDwellMs', '') ~ '^[0-9]+(\.[0-9]+)?$'
          then round((raw_payload ->> 'totalDwellMs')::numeric / 1000)::bigint
        when coalesce(raw_payload ->> 'durationSeconds', '') ~ '^[0-9]+$'
          then (raw_payload ->> 'durationSeconds')::bigint * greatest(
            case
              when coalesce(raw_payload ->> 'visitCount', '') ~ '^[0-9]+$'
                then (raw_payload ->> 'visitCount')::integer
              else visit_count
            end,
            1
          )
        else 0
      end
    ),
    longest_dwell_seconds = greatest(
      0,
      case
        when coalesce(raw_payload ->> 'longestDwellMs', '') ~ '^[0-9]+(\.[0-9]+)?$'
          then round((raw_payload ->> 'longestDwellMs')::numeric / 1000)::bigint
        when coalesce(raw_payload ->> 'durationSeconds', '') ~ '^[0-9]+$'
          then (raw_payload ->> 'durationSeconds')::bigint
        else 0
      end
    ),
    average_accuracy_meters = case
      when coalesce(raw_payload ->> 'averageAccuracyMeters', '') ~ '^[0-9]+(\.[0-9]+)?$'
        then (raw_payload ->> 'averageAccuracyMeters')::double precision
      when coalesce(raw_payload ->> 'accuracy', '') ~ '^[0-9]+(\.[0-9]+)?$'
        then (raw_payload ->> 'accuracy')::double precision
      else average_accuracy_meters
    end,
    max_cluster_spread_meters = case
      when coalesce(raw_payload ->> 'maxClusterSpreadMeters', '') ~ '^[0-9]+(\.[0-9]+)?$'
        then (raw_payload ->> 'maxClusterSpreadMeters')::double precision
      else max_cluster_spread_meters
    end,
    address = case
      when jsonb_typeof(raw_payload -> 'address') = 'object' then raw_payload -> 'address'
      else address
    end,
    poi_name = case
      when nullif(raw_payload -> 'address' ->> 'name', '') is not null
        and (raw_payload -> 'address' ->> 'name') !~ '^[[:space:]]*[0-9]'
        and lower(raw_payload -> 'address' ->> 'name')
          <> lower(coalesce(raw_payload -> 'address' ->> 'street', ''))
        then raw_payload -> 'address' ->> 'name'
      else poi_name
    end,
    name = case
      when nullif(raw_payload -> 'address' ->> 'name', '') is not null
        and (raw_payload -> 'address' ->> 'name') !~ '^[[:space:]]*[0-9]'
        and lower(raw_payload -> 'address' ->> 'name')
          <> lower(coalesce(raw_payload -> 'address' ->> 'street', ''))
        then raw_payload -> 'address' ->> 'name'
      else name
    end,
    formatted_address = coalesce(nullif(raw_payload -> 'address' ->> 'formattedAddress', ''), formatted_address),
    geocoded_at = case
      when jsonb_typeof(raw_payload -> 'address') = 'object' then coalesce(geocoded_at, updated_at)
      else geocoded_at
    end;

update public.learned_places
set classification = case
  when visit_count >= 2
    and distinct_day_count >= 2
    and sample_count >= 6
    and total_dwell_seconds >= 2400
    and longest_dwell_seconds >= 1200
    and coalesce(average_accuracy_meters <= 100, true)
    and coalesce(max_cluster_spread_meters <= 140, true)
    then 'place_candidate'
  when visit_count = 1
    and distinct_day_count = 1
    and sample_count >= 4
    and longest_dwell_seconds >= 3600
    and coalesce(average_accuracy_meters <= 100, true)
    and coalesce(max_cluster_spread_meters <= 140, true)
    then 'one_off_activity'
  else 'noise'
end;

alter table public.learned_places
  drop constraint if exists learned_places_distinct_day_count_positive,
  drop constraint if exists learned_places_total_dwell_nonnegative,
  drop constraint if exists learned_places_longest_dwell_nonnegative,
  drop constraint if exists learned_places_classification_check;

alter table public.learned_places
  add constraint learned_places_distinct_day_count_positive check (distinct_day_count > 0),
  add constraint learned_places_total_dwell_nonnegative check (total_dwell_seconds >= 0),
  add constraint learned_places_longest_dwell_nonnegative check (longest_dwell_seconds >= 0),
  add constraint learned_places_classification_check
    check (classification in ('place_candidate', 'one_off_activity', 'noise'));

create index if not exists idx_learned_places_saveable_candidates
on public.learned_places(workspace_id, user_id, last_seen_at desc)
where status = 'candidate' and classification = 'place_candidate';
