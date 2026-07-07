alter table public.places
  add column if not exists default_activity_description text;
