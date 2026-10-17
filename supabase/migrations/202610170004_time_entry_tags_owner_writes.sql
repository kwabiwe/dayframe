-- Time entry tags follow their entry (owner decision, 17 Oct 2026; after 202610170003).
--
-- 1. The policies from 202607180001 compared `te.workspace_id = workspace_id` inside a subquery
--    on time_entries, where the bare column resolves to te.workspace_id, so the check was always
--    true (likewise for tags). The composite foreign keys already keep a link's entry and tag in
--    its workspace; the policies now say so too, against the link's own columns.
-- 2. Writes are owner-only, as on time_entries: only the entry's own user may add or remove its
--    tags. Workspace members keep reading them.
--
-- The Dayframe server connects as the tables' owner and is unaffected. Hosted only.

alter table public.time_entry_tags enable row level security;

drop policy if exists "workspace members can read time entry tags" on public.time_entry_tags;
create policy "workspace members can read time entry tags"
on public.time_entry_tags
for select
using (
  public.dayframe_is_workspace_member(time_entry_tags.workspace_id)
  and exists (
    select 1 from public.time_entries te
    where te.id = time_entry_tags.time_entry_id and te.workspace_id = time_entry_tags.workspace_id
  )
  and exists (
    select 1 from public.tags tag
    where tag.id = time_entry_tags.tag_id and tag.workspace_id = time_entry_tags.workspace_id
  )
);

drop policy if exists "workspace members can write time entry tags" on public.time_entry_tags;
drop policy if exists "users can write own time entry tags" on public.time_entry_tags;
create policy "users can write own time entry tags"
on public.time_entry_tags
for all
using (
  public.dayframe_is_workspace_member(time_entry_tags.workspace_id)
  and exists (
    select 1 from public.time_entries te
    where te.id = time_entry_tags.time_entry_id
      and te.workspace_id = time_entry_tags.workspace_id
      and te.user_id = auth.uid()
  )
)
with check (
  public.dayframe_is_workspace_member(time_entry_tags.workspace_id)
  and exists (
    select 1 from public.time_entries te
    where te.id = time_entry_tags.time_entry_id
      and te.workspace_id = time_entry_tags.workspace_id
      and te.user_id = auth.uid()
  )
  and exists (
    select 1 from public.tags tag
    where tag.id = time_entry_tags.tag_id and tag.workspace_id = time_entry_tags.workspace_id
  )
);
