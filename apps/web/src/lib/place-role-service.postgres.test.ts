import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
// The service's own pool (used by createPlace) must point at the disposable database too.
vi.hoisted(() => {
  if (process.env.DAYFRAME_PLACE_ROLE_TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DAYFRAME_PLACE_ROLE_TEST_DATABASE_URL;
  }
});

import { pool as servicePool } from "./db";
import { placeDisplayNameSql } from "./place-display";
import { PlaceRoleConflictError, assignPlaceRoleWith } from "./place-role-service";
import type { RequestSession } from "./session";

// Run with DAYFRAME_PLACE_ROLE_TEST_DATABASE_URL pointing at a disposable local *_test database.
const databaseUrl = process.env.DAYFRAME_PLACE_ROLE_TEST_DATABASE_URL;
const workspaceId = "62000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "62000000-0000-4000-8000-000000000003";
const userId = "62000000-0000-4000-8000-000000000002";
const oldHome = "62000000-0000-4000-8000-000000000101";
const newHome = "62000000-0000-4000-8000-000000000102";
const office = "62000000-0000-4000-8000-000000000103";
const gym = "62000000-0000-4000-8000-000000000104";
const foreign = "62000000-0000-4000-8000-000000000105";
const namedHome = "62000000-0000-4000-8000-000000000106";
const secondNamedHome = "62000000-0000-4000-8000-000000000107";
const entryId = "62000000-0000-4000-8000-000000000201";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:write"] };
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("place roles on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Place role integration tests require a disposable local *_test database.");
    }
    // createPlace uses the app's shared pool; if another file in this worker created it first,
    // it could point elsewhere. Refuse rather than write to it.
    if (servicePool.options.connectionString !== databaseUrl) {
      throw new Error("The app pool is not the disposable test database; run this file in its own worker.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    await clearFixtures(database);
    await database.query("insert into users (id, email, name) values ($1, 'place-roles@example.test', 'Place roles test')", [userId]);
    await database.query("insert into workspaces (id, name) values ($1, 'Place roles'), ($2, 'Other')", [workspaceId, otherWorkspaceId]);
    await database.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
  });

  beforeEach(async () => {
    const db = database!;
    await db.query("delete from time_entries where workspace_id = $1", [workspaceId]);
    await db.query("delete from places where workspace_id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
    await db.query(
      `insert into places (id, workspace_id, name, role) values
         ($1, $6, '12 Example Street', 'home'),
         ($2, $6, '34 Sample Road', null),
         ($3, $6, 'Office tower', 'work'),
         ($4, $6, 'Gym', null),
         ($5, $7, 'Elsewhere', null)`,
      [oldHome, newHome, office, gym, foreign, workspaceId, otherWorkspaceId]
    );
    await db.query(
      `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, place_id, started_at, stopped_at)
       values ($1, $2, $3, 'manual_app', 'high', 'confirmed', $4, '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z')`,
      [entryId, workspaceId, userId, oldHome]
    );
  });

  afterAll(async () => {
    if (!database) return;
    await clearFixtures(database);
    await database.end();
  });

  it("moves Home without touching past entries, and renames the old Home", async () => {
    const result = await inTransaction((client) =>
      assignPlaceRoleWith(client, session, { role: "home", placeId: newHome, previousPlaceName: "Previous home" }));

    expect(result).toEqual({ status: "assigned", placeId: newHome, previousPlaceId: oldHome });
    expect(await roles()).toEqual({
      [oldHome]: { name: "Previous home", role: null },
      [newHome]: { name: "34 Sample Road", role: "home" },
      [office]: { name: "Office tower", role: "work" },
      [gym]: { name: "Gym", role: null }
    });
    // The entry recorded at the old Home stays there and now reads as its new name.
    expect(await entryPlaceName()).toEqual({ placeId: oldHome, placeName: "Previous home" });
  });

  it("shows the role label for entries at the role place", async () => {
    expect(await entryPlaceName()).toEqual({ placeId: oldHome, placeName: "Home" });
  });

  it("keeps the old name when no new one is given, and empties a slot", async () => {
    await inTransaction((client) => assignPlaceRoleWith(client, session, { role: "home", placeId: null }));

    expect((await roles())[oldHome]).toEqual({ name: "12 Example Street", role: null });
    expect(Object.values(await roles()).filter((place) => place.role === "home")).toEqual([]);
  });

  it("gives the Work place Home and leaves Work empty, since a place holds one role", async () => {
    await inTransaction((client) => assignPlaceRoleWith(client, session, { role: "home", placeId: office }));

    const after = await roles();
    expect(after[office]?.role).toBe("home");
    expect(after[oldHome]?.role).toBeNull();
    expect(Object.values(after).filter((place) => place.role === "work")).toEqual([]);
  });

  it("is a no-op for the current holder, even with a rename", async () => {
    const result = await inTransaction((client) =>
      assignPlaceRoleWith(client, session, { role: "home", placeId: oldHome, previousPlaceName: "Previous home" }));

    expect(result).toEqual({ status: "assigned", placeId: oldHome, previousPlaceId: null });
    expect((await roles())[oldHome]).toEqual({ name: "12 Example Street", role: "home" });
  });

  it("refuses a place from another workspace without changing anything", async () => {
    const result = await inTransaction((client) => assignPlaceRoleWith(client, session, { role: "home", placeId: foreign }));

    expect(result).toEqual({ status: "place_not_found" });
    expect((await roles())[oldHome]?.role).toBe("home");
  });

  it("renames a place named Home when Home first goes to another place, only if asked", async () => {
    const db = database!;
    await db.query("update places set role = null where id = $1", [oldHome]);
    await db.query("insert into places (id, workspace_id, name) values ($1, $2, ' home ')", [namedHome, workspaceId]);

    await inTransaction((client) => assignPlaceRoleWith(client, session, { role: "home", placeId: gym }));
    expect((await roles())[namedHome]).toEqual({ name: " home ", role: null });

    await inTransaction((client) => assignPlaceRoleWith(client, session, { role: "home", placeId: null }));
    const result = await inTransaction((client) =>
      assignPlaceRoleWith(client, session, { role: "home", placeId: newHome, previousPlaceName: "Previous home" }));
    expect(result).toEqual({ status: "assigned", placeId: newHome, previousPlaceId: namedHome });
    expect((await roles())[namedHome]).toEqual({ name: "Previous home", role: null });
    expect((await roles())[newHome]?.role).toBe("home");
  });

  it("renames every place named Home, so none keeps reading Home beside the new one", async () => {
    const db = database!;
    await db.query("update places set role = null where id = $1", [oldHome]);
    await db.query(
      "insert into places (id, workspace_id, name) values ($1, $3, 'Home'), ($2, $3, 'HOME')",
      [namedHome, secondNamedHome, workspaceId]
    );

    await inTransaction((client) =>
      assignPlaceRoleWith(client, session, { role: "home", placeId: newHome, previousPlaceName: "Previous home" }));

    const after = await roles();
    expect(after[namedHome]).toEqual({ name: "Previous home", role: null });
    expect(after[secondNamedHome]).toEqual({ name: "Previous home", role: null });
    expect(after[newHome]?.role).toBe("home");
  });

  it("leaves no new place behind when adding a place into a slot loses a race", async () => {
    const { createPlace } = await import("./event-service");
    const holder = await database!.connect();
    try {
      await holder.query("begin");
      await assignPlaceRoleWith(holder, session, { role: "home", placeId: newHome });
      const racing = createPlace({ name: "Racing place", latitude: 51.5, longitude: -0.12 }, session, { role: "home" })
        .then((value) => ({ value }), (error: unknown) => ({ error }));
      await waitUntilBlockedOnLock();
      await holder.query("commit");
      const outcome = await racing;

      expect("error" in outcome && outcome.error).toBeInstanceOf(PlaceRoleConflictError);
      const leftovers = await database!.query("select id from places where workspace_id = $1 and name = 'Racing place'", [workspaceId]);
      expect(leftovers.rowCount).toBe(0);
      expect((await roles())[newHome]?.role).toBe("home");
    } finally {
      holder.release();
    }
  });

  it("enforces one Home per workspace in the database", async () => {
    await expect(database!.query("update places set role = 'home' where id = $1", [gym])).rejects.toMatchObject({ code: "23505" });
    await expect(database!.query("update places set role = 'gym' where id = $1", [gym])).rejects.toMatchObject({ code: "23514" });
  });

  it("serialises two moves of Home: one wins, the other is a retryable conflict", async () => {
    const first = await database!.connect();
    const second = await database!.connect();
    try {
      await first.query("begin");
      await second.query("begin");
      await assignPlaceRoleWith(first, session, { role: "home", placeId: newHome });
      const racing = assignPlaceRoleWith(second, session, { role: "home", placeId: gym }).then(
        (value) => ({ value }), (error: unknown) => ({ error }));
      await waitUntilBlockedOnLock();
      await first.query("commit");
      const outcome = await racing;
      await second.query("rollback");

      expect("error" in outcome && outcome.error).toBeInstanceOf(PlaceRoleConflictError);
      const after = await roles();
      expect(Object.entries(after).filter(([, place]) => place.role === "home").map(([id]) => id)).toEqual([newHome]);
    } finally {
      first.release();
      second.release();
    }
  });

  it("swaps Home and Work between two places from both sides without deadlocking", async () => {
    const first = await database!.connect();
    const second = await database!.connect();
    try {
      await first.query("begin");
      await second.query("begin");
      await first.query("set local lock_timeout = '3s'");
      await second.query("set local lock_timeout = '3s'");
      const moves = Promise.allSettled([
        assignPlaceRoleWith(first, session, { role: "home", placeId: office }).then(() => first.query("commit")),
        assignPlaceRoleWith(second, session, { role: "work", placeId: oldHome }).then(() => second.query("commit"))
      ]);
      const settled = await moves;
      for (const [index, outcome] of settled.entries()) {
        if (outcome.status === "rejected") {
          await (index === 0 ? first : second).query("rollback");
          // A clean conflict is acceptable; a deadlock or lock timeout is not.
          expect(outcome.reason).toBeInstanceOf(PlaceRoleConflictError);
        }
      }
      const after = await roles();
      expect(Object.values(after).filter((place) => place.role === "home").length).toBeLessThanOrEqual(1);
      expect(Object.values(after).filter((place) => place.role === "work").length).toBeLessThanOrEqual(1);
    } finally {
      first.release();
      second.release();
    }
  });
});

