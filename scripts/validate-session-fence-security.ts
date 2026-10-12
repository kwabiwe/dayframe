import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// Forgot password (UIA-317): the session fence must be server-owned on hosted Supabase, so a
// user's own JWT can neither clear it (bypassing a reset) nor push it ahead (locking themselves out).
const target = process.env.DATABASE_URL;
assert(target, "DATABASE_URL is required.");
const url = new URL(target);
assert(
  ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"),
  "Security validation requires a disposable local *_test database."
);

const client = new pg.Client({ connectionString: target });

async function run() {
  await client.connect();
  try {
    // The base profile has only 001; the local migration is idempotent.
    await client.query(readFileSync(resolve("packages/db/migrations/011_user_session_fences.sql"), "utf8"));
    // Supabase's default privileges grant new public tables to its client roles.
    await client.query(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
      end
      $$;
      grant usage on schema public to anon, authenticated;
      grant select, insert, update, delete, truncate on table public.user_session_fences to anon, authenticated;
    `);

    await client.query(readFileSync(resolve("supabase/migrations/202610120001_user_session_fences.sql"), "utf8"));

    const result = await client.query<{
      rlsEnabled: boolean;
      anonPrivileges: boolean;
      authenticatedPrivileges: boolean;
      publicPrivileges: boolean;
      policyCount: string;
    }>(`
      select
        c.relrowsecurity as "rlsEnabled",
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as "anonPrivileges",
        has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as "authenticatedPrivileges",
        has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as "publicPrivileges",
        (select count(*)::text from pg_policies p
          where p.schemaname = 'public' and p.tablename = 'user_session_fences') as "policyCount"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'user_session_fences'
    `);
    assert.equal(result.rowCount, 1, "user_session_fences must exist.");
    const row = result.rows[0];
    assert.equal(row.rlsEnabled, true, "user_session_fences must have RLS enabled.");
    assert.equal(row.anonPrivileges, false, "anon must have no user_session_fences privileges.");
    assert.equal(row.authenticatedPrivileges, false, "authenticated must have no user_session_fences privileges.");
    assert.equal(row.publicPrivileges, false, "PUBLIC must have no user_session_fences privileges.");
    assert.equal(row.policyCount, "0", "user_session_fences must expose no client RLS policies.");

    // As a signed-in client: clearing or moving a fence is refused outright.
    for (const statement of [
      "delete from public.user_session_fences",
      "update public.user_session_fences set sessions_valid_after = now() + interval '10 years'",
      "insert into public.user_session_fences (user_id, sessions_valid_after) values (gen_random_uuid(), now())"
    ]) {
      await client.query("begin");
      try {
        await client.query("set local role authenticated");
        await assert.rejects(client.query(statement), /permission denied/, `authenticated must not run: ${statement}`);
      } finally {
        await client.query("rollback");
      }
    }
    console.log("Session fence table is server-only: RLS enabled, client grants revoked, client writes refused.");
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
