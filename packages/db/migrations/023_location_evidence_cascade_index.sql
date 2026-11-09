-- Expired evidence can cascade to either kind of segment. The two partial
-- stay/commute indexes cannot serve the foreign key's evidence_id-only lookup.
create index if not exists idx_location_segment_evidence_evidence_id
  on location_segment_evidence (evidence_id);
