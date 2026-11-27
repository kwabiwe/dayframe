-- Local setup needs the same replay conflict keys as the hosted Location schema.
begin;

do $$
begin
  if to_regclass('public.idx_segment_evidence_stay_role') is null
    or to_regclass('public.idx_segment_evidence_commute_role') is null then
    lock table public.location_segment_evidence in share row exclusive mode;

    -- Keep the first link, as hosted replay does. Separate roles and segments
    -- remain distinct and the original location evidence is left intact.
    delete from public.location_segment_evidence as link
    using (
      select id, row_number() over (
        partition by evidence_id, stay_segment_id, commute_segment_id, role
        order by created_at, sequence_index, id
      ) as replay_order
      from public.location_segment_evidence
    ) as replayed
    where link.id = replayed.id and replayed.replay_order > 1;
  end if;
end;
$$;

create unique index if not exists idx_segment_evidence_stay_role
  on public.location_segment_evidence(evidence_id, stay_segment_id, role)
  where stay_segment_id is not null;
create unique index if not exists idx_segment_evidence_commute_role
  on public.location_segment_evidence(evidence_id, commute_segment_id, role)
  where commute_segment_id is not null;
create index if not exists idx_location_evidence_unassigned
  on public.location_evidence(workspace_id, user_id, occurred_at) where accepted = true;
create index if not exists idx_learned_places_saveable_candidates
  on public.learned_places(workspace_id, user_id, last_seen_at desc)
  where status = 'candidate' and classification = 'place_candidate';

commit;
