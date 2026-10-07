-- A saved place can hold the Home or Work role, like the two pinned slots in a maps app.
-- The role belongs to the place, so moving Home to another place never rewrites the
-- entries recorded at the old one. Labels come from packages/shared/src/placeRoles.ts.
-- Nullable, additive and never backfilled: a place named "Home" keeps being treated
-- as Home until someone gives a place the role.
alter table places add column if not exists role text;

alter table places drop constraint if exists places_role_check;
alter table places add constraint places_role_check
  check (role is null or role in ('home', 'work'));

-- At most one Home and one Work per workspace.
create unique index if not exists places_workspace_role_idx
  on places (workspace_id, role)
  where role is not null;
