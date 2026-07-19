-- Normalize the existing dormant tag tables and enforce workspace-safe associations.
-- The DDL is idempotent so a hosted environment bootstrapped from the current
-- local base schema can apply the same security migration safely.

alter table public.tags add column if not exists normalized_name text;
alter table public.tags add column if not exists created_by_user_id uuid references public.users(id) on delete set null;

update public.tags
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

alter table public.time_entry_tags add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.time_entry_tags add column if not exists created_by_user_id uuid references public.users(id) on delete set null;
alter table public.time_entry_tags add column if not exists created_at timestamptz not null default now();

update public.time_entry_tags tet
set workspace_id = te.workspace_id,
    created_by_user_id = coalesce(tet.created_by_user_id, te.user_id)
from public.time_entries te
where te.id = tet.time_entry_id
  and tet.workspace_id is null;

delete from public.time_entry_tags tet
using public.time_entries te, public.tags tag
where tet.time_entry_id = te.id
  and tet.tag_id = tag.id
  and (tet.workspace_id <> te.workspace_id or tet.workspace_id <> tag.workspace_id);

-- Point associations at the oldest canonical row before removing legacy
-- case-insensitive duplicates.
with ranked as (
  select
    id,
    first_value(id) over (
      partition by workspace_id, normalized_name
      order by created_at, id
  ) as canonical_id
  from public.tags
), duplicate_links as (
  select
    tet.workspace_id,
    tet.time_entry_id,
    ranked.canonical_id as tag_id,
    tet.created_by_user_id,
    tet.created_at
  from public.time_entry_tags tet
  join ranked on ranked.id = tet.tag_id
  where ranked.id <> ranked.canonical_id
)
insert into public.time_entry_tags (
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
  from public.tags
)
delete from public.time_entry_tags tet
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
  from public.tags
)
delete from public.tags tag
using ranked
where tag.id = ranked.id
  and ranked.id <> ranked.canonical_id;

alter table public.tags alter column normalized_name set not null;
alter table public.time_entry_tags alter column workspace_id set not null;

alter table public.time_entry_tags drop constraint if exists time_entry_tags_time_entry_id_fkey;
alter table public.time_entry_tags drop constraint if exists time_entry_tags_tag_id_fkey;
alter table public.time_entry_tags drop constraint if exists time_entry_tags_time_entry_id_workspace_id_fkey;
alter table public.time_entry_tags drop constraint if exists time_entry_tags_tag_id_workspace_id_fkey;
alter table public.time_entry_tags drop constraint if exists time_entry_tags_entry_workspace_fkey;
alter table public.time_entry_tags drop constraint if exists time_entry_tags_tag_workspace_fkey;

alter table public.tags drop constraint if exists tags_workspace_id_name_key;
alter table public.tags drop constraint if exists tags_workspace_normalized_name_key;
alter table public.tags drop constraint if exists tags_id_workspace_key;
alter table public.tags add constraint tags_workspace_normalized_name_key unique (workspace_id, normalized_name);
alter table public.tags add constraint tags_id_workspace_key unique (id, workspace_id);

alter table public.time_entries drop constraint if exists time_entries_id_workspace_key;
alter table public.time_entries add constraint time_entries_id_workspace_key unique (id, workspace_id);

alter table public.time_entry_tags add constraint time_entry_tags_entry_workspace_fkey
  foreign key (time_entry_id, workspace_id)
  references public.time_entries(id, workspace_id)
  on delete cascade;
alter table public.time_entry_tags add constraint time_entry_tags_tag_workspace_fkey
  foreign key (tag_id, workspace_id)
  references public.tags(id, workspace_id)
  on delete cascade;

create index if not exists idx_tags_workspace_normalized_name
  on public.tags(workspace_id, normalized_name);
create index if not exists idx_time_entry_tags_workspace_tag
  on public.time_entry_tags(workspace_id, tag_id);
create index if not exists idx_time_entry_tags_workspace_entry
  on public.time_entry_tags(workspace_id, time_entry_id);

alter table public.tags enable row level security;
alter table public.time_entry_tags enable row level security;

drop policy if exists "workspace members can read time entry tags" on public.time_entry_tags;
create policy "workspace members can read time entry tags"
on public.time_entry_tags
for select
using (
  public.dayframe_is_workspace_member(workspace_id)
  and exists (
    select 1 from public.time_entries te
    where te.id = time_entry_id and te.workspace_id = workspace_id
  )
  and exists (
    select 1 from public.tags tag
    where tag.id = tag_id and tag.workspace_id = workspace_id
  )
);

drop policy if exists "workspace members can write time entry tags" on public.time_entry_tags;
create policy "workspace members can write time entry tags"
on public.time_entry_tags
for all
using (public.dayframe_is_workspace_member(workspace_id))
with check (
  public.dayframe_is_workspace_member(workspace_id)
  and exists (
    select 1 from public.time_entries te
    where te.id = time_entry_id and te.workspace_id = workspace_id
  )
  and exists (
    select 1 from public.tags tag
    where tag.id = tag_id and tag.workspace_id = workspace_id
  )
);
