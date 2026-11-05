-- Evidence retention cascades by evidence_id alone, across stays and commutes.
-- On a populated hosted database, prebuild this index CONCURRENTLY outside the
-- migration transaction, then verify it is valid and ready. See the hosting runbook.
create index if not exists idx_location_segment_evidence_evidence_id
  on public.location_segment_evidence (evidence_id);
