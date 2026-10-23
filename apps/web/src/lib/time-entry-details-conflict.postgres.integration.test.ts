import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./db";
import { TimeEntryConflictError, updateTimeEntry } from "./event-service";

const runDatabaseIntegration = process.env.DAYFRAME_RUN_DB_INTEGRATION === "1";

// The 409 safety net against a real Postgres: a save based on a description another window has
// since replaced is refused and changes nothing; a save whose base still matches goes through.
describe.runIf(runDatabaseIntegration)("running-block details precondition (Postgres)", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("a save waiting on another's row lock sees that save's tags once it commits (409)", async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const entryId = randomUUID();
    const tagId = randomUUID();
    const session = {
      authMode: "provider" as const,
      scopes: ["app:read", "app:write", "events:write"],
      userId,
      workspaceId
    };
    const setup = await pool.connect();
    const tabX = await pool.connect();
    try {
      await setup.query(`insert into users (id, email, name) values ($1, $2, 'Concurrent precondition test')`,
        [userId, `dayframe-concurrent-${userId}@example.invalid`]);
      await setup.query(`insert into workspaces (id, name) values ($1, 'Concurrent precondition test')`, [workspaceId]);
      await setup.query(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [workspaceId, userId]);
      await setup.query(
        `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at)
         values ($1, $2, $3, 'manual_app', 'high', 'confirmed', 'BAU', now() - interval '30 minutes')`,
        [entryId, workspaceId, userId]
      );
      await setup.query(
        `insert into tags (id, workspace_id, name, normalized_name, created_by_user_id) values ($1, $2, 'Cubic', 'cubic', $3)`,
        [tagId, workspaceId, userId]
      );
      await setup.query(
        `insert into time_entry_tags (workspace_id, time_entry_id, tag_id) values ($1, $2, $3)`,
        [workspaceId, entryId, tagId]
      );

      // Tab X removes #Cubic and holds its transaction open (row locked, tags changed).
      await tabX.query("begin");
      await tabX.query("update time_entries set updated_at = now() where id = $1", [entryId]);
      await tabX.query("delete from time_entry_tags where time_entry_id = $1", [entryId]);

      // Tab Y's save, based on the tags before X's change, waits on the row lock.
      let settled = false;
      const tabY = updateTimeEntry(entryId, { tagNames: ["Cubic", "Urgent"], expectedDetails: { tagNames: ["Cubic"] } }, session)
        .then(
          (value) => { settled = true; return { ok: true as const, value }; },
          (error: unknown) => { settled = true; return { ok: false as const, error }; }
        );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);

      await tabX.query("commit");
      const result = await tabY;
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toBeInstanceOf(TimeEntryConflictError);
      const tags = await setup.query("select count(*)::int as count from time_entry_tags where time_entry_id = $1", [entryId]);
      expect(tags.rows[0]?.count).toBe(0);
    } finally {
      await tabX.query("rollback").catch(() => undefined);
      tabX.release();
      await setup.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
      await setup.query("delete from users where id = $1", [userId]).catch(() => undefined);
      setup.release();
    }
  });

  it("refuses a stale-based save and accepts a current-based one", async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const entryId = randomUUID();
    const session = {
      authMode: "provider" as const,
      scopes: ["app:read", "app:write", "events:write"],
      userId,
      workspaceId
    };
    const client = await pool.connect();
    try {
      await client.query(`insert into users (id, email, name) values ($1, $2, 'Precondition test')`,
        [userId, `dayframe-precondition-${userId}@example.invalid`]);
      await client.query(`insert into workspaces (id, name) values ($1, 'Precondition test')`, [workspaceId]);
      await client.query(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [workspaceId, userId]);
      await client.query(
        `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at)
         values ($1, $2, $3, 'manual_app', 'high', 'confirmed', 'BAU', now() - interval '30 minutes')`,
        [entryId, workspaceId, userId]
      );

      // Tab X saves first.
      await updateTimeEntry(entryId, { description: "app testing", expectedDetails: { description: "BAU" } }, session);
      // Tab Y's edit was based on "BAU": refused.
      await expect(updateTimeEntry(entryId, { description: "BAU", expectedDetails: { description: "app testing x" } }, session))
        .rejects.toBeInstanceOf(TimeEntryConflictError);
      await expect(updateTimeEntry(entryId, { description: "BAU", expectedDetails: { description: "BAU" } }, session))
        .rejects.toBeInstanceOf(TimeEntryConflictError);
      // The refused saves changed nothing.
      const stored = await client.query<{ description: string }>("select description from time_entries where id = $1", [entryId]);
      expect(stored.rows[0]?.description).toBe("app testing");
      await updateTimeEntry(entryId, { tagNames: ["Cubic"], expectedDetails: { tagNames: [] } }, session);
      await expect(updateTimeEntry(entryId, { tagNames: [], expectedDetails: { tagNames: [] } }, session))
        .rejects.toBeInstanceOf(TimeEntryConflictError);
      await updateTimeEntry(entryId, { tagNames: [], expectedDetails: { tagNames: ["cubic"] } }, session);
    } finally {
      await client.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
      await client.query("delete from users where id = $1", [userId]).catch(() => undefined);
      client.release();
    }
  });

  it("a version precondition: both orderings of a late save and a newer one end on the newer text (Codex r3 on #539)", async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const entryId = randomUUID();
    const session = {
      authMode: "provider" as const,
      scopes: ["app:read", "app:write", "events:write"],
      userId,
      workspaceId
    };
    const client = await pool.connect();
    const version = async () => {
      const row = await client.query<{ updatedAt: Date }>(`select updated_at as "updatedAt" from time_entries where id = $1`, [entryId]);
      return row.rows[0]!.updatedAt.toISOString();
    };
    const description = async () =>
      (await client.query<{ description: string }>("select description from time_entries where id = $1", [entryId])).rows[0]?.description;
    try {
      await client.query(`insert into users (id, email, name) values ($1, $2, 'Version precondition test')`,
        [userId, `dayframe-version-${userId}@example.invalid`]);
      await client.query(`insert into workspaces (id, name) values ($1, 'Version precondition test')`, [workspaceId]);
      await client.query(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [workspaceId, userId]);
      await client.query(
        `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at, updated_at)
         values ($1, $2, $3, 'manual_app', 'high', 'confirmed', 'BAU', now() - interval '30 minutes', now() - interval '1 minute')`,
        [entryId, workspaceId, userId]
      );
      const v0 = await version();

      // The newer write (a Stop's text, a revert to "BAU") lands first; the late save at v0 is refused.
      await updateTimeEntry(entryId, { description: "BAU", categoryId: null, expectedDetails: { description: "BAU" }, expectedUpdatedAt: v0 }, session);
      await expect(updateTimeEntry(entryId, { description: "BAU x", expectedDetails: { description: "BAU" }, expectedUpdatedAt: v0 }, session))
        .rejects.toBeInstanceOf(TimeEntryConflictError);
      expect(await description()).toBe("BAU");

      // The late save lands first at the current version; the newer write at the old version is
      // refused, and goes through once at the new one.
      const v1 = await version();
      await updateTimeEntry(entryId, { description: "BAU x", expectedDetails: { description: "BAU" }, expectedUpdatedAt: v1 }, session);
      await expect(updateTimeEntry(entryId, { description: "BAU", expectedDetails: { description: "BAU" }, expectedUpdatedAt: v1 }, session))
        .rejects.toBeInstanceOf(TimeEntryConflictError);
      await updateTimeEntry(entryId, { description: "BAU", expectedDetails: { description: "BAU x" }, expectedUpdatedAt: await version() }, session);
      expect(await description()).toBe("BAU");

      // Without the field (the iPhone): as before.
      await updateTimeEntry(entryId, { description: "Walk" }, session);
      expect(await description()).toBe("Walk");
    } finally {
      await client.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
      await client.query("delete from users where id = $1", [userId]).catch(() => undefined);
      client.release();
    }
  });

  it("a save at a version waiting on another's row lock is refused once that write commits", async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const entryId = randomUUID();
    const session = {
      authMode: "provider" as const,
      scopes: ["app:read", "app:write", "events:write"],
      userId,
      workspaceId
    };
    const setup = await pool.connect();
    const other = await pool.connect();
    try {
      await setup.query(`insert into users (id, email, name) values ($1, $2, 'Version lock test')`,
        [userId, `dayframe-version-lock-${userId}@example.invalid`]);
      await setup.query(`insert into workspaces (id, name) values ($1, 'Version lock test')`, [workspaceId]);
      await setup.query(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [workspaceId, userId]);
      await setup.query(
        `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at, updated_at)
         values ($1, $2, $3, 'manual_app', 'high', 'confirmed', 'BAU', now() - interval '30 minutes', now() - interval '1 minute')`,
        [entryId, workspaceId, userId]
      );
      const v0 = (await setup.query<{ updatedAt: Date }>(`select updated_at as "updatedAt" from time_entries where id = $1`, [entryId]))
        .rows[0]!.updatedAt.toISOString();
      await other.query("begin");
      await other.query("update time_entries set updated_at = now() where id = $1", [entryId]);
      const waiting = updateTimeEntry(entryId, { description: "BAU x", expectedUpdatedAt: v0 }, session).then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error })
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await other.query("commit");
      const result = await waiting;
      expect(!result.ok && result.error).toBeInstanceOf(TimeEntryConflictError);
    } finally {
      await other.query("rollback").catch(() => undefined);
      other.release();
      await setup.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
      await setup.query("delete from users where id = $1", [userId]).catch(() => undefined);
      setup.release();
    }
  });
});
