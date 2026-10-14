import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "./db";
import { PreviousEndChangedError, processActivityEvent } from "./event-service";

const runDatabaseIntegration = process.env.DAYFRAME_RUN_DB_INTEGRATION === "1";

afterAll(async () => {
  if (runDatabaseIntegration) await pool.end();
});

describe.runIf(runDatabaseIntegration)("entry-scoped Stop Postgres contention", () => {
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

// PRD D16 (Codex r1 on #418): "start at the previous end" is refused when a block now ends after
// the requested start (added on another device), and accepted at the real latest end.
describe.runIf(runDatabaseIntegration)("start at the previous end, Postgres", () => {
  it("refuses an overlapping afterPreviousEnd Start and creates nothing, then accepts the real end", async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const client = await pool.connect();
    const session = {
      authMode: "provider" as const,
      scopes: ["app:read", "app:write", "events:write"],
      userId,
      workspaceId
    };
    const end = new Date(Date.now() - 30 * 60 * 1000);
    end.setMilliseconds(0);
    const offeredEnd = new Date(end.getTime() - 30 * 60 * 1000);
    const start = (startedAt: Date) => processActivityEvent({
      occurredAt: startedAt,
      rawPayload: { origin: "web_timer", startedAt: startedAt.toISOString(), afterPreviousEnd: true },
      source: "manual_app",
      type: "timer_start"
    }, session);
    try {
      await client.query(`insert into users (id, email, name) values ($1, $2, 'Previous end test')`, [userId, `dayframe-prev-end-${userId}@example.invalid`]);
      await client.query(`insert into workspaces (id, name) values ($1, 'Previous end test')`, [workspaceId]);
      await client.query(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [workspaceId, userId]);
      // Another device's block, ending after the end this tab offered.
      await client.query(
        `insert into time_entries (workspace_id, user_id, source, confidence, review_status, description, started_at, stopped_at)
         values ($1, $2, 'manual_app', 'high', 'confirmed', 'Other device', $3, $4)`,
        [workspaceId, userId, new Date(end.getTime() - 20 * 60 * 1000), end]
      );

      await expect(start(offeredEnd)).rejects.toBeInstanceOf(PreviousEndChangedError);
      const afterRefusal = await client.query<{ count: number }>(
        "select count(*)::int as count from time_entries where workspace_id = $1 and user_id = $2",
        [workspaceId, userId]
      );
      expect(afterRefusal.rows[0]?.count).toBe(1);

      const accepted = await start(end);
      expect(accepted.timeEntryId).toBeTruthy();
      const running = await client.query<{ startedAt: Date }>(
        `select started_at as "startedAt" from time_entries where id = $1 and stopped_at is null`,
        [accepted.timeEntryId]
      );
      expect(running.rows[0]?.startedAt.getTime()).toBe(end.getTime());

      // A block is running now: another afterPreviousEnd Start never replaces it.
      await expect(start(end)).rejects.toBeInstanceOf(PreviousEndChangedError);
    } finally {
      await client.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
      await client.query("delete from users where id = $1", [userId]).catch(() => undefined);
      client.release();
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
