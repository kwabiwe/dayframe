-- Additive; apply to staging before the server Preview that accepts Motion &
-- Fitness evidence, and to production before any phone build that sends it.
-- Production requires separate approval. No existing row changes.
-- Motion & Fitness activity (Core Motion) is a coordinate-free classification
-- (still, walking, driving...) with the same owner scoping, RLS, retention,
-- export and deletion as every other Location evidence kind.
alter table public.location_evidence drop constraint if exists location_evidence_evidence_type_check;
alter table public.location_evidence drop constraint if exists location_evidence_type_check;
alter table public.location_evidence add constraint location_evidence_type_check check (evidence_type in (
  'standard_location', 'significant_change', 'visit', 'geofence_enter',
  'geofence_exit', 'geofence_state', 'location_paused', 'location_resumed', 'provider_status',
  'motion_activity'
));

-- Motion evidence never carries a position.
alter table public.location_evidence drop constraint if exists location_evidence_motion_coordinate_free;
alter table public.location_evidence add constraint location_evidence_motion_coordinate_free
  check (evidence_type <> 'motion_activity' or coordinate is null);
