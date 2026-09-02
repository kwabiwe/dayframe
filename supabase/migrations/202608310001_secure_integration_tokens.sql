-- Integration tokens are server-only authentication material. Dayframe's
-- server resolves their hashes through its direct Postgres connection; no
-- browser/client role should be able to inspect or mutate this table.
alter table public.integration_tokens enable row level security;

revoke all privileges
on table public.integration_tokens
from public, anon, authenticated;

