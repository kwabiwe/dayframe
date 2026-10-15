-- Per-place "Log automatically" (owner decision 14 Oct 2026). When a finalised stay at a saved place
-- with auto_log on passes the conservative checks (trusted confidence and boundaries, no overlap with
-- any tracked time, no timer running), the server logs it as a block instead of a Review card.
-- Off by default and never backfilled; only meaningful while logging_enabled is on.
alter table places add column if not exists auto_log boolean not null default false;
