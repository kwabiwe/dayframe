-- Places at scale (location v3 PR 16, design §11.1): a spatial index for "saved places near this
-- point" (Location evidence's nearby saved places). The expression is exactly the one the query
-- uses, so with thousands of places the search reads the index instead of every place.
--
-- Additive and optional for correctness (without it the search is slower, not wrong); apply to
-- staging and then production in the usual order. No RLS change.
create index if not exists idx_places_geography
  on public.places using gist ((ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography))
  where latitude is not null and longitude is not null;
