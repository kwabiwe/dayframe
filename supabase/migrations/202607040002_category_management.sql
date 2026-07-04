alter table public.categories
  add column if not exists sort_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

with ranked as (
  select
    id,
    row_number() over (
      partition by workspace_id
      order by is_pinned desc, name, created_at
    ) - 1 as next_sort_order
  from public.categories
  where coalesce(is_archived, false) = false
)
update public.categories c
set sort_order = ranked.next_sort_order,
    updated_at = now()
from ranked
where c.id = ranked.id
  and c.sort_order = 0;

drop index if exists public.idx_categories_workspace_pinned;

create index if not exists idx_categories_workspace_pinned
on public.categories(workspace_id, is_pinned desc, sort_order, name)
where is_archived = false;
