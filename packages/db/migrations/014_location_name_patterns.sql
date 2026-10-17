-- Learned names for location items (Location v3, PRD D19 A8; owner decision 16 Oct 2026). A name or
-- activity the person typed or chose for a Stay or Move in Review is kept against the item's pattern
-- (a saved or learned place, or a 150 m cell for an unknown place; a Move's two ends and mode; a
-- round trip's origin, turnaround cell and mode) and time-of-day band, and suggested next time:
-- prefilled after one use, naming automatic blocks after two. Suggestions, never rules; only words the
-- person typed count; uses counts a name, category_uses an activity. auto_log_opt_out is "Don't log trips like this" (PR 11). Location data: kept per
-- user, exported and deleted with the workspace.
create table if not exists location_name_patterns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  pattern_key text not null check (length(pattern_key) between 1 and 300),
  band text not null check (band in ('morning', 'afternoon', 'evening', 'weekend')),
  name text check (name is null or length(btrim(name)) between 1 and 500),
  category_id uuid references categories(id) on delete set null,
  uses integer not null default 0 check (uses >= 0),
  category_uses integer not null default 0 check (category_uses >= 0),
  auto_log_opt_out boolean not null default false,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id, pattern_key, band)
);
create index if not exists idx_location_name_patterns_key
  on location_name_patterns(workspace_id, user_id, pattern_key);
-- A round trip's pattern reads its route links by commute (the existing indexes lead with evidence).
create index if not exists idx_segment_evidence_commute_lookup
  on location_segment_evidence(commute_segment_id, role)
  where commute_segment_id is not null;
