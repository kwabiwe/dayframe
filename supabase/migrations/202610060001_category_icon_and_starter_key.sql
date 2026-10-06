-- Additive; apply to staging before the server Preview that reads category icons
-- and starter keys, and to production before that server deploys. Production
-- requires separate approval. No existing row changes.
-- Activities (stored as categories) can carry a Dayframe icon key and a starter key.
-- `icon` is a key from packages/shared/src/icons.ts; null means derive it from the
-- name. `starter_key` marks a starter activity (packages/shared/src/starterActivities.ts)
-- so Health and Location can find Sleep or Commute after a rename. Both are nullable,
-- additive and never backfilled: existing rows keep deriving their icon.
alter table public.categories add column if not exists icon text;
alter table public.categories add column if not exists starter_key text;

alter table public.categories drop constraint if exists categories_icon_format;
alter table public.categories add constraint categories_icon_format
  check (icon is null or icon ~ '^[a-z][a-z0-9-]{0,31}$');
alter table public.categories drop constraint if exists categories_starter_key_format;
alter table public.categories add constraint categories_starter_key_format
  check (starter_key is null or starter_key ~ '^[a-z][a-z0-9-]{0,31}$');

-- At most one active category per starter in a workspace.
create unique index if not exists categories_workspace_starter_key_idx
  on public.categories (workspace_id, starter_key)
  where starter_key is not null and is_archived = false;
