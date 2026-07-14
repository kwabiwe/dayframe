alter table public.places
  add column if not exists logging_enabled boolean not null default true;
