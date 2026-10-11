import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
// createSession and the reset share the app's pool, so it must point at the disposable database.
vi.hoisted(() => {
  if (process.env.DAYFRAME_SESSION_FENCE_TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.DAYFRAME_SESSION_FENCE_TEST_DATABASE_URL;
  }
});

import { pool as appPool } from "../db";
import { createSession, createSessionInTransaction, databaseNow, endSignInsAfterPasswordChange } from "./local";
import { AuthError } from "../session";

// Run with DAYFRAME_SESSION_FENCE_TEST_DATABASE_URL pointing at a disposable local *_test database.
const databaseUrl = process.env.DAYFRAME_SESSION_FENCE_TEST_DATABASE_URL;
const userId = "63000000-0000-4000-8000-000000000001";
const workspaceId = "63000000-0000-4000-8000-000000000002";
const unprovisionedId = "63000000-0000-4000-8000-000000000003";
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("the password-reset session fence on disposable PostgreSQL (UIA-317)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Session fence tests require a disposable local *_test database.");
    }
    if (appPool.options.connectionString !== databaseUrl) {
      throw new Error("The app pool is not the disposable test database; run this file in its own worker.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 4 });
    // The base schema profile has only 001; the fence table's migration is idempotent.
    await database.query(readFileSync(new URL("../../../../../packages/db/migrations/011_user_session_fences.sql", import.meta.url), "utf8"));
    await clearFixtures(database);
    await database.query("insert into users (id, email, name) values ($1, 'session-fence@example.test', 'Session fence test')", [userId]);
    await database.query("insert into workspaces (id, name) values ($1, 'Session fence')", [workspaceId]);
    await database.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
  });

  beforeEach(async () => {
    await database!.query("delete from auth_sessions where user_id = $1", [userId]);
    await database!.query("delete from user_session_fences where user_id = $1", [userId]);
  });

  afterAll(async () => {
    if (!database) return;
    await clearFixtures(database);
    await database.end();
    await appPool.end();
  });

  it("refuses a sign-in authenticated before a reset and admits one after it", async () => {
    const before = await databaseNow();
    await endSignInsAfterPasswordChange(userId);
    await expect(createSessionInTransaction(userId, workspaceId, null, before)).rejects.toBeInstanceOf(AuthError);
    const after = await databaseNow();
    await expect(createSessionInTransaction(userId, workspaceId, null, after)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it("revokes a session that was still being created when the reset started", async () => {
    const authenticatedAt = await databaseNow();
    const signIn = await database!.connect();
    try {
      await signIn.query("begin");
      await createSession(signIn, userId, workspaceId, null, authenticatedAt);
      // The reset waits on the user row's lock until the sign-in commits, then revokes its session.
      const reset = endSignInsAfterPasswordChange(userId);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await signIn.query("commit");
      await reset;
    } finally {
      signIn.release();
    }
    const live = await database!.query("select 1 from auth_sessions where user_id = $1 and revoked_at is null", [userId]);
    expect(live.rowCount).toBe(0);
  });

  it("refuses a sign-in that waited on a reset in progress", async () => {
    const authenticatedAt = await databaseNow();
    const reset = await database!.connect();
    try {
      await reset.query("begin");
      await reset.query("select id from users where id = $1 for update", [userId]);
      await reset.query("insert into user_session_fences (user_id, sessions_valid_after) values ($1, now())", [userId]);
      const signIn = createSessionInTransaction(userId, workspaceId, null, authenticatedAt);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await reset.query("commit");
      await expect(signIn).rejects.toBeInstanceOf(AuthError);
    } finally {
      reset.release();
    }
  });

  it("fails closed for an account without a Dayframe row", async () => {
    await expect(endSignInsAfterPasswordChange(unprovisionedId)).rejects.toMatchObject({ status: 503 });
    const fence = await database!.query("select 1 from user_session_fences where user_id = $1", [unprovisionedId]);
    expect(fence.rowCount).toBe(0);
  });
});

async function clearFixtures(db: pg.Pool) {
  await db.query("delete from auth_sessions where user_id = $1", [userId]);
  await db.query("delete from user_session_fences where user_id = $1", [userId]);
  await db.query("delete from workspace_members where workspace_id = $1", [workspaceId]);
  await db.query("delete from workspaces where id = $1", [workspaceId]);
  await db.query("delete from users where id = $1", [userId]);
}
