-- Places at scale (location v3 PR 16): spatial index for saved places near a point.
create index if not exists idx_places_geography
  on places using gist ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography))
  where latitude is not null and longitude is not null;
