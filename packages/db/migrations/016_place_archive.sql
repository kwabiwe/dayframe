-- Archive place (location v3 PR 15, PRD D19 A10): null means active; an archived place keeps its
-- name on past blocks but leaves matching, geofences, nearby suggestions and pickers.
alter table places add column if not exists archived_at timestamptz;
-- A place that replaced an archived one matches only evidence from then (null: all evidence).
alter table places add column if not exists matching_starts_at timestamptz;