// Wait until another connection is waiting on a row lock, so the race really overlaps.
async function waitUntilBlockedOnLock() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await database!.query<{ waiting: number }>(
      `select count(*)::int as waiting from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`);
    if ((result.rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The racing transaction never waited on the role lock.");
}

async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>) {
  const client = await database!.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function roles() {
  const result = await database!.query<{ id: string; name: string; role: string | null }>(
    "select id, name, role from places where workspace_id = $1 order by id", [workspaceId]);
  return Object.fromEntries(result.rows.map((row) => [row.id, { name: row.name, role: row.role }]));
}

async function entryPlaceName() {
  const result = await database!.query<{ placeId: string; placeName: string }>(
    `select te.place_id as "placeId", coalesce(${placeDisplayNameSql("pl")}, te.place_label) as "placeName"
     from time_entries te
     left join places pl on pl.id = te.place_id and pl.workspace_id = te.workspace_id
     where te.id = $1`,
    [entryId]
  );
  return result.rows[0];
}

async function clearFixtures(db: pg.Pool) {
  await db.query("delete from time_entries where workspace_id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
  await db.query("delete from places where workspace_id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
  await db.query("delete from workspace_members where workspace_id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
  await db.query("delete from workspaces where id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
  await db.query("delete from users where id = $1", [userId]);
}
