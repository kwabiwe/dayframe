import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "./db";
import { dispatchOverdueTimerReminder, keepOverdueTimerRunning } from "./forgotten-timer-reminders";

const databaseUrl = process.env.DATABASE_URL;
const disposable = databaseUrl && new URL(databaseUrl).hostname === "127.0.0.1" &&
  new URL(databaseUrl).pathname === "/dayframe_qa";
const owner = { workspaceId: randomUUID(), userId: randomUUID() };
const entries: string[] = [];

async function runningTimer(ageMinutes: number) {
  const id = randomUUID();
  entries.push(id);
  await pool.query(
    `insert into time_entries (id, workspace_id, user_id, source, started_at)
     values ($1, $2, $3, 'manual_app', statement_timestamp() - ($4::int * interval '1 minute'))`,
    [id, owner.workspaceId, owner.userId, ageMinutes]
  );
  return id;
}

describe.runIf(process.env.DAYFRAME_RUN_FORGOTTEN_TIMER_DB_TEST === "1" && Boolean(disposable))(
  "forgotten timer reminders on disposable PostGIS",
  () => {
    beforeAll(async () => {
      await pool.query("insert into workspaces (id, name) values ($1, 'Reminder fixture')", [owner.workspaceId]);
      await pool.query("insert into users (id, email, name) values ($1, $2, 'Reminder fixture')", [
        owner.userId, `reminder-qa-${owner.userId}@example.com`
      ]);
      await pool.query("insert into workspace_members (workspace_id, user_id) values ($1, $2)", [owner.workspaceId, owner.userId]);
    });
    afterAll(async () => {
      await pool.query("delete from workspaces where id = $1", [owner.workspaceId]);
      await pool.query("delete from users where id = $1", [owner.userId]);
    });
    afterEach(async () => {
      await pool.query("delete from time_entries where id = any($1::uuid[]) and workspace_id = $2 and user_id = $3", [
        entries.splice(0), owner.workspaceId, owner.userId
      ]);
    });

    it("does not claim under eight hours or for a different owner", async () => {
      const id = await runningTimer(479);
      const send = vi.fn(async () => "sent");
      await expect(dispatchOverdueTimerReminder(owner, id, send)).resolves.toBeNull();
      await pool.query("update time_entries set started_at = statement_timestamp() - interval '8 hours' where id = $1", [id]);
      await expect(dispatchOverdueTimerReminder({ ...owner, userId: randomUUID() }, id, send)).resolves.toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it("claims the eight-hour threshold once across concurrent workers", async () => {
      const id = await runningTimer(480);
      const send = vi.fn(async () => "sent");
      const results = await Promise.all(
        Array.from({ length: 8 }, () => dispatchOverdueTimerReminder(owner, id, send))
      );
      expect(results.filter((value) => value === "sent")).toHaveLength(1);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("suppresses a stopped block, its old reminder after Switch, and a durable Keep running", async () => {
      const old = await runningTimer(540);
      await pool.query("update time_entries set stopped_at = statement_timestamp() where id = $1", [old]);
      const current = await runningTimer(480);
      const send = vi.fn(async () => "sent");
      await expect(keepOverdueTimerRunning(owner, old)).resolves.toBe(false);
      await expect(keepOverdueTimerRunning(owner, current)).resolves.toBe(true);
      await expect(dispatchOverdueTimerReminder(owner, old, send)).resolves.toBeNull();
      await expect(dispatchOverdueTimerReminder(owner, current, send)).resolves.toBeNull();
      expect(send).not.toHaveBeenCalled();
      const active = await pool.query("select id from time_entries where id = $1 and stopped_at is null", [current]);
      expect(active.rowCount).toBe(1);
    });
  }
);
