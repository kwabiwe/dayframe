-- "Log trips automatically" (PRD D19, owner decision A4, 16 Oct 2026). With it on, a Move between
-- two known places with a clear travel mode becomes a block instead of a Review card when it overlaps
-- no tracked time by more than five minutes and no timer runs. On by default; one switch per person.
alter table users add column if not exists log_trips_automatically boolean not null default true;
