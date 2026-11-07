import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./db";
import { createManualEntry, deleteTimeEntry, processActivityEvent, updateTimeEntry } from "./event-service";
import { getCompletedEntryRevision, getTimerState } from "./timer-state";
import { attachTagToTimeEntry, createTag, deleteTag, detachTagFromTimeEntry, renameTag } from "./tag-service";

const runDatabaseIntegration = process.env.DAYFRAME_RUN_DB_INTEGRATION === "1";

describe.runIf(runDatabaseIntegration)("timer mutations in Postgres", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("tracks only committed completed-block changes for their workspace and user", async () => {
    const database = new URL(process.env.DATABASE_URL!);
    expect(["localhost", "127.0.0.1"]).toContain(database.hostname);
    expect(database.pathname).toMatch(/_test$/);
    const relation = await pool.query("select to_regclass('dayframe_sync.completed_entry_revisions') as relation");
    if (!relation.rows[0].relation) {
      const migration = new URL("../../../../packages/db/migrations/024_completed_entry_revisions.sql", import.meta.url);
      await pool.query(readFileSync(migration, "utf8"));
    }
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const owner = { authMode: "dev" as const, scopes: ["app:read", "app:write"], userId, workspaceId };
    const other = { ...owner, workspaceId: otherWorkspaceId };

    try {
      await pool.query("insert into users (id,email,name) values ($1,$2,'Revision test')", [userId, `${userId}@example.invalid`]);
      await pool.query("insert into workspaces (id,name) values ($1,'Revision test'),($2,'Isolation test')", [workspaceId, otherWorkspaceId]);
      await pool.query("insert into workspace_members (workspace_id,user_id) values ($1,$3),($2,$3)", [workspaceId, otherWorkspaceId, userId]);
      expect(await getTimerState(owner)).toMatchObject({ activeEntryId: null, completedEntryRevision: "0" });
      const timer = await pool.query<{ id: string }>(
        "insert into time_entries (workspace_id,user_id,description,started_at) values ($1,$2,'Running',now()) returning id",
        [workspaceId, userId]
      );
      expect(await getTimerState(owner)).toMatchObject({ activeEntryId: timer.rows[0].id, completedEntryRevision: "0" });
      await pool.query("delete from time_entries where id = $1", [timer.rows[0].id]);

      const block = await createManualEntry({
        description: "Completed", startedAt: "2026-07-06T10:00:00Z", stoppedAt: "2026-07-06T10:15:00Z"
      }, owner);
      const added = await getTimerState(owner);
      expect(added.activeEntryId).toBeNull();
      expect(added.completedEntryRevision).toMatch(/^[0-9a-f-]{36}$/);
      await updateTimeEntry(block.id, { description: "Changed", tagNames: ["revision fixture"] }, owner);
      const edited = await getCompletedEntryRevision(owner);
      expect(edited).not.toBe(added.completedEntryRevision);
      expect(await getCompletedEntryRevision(other)).toBe("0");

      const writer = await pool.connect();
      try {
        await writer.query("begin");
        await writer.query("update time_entries set description = 'Rolled back' where id = $1", [block.id]);
        expect(await getCompletedEntryRevision(owner)).toBe(edited);
      } finally {
        await writer.query("rollback");
        writer.release();
      }
      await pool.query("update time_entries set description = description where id = $1", [block.id]);
      expect(await getCompletedEntryRevision(owner)).toBe(edited);
      const second = await createManualEntry({
        description: "Second", startedAt: "2026-07-06T11:00:00Z", stoppedAt: "2026-07-06T11:15:00Z"
      }, owner);
      const tag = await pool.query<{ tag_id: string }>(
        "select tag_id from time_entry_tags where workspace_id = $1 and time_entry_id = $2", [workspaceId, block.id]
      );
      expect(tag.rows).toHaveLength(1);
      const tagId = tag.rows[0].tag_id;
      const edit = await pool.connect();
      const rename = await pool.connect();
      try {
        await edit.query("begin");
        await rename.query("begin");
        await rename.query("set local statement_timeout = '2s'");
        await rename.query("select id from tags where id = $1 for update", [tagId]);
        await rename.query("update tags set name = 'Renamed', normalized_name = 'renamed' where id = $1", [tagId]);
        await edit.query("update time_entries set description = 'First edit' where id = $1", [second.id]);
        // A synchronous revision update held by edit would block this write on a different block.
        await rename.query("update time_entries set description = 'Renamed tag' where id = $1", [block.id]);
        await rename.query("commit");
        const renamed = await getCompletedEntryRevision(owner);
        await edit.query(
          "insert into time_entry_tags (workspace_id,time_entry_id,tag_id,created_by_user_id) values ($1,$2,$3,$4)",
          [workspaceId, second.id, tagId, userId]
        );
        await edit.query("commit");
        expect(await getCompletedEntryRevision(owner)).not.toBe(renamed);
      } finally {
        await edit.query("rollback");
        await rename.query("rollback");
        edit.release();
        rename.release();
      }
      const beforeDetach = await getCompletedEntryRevision(owner);
      await detachTagFromTimeEntry(second.id, tagId, owner);
      const detached = await getCompletedEntryRevision(owner);
      expect(detached).not.toBe(beforeDetach);
      await detachTagFromTimeEntry(second.id, tagId, owner);
      expect(await getCompletedEntryRevision(owner)).toBe(detached);
      await attachTagToTimeEntry(second.id, tagId, owner);
      const attached = await getCompletedEntryRevision(owner);
      expect(attached).not.toBe(detached);
      await attachTagToTimeEntry(second.id, tagId, owner);
      expect(await getCompletedEntryRevision(owner)).toBe(attached);
      await pool.query("update time_entries set description = null where id = $1", [second.id]);
      const beforeRename = await getCompletedEntryRevision(owner);
      await renameTag(tagId, { name: "Renamed again" }, owner);
      const renamed = await getCompletedEntryRevision(owner);
      expect(renamed).not.toBe(beforeRename);
      expect((await pool.query("select description from time_entries where id = $1", [second.id])).rows[0].description).toBeNull();
      await deleteTag(tagId, owner);
      expect(await getCompletedEntryRevision(owner)).not.toBe(renamed);
      const beforeDelete = await getCompletedEntryRevision(owner);
      await deleteTimeEntry(block.id, owner);
      expect(await getCompletedEntryRevision(owner)).not.toBe(beforeDelete);
      expect(await getCompletedEntryRevision(other)).toBe("0");

      // The attach can see a running block, then commit after the Stop and a
      // client read. The later tag still needs a new marker.
      const raceTag = await createTag({ name: "Stop race tag" }, owner);
      const running = await pool.query<{ id: string }>(
        "insert into time_entries (workspace_id,user_id,description,started_at) values ($1,$2,'Stop race',now()-interval '20 minutes') returning id",
        [workspaceId, userId]
      );
      const runningId = running.rows[0].id;
      const stop = await pool.connect();
      const attach = await pool.connect();
      try {
        await stop.query("begin");
        await attach.query("begin");
        await attach.query("set local statement_timeout = '3s'");
        await stop.query("update time_entries set stopped_at = now() where id = $1", [runningId]);
        await attach.query(
          "insert into time_entry_tags (workspace_id,time_entry_id,tag_id,created_by_user_id) values ($1,$2,$3,$4)",
          [workspaceId, runningId, raceTag.id, userId]
        );
        await stop.query("commit");
        const stoppedRevision = await getCompletedEntryRevision(owner);
        expect((await pool.query("select 1 from time_entry_tags where time_entry_id = $1", [runningId])).rowCount).toBe(0);
        await attach.query("commit");
        expect(await getCompletedEntryRevision(owner)).not.toBe(stoppedRevision);
        expect((await pool.query("select 1 from time_entry_tags where time_entry_id = $1", [runningId])).rowCount).toBe(1);
      } finally {
        await stop.query("rollback");
        await attach.query("rollback");
        stop.release();
        attach.release();
      }

      const otherBlock = await createManualEntry({
        description: "Other workspace", startedAt: "2026-07-06T12:00:00Z", stoppedAt: "2026-07-06T12:15:00Z"
      }, other);
      const beforeBatch = await Promise.all([getCompletedEntryRevision(owner), getCompletedEntryRevision(other)]);
      await pool.query("update time_entries set description = 'Batch' where id in ($1,$2)", [second.id, otherBlock.id]);
      const afterBatch = await Promise.all([getCompletedEntryRevision(owner), getCompletedEntryRevision(other)]);
      expect(afterBatch[0]).not.toBe(beforeBatch[0]);
      expect(afterBatch[1]).not.toBe(beforeBatch[1]);
      expect((await pool.query("select 1 from dayframe_sync.pending_completed_entry_owners where user_id = $1", [userId])).rowCount).toBe(0);

      const editor = await pool.connect();
      const removal = await pool.connect();
      try {
        await editor.query("begin");
        await removal.query("begin");
        await editor.query("set local statement_timeout = '3s'");
        await removal.query("set local statement_timeout = '3s'");
        await editor.query("update time_entries set description = 'Finishing edit' where id = $1", [otherBlock.id]);
        await removal.query("delete from workspace_members where workspace_id = $1 and user_id = $2", [otherWorkspaceId, userId]);
        // Workspace removal needs the edited row. Finishing the edit must not wait on membership cleanup.
        await Promise.all([
          removal.query("delete from workspaces where id = $1", [otherWorkspaceId]).then(() => removal.query("commit")),
          editor.query("commit")
        ]);
      } finally {
        await editor.query("rollback");
        await removal.query("rollback");
        editor.release();
        removal.release();
      }
      expect(await getCompletedEntryRevision(other)).toBe("0");
    } finally {
      await pool.query("delete from workspaces where id in ($1,$2)", [workspaceId, otherWorkspaceId]);
      await pool.query("delete from users where id = $1", [userId]);
    }
    expect(await getCompletedEntryRevision(owner)).toBe("0");
  });

  it("refuses a switch after another device replaces its outgoing block", async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const session = { authMode: "provider" as const, scopes: ["app:write", "events:write"], userId, workspaceId };
    const start = (minutesAgo: number, description: string, expectedRunningEntryId?: string) =>
      processActivityEvent({
        source: "manual_app",
        type: "timer_start",
        occurredAt: new Date(Date.now() - minutesAgo * 60_000),
        rawPayload: { origin: "web_timer" },
        description
      }, session, { expectedRunningEntryId });

    try {
      await pool.query("insert into users (id, email, name) values ($1, $2, 'Switch test')", [userId, `switch-${userId}@example.invalid`]);
      await pool.query("insert into workspaces (id, name) values ($1, 'Switch test')", [workspaceId]);
      await pool.query("insert into workspace_members (workspace_id, user_id) values ($1, $2)", [workspaceId, userId]);

      const original = await start(5, "Original block");
      const replacement = await start(3, "Block from another device");
      expect(original.timeEntryId).toBeDefined();
      await expect(start(2, "Stale selection", original.timeEntryId)).rejects.toMatchObject({
        code: "timer_switch_conflict",
        status: 409
      });

      const stored = await pool.query(
        `select description, stopped_at is null as running from time_entries
         where workspace_id = $1 and user_id = $2 order by started_at`,
        [workspaceId, userId]
      );
      expect(stored.rows).toEqual([
        { description: "Original block", running: false },
        { description: "Block from another device", running: true }
      ]);
      const events = await pool.query(
        "select count(*)::int as count from activity_events where workspace_id = $1 and user_id = $2",
        [workspaceId, userId]
      );
      expect(events.rows[0]?.count).toBe(2);
      expect(replacement.timeEntryId).toBeDefined();
      expect((await start(1, "Intentional switch", replacement.timeEntryId)).timeEntryId).toBeDefined();
    } finally {
      await pool.query("delete from workspaces where id = $1", [workspaceId]);
      await pool.query("delete from users where id = $1", [userId]);
    }
  });

  it("uses another connection and bypasses a held per-user advisory lock", async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const entryId = randomUUID();
    const clientEventId = `mobile-timer-stop:${randomUUID()}`;
    const email = `dayframe-contention-${userId}@example.invalid`;
    const lockClient = await pool.connect();
    const session = {
      authMode: "provider" as const,
      scopes: ["app:read", "app:write", "events:write"],
      userId,
      workspaceId
    };

    try {
      await lockClient.query(
        `insert into users (id, email, name) values ($1, $2, 'Contention test')`,
        [userId, email]
      );
      await lockClient.query(
        `insert into workspaces (id, name) values ($1, 'Contention test')`,
        [workspaceId]
      );
      await lockClient.query(
        `insert into workspace_members (workspace_id, user_id) values ($1, $2)`,
        [workspaceId, userId]
      );
      await lockClient.query(
        `insert into time_entries (
           id, workspace_id, user_id, source, confidence, review_status,
           description, started_at
         ) values ($1, $2, $3, 'mobile_app', 'high', 'confirmed', 'Contention test', now() - interval '5 minutes')`,
        [entryId, workspaceId, userId]
      );
      await lockClient.query(
        "select pg_advisory_lock(hashtext($1), hashtext($2))",
        [workspaceId, userId]
      );

      const result = await withDeadline(
        processActivityEvent({
          clientEventId,
          occurredAt: new Date(),
          rawPayload: {
            origin: "mobile_timer_stop",
            stopScope: "entry",
            targetEntryId: entryId
          },
          source: "mobile_app",
          type: "timer_stop"
        }, session),
        1_500
      );

      expect(result).toMatchObject({ stopOutcome: "stopped", timeEntryId: entryId });
      const persisted = await lockClient.query<{
        eventCount: number;
        stoppedAt: Date | null;
      }>(
        `select te.stopped_at as "stoppedAt",
                (select count(*)::int from activity_events where client_event_id = $2) as "eventCount"
         from time_entries te
         where te.id = $1`,
        [entryId, clientEventId]
      );
      expect(persisted.rows[0]?.stoppedAt).toBeInstanceOf(Date);
      expect(persisted.rows[0]?.eventCount).toBe(1);
    } finally {
      await lockClient.query(
        "select pg_advisory_unlock(hashtext($1), hashtext($2))",
        [workspaceId, userId]
      ).catch(() => undefined);
      await lockClient.query("delete from workspaces where id = $1", [workspaceId])
        .catch(() => undefined);
      await lockClient.query("delete from users where id = $1", [userId])
        .catch(() => undefined);
      lockClient.release();
    }
  });
});

async function withDeadline<Result>(operation: Promise<Result>, milliseconds: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Entry-scoped Stop exceeded ${milliseconds}ms while the advisory lock was held.`)),
          milliseconds
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
