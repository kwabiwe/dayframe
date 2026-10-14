import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "./db";
import { processActivityEvent } from "./event-service";

const runDatabaseIntegration = process.env.DAYFRAME_RUN_DB_INTEGRATION === "1";

// #403 (owner decision 14 Oct, option c): a Shortcut Stop stops what was running when it ran, and a
// Shortcut Start that reaches the server late fills its own slot instead of replacing a newer block.
describe.runIf(runDatabaseIntegration)("Shortcut Stops and late Shortcut Starts on Postgres", () => {
  let userId: string;
  let workspaceId: string;
  let session: {
    authMode: "provider";
    scopes: string[];
    userId: string;
    workspaceId: string;
  };
  const base = Date.parse("2026-10-14T09:00:00.000Z");
  const at = (minutes: number) => new Date(base + minutes * 60_000);

  beforeEach(async () => {
    userId = randomUUID();
    workspaceId = randomUUID();
    session = { authMode: "provider", scopes: ["app:read", "app:write", "events:write"], userId, workspaceId };
    await pool.query(`insert into users (id, email, name) values ($1, $2, 'Shortcut timeline test')`,
      [userId, `dayframe-shortcut-${userId}@example.invalid`]);
    await pool.query(`insert into workspaces (id, name) values ($1, 'Shortcut timeline test')`, [workspaceId]);
    await pool.query(`insert into workspace_members (workspace_id, user_id) values ($1, $2)`, [workspaceId, userId]);
  });

  afterEach(async () => {
    await pool.query("delete from workspaces where id = $1", [workspaceId]).catch(() => undefined);
    await pool.query("delete from users where id = $1", [userId]).catch(() => undefined);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function block(startMinute: number, stopMinute: number | null, source = "mobile_app", description = "Block") {
    const id = randomUUID();
    await pool.query(
      `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at, stopped_at)
       values ($1, $2, $3, $4, 'high', 'confirmed', $5, $6, $7)`,
      [id, workspaceId, userId, source, description, at(startMinute), stopMinute === null ? null : at(stopMinute)]
    );
    return id;
  }

  function shortcutStart(minute: number, description: string) {
    return processActivityEvent({
      clientEventId: `shortcut:${randomUUID()}`,
      occurredAt: at(minute),
      rawPayload: { origin: "ios_app_shortcut" },
      description,
      source: "shortcut",
      type: "shortcut_action"
    }, session);
  }

  function shortcutStop(minute: number) {
    return processActivityEvent({
      clientEventId: `shortcut:${randomUUID()}`,
      occurredAt: at(minute),
      rawPayload: { origin: "ios_app_shortcut", stopScope: "running_at" },
      source: "shortcut",
      type: "timer_stop"
    }, session);
  }

  async function timeline() {
    const result = await pool.query<{ description: string; startedAt: Date; stoppedAt: Date | null }>(
      `select description, started_at as "startedAt", stopped_at as "stoppedAt"
       from time_entries where workspace_id = $1 and user_id = $2 order by started_at`,
      [workspaceId, userId]
    );
    return result.rows.map((row) => [
      row.description,
      (row.startedAt.getTime() - base) / 60_000,
      row.stoppedAt ? (row.stoppedAt.getTime() - base) / 60_000 : null
    ]);
  }

  it("stops the block that was running when the Stop ran", async () => {
    await block(0, null, "mobile_app", "P");
    await expect(shortcutStop(10)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["P", 0, 10]]);
  });

  it("never stops a block that started after the Stop ran", async () => {
    await block(0, 5, "mobile_app", "P");
    await block(20, null, "mobile_app", "Q");
    await expect(shortcutStop(10)).resolves.toMatchObject({ stopOutcome: "superseded" });
    expect(await timeline()).toEqual([["P", 0, 5], ["Q", 20, null]]);
  });

  it("an on-time Start still replaces the running block", async () => {
    await block(0, null, "mobile_app", "P");
    const result = await shortcutStart(10, "A");
    expect(result.startOutcome).toBeUndefined();
    expect(await timeline()).toEqual([["P", 0, 10], ["A", 10, null]]);
  });

  it("a Start delivered after its Stop takes the time between them from the block it interrupted", async () => {
    await block(0, null, "mobile_app", "P");
    await shortcutStop(20);
    await expect(shortcutStart(10, "A")).resolves.toMatchObject({ startOutcome: "recorded_completed" });
    expect(await timeline()).toEqual([["P", 0, 10], ["A", 10, 20]]);
  });

  it("a Start older than the running block ends where that block starts instead of failing", async () => {
    await block(20, null, "mobile_app", "Q");
    await expect(shortcutStart(10, "A")).resolves.toMatchObject({ startOutcome: "recorded_completed" });
    expect(await timeline()).toEqual([["A", 10, 20], ["Q", 20, null]]);
  });

  it("pairs each late Start with the earliest Stop after it, whatever order they arrive in", async () => {
    await block(0, null, "mobile_app", "P");
    await shortcutStop(20);
    await expect(shortcutStop(40)).resolves.toMatchObject({ stopOutcome: "superseded" });
    await shortcutStart(30, "A2");
    await shortcutStart(10, "A1");
    expect(await timeline()).toEqual([["P", 0, 10], ["A1", 10, 20], ["A2", 30, 40]]);
  });

  it("leaves overlapping Health entries alone", async () => {
    await block(-60, 60, "health_sleep", "Sleep");
    await block(0, null, "mobile_app", "P");
    await shortcutStop(20);
    await shortcutStart(10, "A");
    expect(await timeline()).toEqual([["Sleep", -60, 60], ["P", 0, 10], ["A", 10, 20]]);
  });
});
