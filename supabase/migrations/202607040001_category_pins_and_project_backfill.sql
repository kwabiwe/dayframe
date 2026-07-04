alter table public.categories
  add column if not exists is_pinned boolean not null default false;

create index if not exists idx_categories_workspace_pinned
on public.categories(workspace_id, is_pinned desc, name)
where is_archived = false;

insert into public.categories (workspace_id, name, color, is_pinned)
select p.workspace_id, p.name, p.color, false
from public.projects p
where coalesce(p.is_archived, false) = false
  and not exists (
    select 1
    from public.categories c
    where c.workspace_id = p.workspace_id
      and lower(c.name) = lower(p.name)
  );

update public.time_entries te
set category_id = c.id,
    updated_at = now()
from public.projects p
join public.categories c
  on c.workspace_id = p.workspace_id
 and lower(c.name) = lower(p.name)
where te.project_id = p.id
  and te.category_id is null;
