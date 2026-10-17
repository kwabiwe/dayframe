import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// Owner-only writes (supabase/migrations/202610170003): a signed-in client may read its
// workspace's activity events and time entries, but insert, change or delete only its own.
const target = process.env.DATABASE_URL;
assert(target, "DATABASE_URL is required.");
const url = new URL(target);
assert(
  ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname.endsWith("_test"),
  "Security validation requires a disposable local *_test database."
);

const client = new pg.Client({ connectionString: target });
const tables = ["activity_events", "time_entries"] as const;
type Table = (typeof tables)[number];

const workspace = randomUUID();
const otherWorkspace = randomUUID();
const owner = randomUUID();
const member = randomUUID();
const outsider = randomUUID();
const rows: Record<Table, { owner: string; member: string }> = {
  activity_events: { owner: randomUUID(), member: randomUUID() },
  time_entries: { owner: randomUUID(), member: randomUUID() }
};

function insertSql(table: Table, id: string, userId: string, workspaceId = workspace) {
  return table === "activity_events"
    ? {
        text: `insert into public.activity_events (id, workspace_id, user_id, source, event_type, occurred_at, confidence)
               values ($1, $2, $3, 'manual_app', 'timer_started', now(), 'high')`,
        values: [id, workspaceId, userId]
      }
    : {
        text: `insert into public.time_entries (id, workspace_id, user_id, started_at, stopped_at)
               values ($1, $2, $3, now() - interval '1 hour', now())`,
        values: [id, workspaceId, userId]
      };
}

/** A harmless change to one row (both tables have these columns from 001). */
function touchSql(table: Table) {
  return table === "activity_events"
    ? "update public.activity_events set confidence = confidence where id = $1"
    : "update public.time_entries set started_at = started_at where id = $1";
}

/** Runs `work` as a signed-in client (Supabase's `authenticated` role with that user's JWT subject). */
async function asUser<T>(userId: string, work: () => Promise<T>) {
  await client.query("begin");
  try {
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return await work();
  } finally {
    await client.query("rollback");
  }
}

async function policies(table: Table) {
  const result = await client.query<{ policyname: string }>(
    "select policyname from pg_policies where schemaname = 'public' and tablename = $1 order by policyname",
    [table]
  );
  return result.rows.map((row) => row.policyname);
}

async function run() {
  await client.connect();
  try {
    // Supabase's client roles, default grants and auth.uid(), as the hosted project has them.
    await client.query(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      end
      $$;
      create schema if not exists auth;
      create or replace function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;
      grant usage on schema public to anon, authenticated;
      grant select, insert, update, delete on all tables in schema public to anon, authenticated;
    `);
    await client.query(readFileSync(resolve("supabase/migrations/202607020001_dayframe_rls.sql"), "utf8"));

    await client.query("insert into public.users (id, email, name) values ($1, $2, 'Owner'), ($3, $4, 'Member'), ($5, $6, 'Outsider')", [
      owner, `owner-${owner}@example.test`, member, `member-${member}@example.test`, outsider, `outsider-${outsider}@example.test`
    ]);
    await client.query("insert into public.workspaces (id, name) values ($1, 'Shared'), ($2, 'Other')", [workspace, otherWorkspace]);
    await client.query("insert into public.workspace_members (workspace_id, user_id) values ($1, $2), ($1, $3), ($4, $5)", [
      workspace, owner, member, otherWorkspace, outsider
    ]);
    for (const table of tables) {
      await client.query(insertSql(table, rows[table].owner, owner));
      await client.query(insertSql(table, rows[table].member, member));
    }

    // Before: any member may change another member's rows (what this migration closes).
    for (const table of tables) {
      const changed = await asUser(owner, () => client.query(`delete from public.${table} where id = $1`, [rows[table].member]));
      assert.equal(changed.rowCount, 1, `${table}: before the migration a member could delete another member's row`);
    }

    // Applying it twice leaves the same policies (it is re-runnable).
    const migration = readFileSync(resolve("supabase/migrations/202610170003_owner_only_event_entry_writes.sql"), "utf8");
    await client.query(migration);
    await client.query(migration);

    for (const table of tables) {
      assert.deepEqual(await policies(table), ["users can write own rows", "workspace members can read"], `${table} policies`);
      const { member: theirs, owner: mine } = rows[table];

      await asUser(owner, async () => {
        // Reads are unchanged: the workspace's rows, the other member's included.
        const read = await client.query(`select id from public.${table} where id = any($1::uuid[])`, [[mine, theirs]]);
        assert.equal(read.rowCount, 2, `${table}: a member still reads the workspace's rows`);

        // Another member's row: not changed, not deleted (RLS hides it from writes).
        assert.equal((await client.query(touchSql(table), [theirs])).rowCount, 0,
          `${table}: another member's row cannot be changed`);
        assert.equal((await client.query(`delete from public.${table} where id = $1`, [theirs])).rowCount, 0,
          `${table}: another member's row cannot be deleted`);

        // Their own row: changed and deleted; never handed to someone else or another workspace.
        assert.equal((await client.query(touchSql(table), [mine])).rowCount, 1,
          `${table}: the owner changes their own row`);
        await client.query("savepoint handover");
        await assert.rejects(client.query(`update public.${table} set user_id = $2 where id = $1`, [mine, member]),
          /row-level security/, `${table}: a row cannot be handed to another user`);
        await client.query("rollback to savepoint handover");
        await client.query("savepoint move");
        await assert.rejects(client.query(`update public.${table} set workspace_id = $2 where id = $1`, [mine, otherWorkspace]),
          /row-level security|foreign key|violates/, `${table}: a row cannot move to a workspace the user is not in`);
        await client.query("rollback to savepoint move");

        // Inserts: only as themselves, only into their own workspace.
        await client.query(insertSql(table, randomUUID(), owner));
        await client.query("savepoint forged");
        await assert.rejects(client.query(insertSql(table, randomUUID(), member)), /row-level security/,
          `${table}: a row cannot be inserted for another user`);
        await client.query("rollback to savepoint forged");
        await client.query("savepoint elsewhere");
        await assert.rejects(client.query(insertSql(table, randomUUID(), owner, otherWorkspace)), /row-level security/,
          `${table}: a row cannot be inserted into another workspace`);
        await client.query("rollback to savepoint elsewhere");

        assert.equal((await client.query(`delete from public.${table} where id = $1`, [mine])).rowCount, 1,
          `${table}: the owner deletes their own row`);
      });

      // Someone outside the workspace neither reads nor writes it.
      await asUser(outsider, async () => {
        assert.equal((await client.query(`select id from public.${table} where id = $1`, [theirs])).rowCount, 0,
          `${table}: an outsider reads nothing`);
        assert.equal((await client.query(`delete from public.${table} where id = $1`, [theirs])).rowCount, 0,
          `${table}: an outsider deletes nothing`);
      });

      // Signed out: nothing.
      await client.query("begin");
      try {
        await client.query("set local role anon");
        assert.equal((await client.query(`select id from public.${table}`)).rowCount, 0, `${table}: anon reads nothing`);
      } finally {
        await client.query("rollback");
      }
    }
    console.log("Activity events and time entries: members read the workspace's rows; only a row's own user writes it.");
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
