import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./db";
import { processActivityEvent } from "./event-service";

const runDatabaseIntegration = process.env.DAYFRAME_RUN_DB_INTEGRATION === "1";

describe.runIf(runDatabaseIntegration)("entry-scoped Stop Postgres contention", () => {
  afterAll(async () => {
    await pool.end();
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
