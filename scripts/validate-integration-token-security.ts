import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

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
      grant select, insert, update, delete, truncate
        on table public.integration_tokens to anon, authenticated;
    `);

    const migration = readFileSync(
      resolve("supabase/migrations/202608310001_secure_integration_tokens.sql"),
      "utf8"
    );
    await client.query(migration);

    const result = await client.query<{
      rlsEnabled: boolean;
      anonPrivileges: boolean;
      authenticatedPrivileges: boolean;
      publicPrivileges: boolean;
      policyCount: string;
    }>(`
      select
        c.relrowsecurity as "rlsEnabled",
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          as "anonPrivileges",
        has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          as "authenticatedPrivileges",
        has_table_privilege('public', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          as "publicPrivileges",
        (select count(*)::text from pg_policies p
          where p.schemaname = 'public' and p.tablename = 'integration_tokens') as "policyCount"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'integration_tokens'
    `);

    assert.equal(result.rowCount, 1, "integration_tokens must exist.");
    const row = result.rows[0];
    assert.equal(row.rlsEnabled, true, "integration_tokens must have RLS enabled.");
    assert.equal(row.anonPrivileges, false, "anon must have no integration_tokens privileges.");
    assert.equal(
      row.authenticatedPrivileges,
      false,
      "authenticated must have no integration_tokens privileges."
    );
    assert.equal(row.publicPrivileges, false, "PUBLIC must have no integration_tokens privileges.");
    assert.equal(row.policyCount, "0", "integration_tokens must expose no client RLS policies.");
    console.log("Integration token table is server-only: RLS enabled and client grants revoked.");
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

