-- Upgrade the dormant local tag tables into the normalized, workspace-safe model.
-- This migration is intentionally idempotent because `npm run db:setup` reapplies
-- every local migration when bringing an existing development database forward.

alter table tags add column if not exists normalized_name text;
alter table tags add column if not exists created_by_user_id uuid references users(id) on delete set null;

update tags
set normalized_name = coalesce(
  nullif(
    trim(both '-_' from regexp_replace(
      regexp_replace(
        regexp_replace(lower(trim(name)), '[[:space:]-]+', '-', 'g'),
        '_+', '_', 'g'
      ),
      '[^a-z0-9_-]+', '', 'g'
    )),
    ''
  ),
  'tag-' || left(id::text, 8)
)
where normalized_name is null;

alter table time_entry_tags add column if not exists workspace_id uuid references workspaces(id) on delete cascade;
alter table time_entry_tags add column if not exists created_by_user_id uuid references users(id) on delete set null;
alter table time_entry_tags add column if not exists created_at timestamptz not null default now();

update time_entry_tags tet
set workspace_id = te.workspace_id,
    created_by_user_id = coalesce(tet.created_by_user_id, te.user_id)
from time_entries te
where te.id = tet.time_entry_id
  and tet.workspace_id is null;

delete from time_entry_tags tet
using time_entries te, tags tag
where tet.time_entry_id = te.id
  and tet.tag_id = tag.id
  and (tet.workspace_id <> te.workspace_id or tet.workspace_id <> tag.workspace_id);

with ranked as (
  select
    id,
    first_value(id) over (
      partition by workspace_id, normalized_name
      order by created_at, id
    ) as canonical_id
  from tags
), duplicate_links as (
  select
    tet.workspace_id,
    tet.time_entry_id,
    ranked.canonical_id as tag_id,
    tet.created_by_user_id,
    tet.created_at
  from time_entry_tags tet
  join ranked on ranked.id = tet.tag_id
  where ranked.id <> ranked.canonical_id
)
insert into time_entry_tags (
  workspace_id,
  time_entry_id,
  tag_id,
  created_by_user_id,
  created_at
)
select
  workspace_id,
  time_entry_id,
  tag_id,
  created_by_user_id,
  created_at
from duplicate_links
on conflict (time_entry_id, tag_id) do nothing;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by workspace_id, normalized_name
      order by created_at, id
    ) as canonical_id
  from tags
)
delete from time_entry_tags tet
using ranked
where tet.tag_id = ranked.id
  and ranked.id <> ranked.canonical_id;

with ranked as (
  select
    id,
    first_value(id) over (
      partition by workspace_id, normalized_name
      order by created_at, id
    ) as canonical_id
  from tags
)
delete from tags tag
using ranked
where tag.id = ranked.id
  and ranked.id <> ranked.canonical_id;

alter table tags alter column normalized_name set not null;
alter table time_entry_tags alter column workspace_id set not null;

alter table time_entry_tags drop constraint if exists time_entry_tags_time_entry_id_fkey;
alter table time_entry_tags drop constraint if exists time_entry_tags_tag_id_fkey;
alter table time_entry_tags drop constraint if exists time_entry_tags_time_entry_id_workspace_id_fkey;
alter table time_entry_tags drop constraint if exists time_entry_tags_tag_id_workspace_id_fkey;
alter table time_entry_tags drop constraint if exists time_entry_tags_entry_workspace_fkey;
alter table time_entry_tags drop constraint if exists time_entry_tags_tag_workspace_fkey;

alter table tags drop constraint if exists tags_workspace_id_name_key;
alter table tags drop constraint if exists tags_workspace_normalized_name_key;
alter table tags drop constraint if exists tags_id_workspace_key;
alter table tags add constraint tags_workspace_normalized_name_key unique (workspace_id, normalized_name);
alter table tags add constraint tags_id_workspace_key unique (id, workspace_id);

alter table time_entries drop constraint if exists time_entries_id_workspace_key;
alter table time_entries add constraint time_entries_id_workspace_key unique (id, workspace_id);

alter table time_entry_tags add constraint time_entry_tags_entry_workspace_fkey
  foreign key (time_entry_id, workspace_id)
  references time_entries(id, workspace_id)
  on delete cascade;
alter table time_entry_tags add constraint time_entry_tags_tag_workspace_fkey
  foreign key (tag_id, workspace_id)
  references tags(id, workspace_id)
  on delete cascade;

create index if not exists idx_tags_workspace_normalized_name
  on tags(workspace_id, normalized_name);
create index if not exists idx_time_entry_tags_workspace_tag
  on time_entry_tags(workspace_id, tag_id);
create index if not exists idx_time_entry_tags_workspace_entry
  on time_entry_tags(workspace_id, time_entry_id);
