alter table public.time_entries
  add column if not exists place_label varchar(120);

alter table public.time_entries
  drop constraint if exists time_entries_place_identity_check;

alter table public.time_entries
  add constraint time_entries_place_identity_check check (
    not (place_id is not null and place_label is not null)
    and (place_label is null or length(btrim(place_label)) between 1 and 120)
  );

comment on column public.time_entries.place_label is
  'User-selected one-time place name. Mutually exclusive with place_id; no provider metadata is retained.';
