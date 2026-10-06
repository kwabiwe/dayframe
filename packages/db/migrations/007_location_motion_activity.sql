-- Motion & Fitness activity (Core Motion) joins Location evidence. It is a
-- coordinate-free classification (still, walking, driving...) with the same
-- owner scoping, retention, export and deletion as every other kind.
-- The base schema's inline check is auto-named; hosted Supabase names it.
alter table location_evidence drop constraint if exists location_evidence_evidence_type_check;
alter table location_evidence drop constraint if exists location_evidence_type_check;
alter table location_evidence add constraint location_evidence_type_check check (evidence_type in (
  'standard_location', 'significant_change', 'visit', 'geofence_enter',
  'geofence_exit', 'geofence_state', 'location_paused', 'location_resumed', 'provider_status',
  'motion_activity'
));

-- Motion evidence never carries a position.
alter table location_evidence drop constraint if exists location_evidence_motion_coordinate_free;
alter table location_evidence add constraint location_evidence_motion_coordinate_free
  check (evidence_type <> 'motion_activity' or coordinate is null);
