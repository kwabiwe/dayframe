-- Durable idempotency receipts for mobile Review terminal mutations.

create table if not exists public.review_mutation_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  client_mutation_id uuid not null,
  review_item_id uuid not null,
  action_key text not null,
  request_hash text not null,
  result_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint review_mutation_receipts_action_length
    check (char_length(action_key) between 1 and 80),
  constraint review_mutation_receipts_hash_length
    check (char_length(request_hash) = 64),
  unique(workspace_id, user_id, client_mutation_id)
);

create index if not exists idx_review_mutation_receipts_item
  on public.review_mutation_receipts(
    workspace_id,
    user_id,
    review_item_id,
    created_at desc
  );

alter table public.review_mutation_receipts enable row level security;

drop policy if exists "workspace members can read own review mutation receipts"
  on public.review_mutation_receipts;
create policy "workspace members can read own review mutation receipts"
on public.review_mutation_receipts
for select
using (
  public.dayframe_is_workspace_member(workspace_id)
  and user_id = auth.uid()
);

drop policy if exists "workspace members can write own review mutation receipts"
  on public.review_mutation_receipts;
create policy "workspace members can write own review mutation receipts"
on public.review_mutation_receipts
for all
using (
  public.dayframe_is_workspace_member(workspace_id)
  and user_id = auth.uid()
)
with check (
  public.dayframe_is_workspace_member(workspace_id)
  and user_id = auth.uid()
);
