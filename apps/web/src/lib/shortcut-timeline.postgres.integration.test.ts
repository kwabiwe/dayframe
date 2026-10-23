import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { pool } from "./db";
import {
  createManualEntry,
  processActivityEvent,
  TimerReplacementWindowError,
  TimerStopBeforeStartError,
  updateTimeEntry,
  updateTimeEntryDescriptions
} from "./event-service";

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

  // A timer block, created from its Start event as the server creates one (only a block a timer started
  // can be ended by a later Stop or Start, stability audit server-1); a Health block has no Start.
  async function block(startMinute: number, stopMinute: number | null, source = "mobile_app", description = "Block") {
    const id = randomUUID();
    const health = source === "health_sleep" || source === "health_workout";
    const startEvent = health ? null : await pool.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
       values ($1, $2, $3, 'timer_start', $4, 'high', '{"origin":"test_timer"}'::jsonb) returning id`,
      [workspaceId, userId, source, at(startMinute)]
    );
    await pool.query(
      `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at, stopped_at, created_from_event_id)
       values ($1, $2, $3, $4, 'high', 'confirmed', $5, $6, $7, $8)`,
      [id, workspaceId, userId, source, description, at(startMinute), stopMinute === null ? null : at(stopMinute),
        startEvent?.rows[0].id ?? null]
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

  function appStart(minute: number, description: string) {
    return processActivityEvent({
      clientEventId: `mobile:${randomUUID()}`,
      occurredAt: at(minute),
      rawPayload: { origin: "mobile_timer_start", startedAt: at(minute).toISOString(), tagNames: [] },
      description,
      source: "mobile_app",
      type: "timer_start"
    }, session);
  }

  function appStop(minute: number, targetEntryId?: string) {
    return processActivityEvent({
      clientEventId: `mobile:${randomUUID()}`,
      occurredAt: at(minute),
      rawPayload: targetEntryId ? { origin: "mobile_home", stopScope: "entry", targetEntryId } : { origin: "mobile_home" },
      source: "mobile_app",
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

  it("closes a Start delivered before its Stop when a later block already bounded it (Codex r6 on #403)", async () => {
    await block(30, null, "mobile_app", "Q");
    await expect(shortcutStart(10, "A")).resolves.toMatchObject({ startOutcome: "recorded_completed" });
    await expect(shortcutStop(20)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["A", 10, 20], ["Q", 30, null]]);
  });

  it("gives the same timeline for every arrival order of two Start and Stop pairs", async () => {
    const events: Array<() => Promise<unknown>> = [
      () => shortcutStart(10, "A"),
      () => shortcutStop(20),
      () => shortcutStart(30, "B"),
      () => shortcutStop(40),
    ];
    const orders = permutations([0, 1, 2, 3]);
    expect(orders).toHaveLength(24);
    for (const order of orders) {
      await pool.query("delete from time_entries where workspace_id = $1", [workspaceId]);
      await pool.query("delete from activity_events where workspace_id = $1", [workspaceId]);
      await block(0, null, "mobile_app", "P");
      for (const index of order) await events[index]();
      expect({ order, timeline: await timeline() }).toEqual({
        order,
        timeline: [["P", 0, 10], ["A", 10, 20], ["B", 30, 40]],
      });
    }
  }, 30_000);

  it("ends a finished block at an earlier Stop that arrives after it", async () => {
    await block(0, 30, "mobile_app", "P");
    await expect(shortcutStop(20)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["P", 0, 20]]);
  });

  it("records a Start at the same moment as an existing block without a second block", async () => {
    await block(10, null, "mobile_app", "P");
    await expect(shortcutStart(10, "A")).resolves.toMatchObject({ startOutcome: "superseded" });
    expect(await timeline()).toEqual([["P", 10, null]]);
  });

  it("runs a Start that arrives on time even when the phone's clock is a little behind a Stop just recorded", async () => {
    const now = Date.now();
    const id = randomUUID();
    await pool.query(
      `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at)
       values ($1, $2, $3, 'mobile_app', 'high', 'confirmed', 'P', $4)`,
      [id, workspaceId, userId, new Date(now - 60_000)]
    );
    await processActivityEvent({
      clientEventId: `web:${randomUUID()}`,
      occurredAt: new Date(now - 1_000),
      rawPayload: { origin: "web_timer_stop", stopScope: "entry", targetEntryId: id },
      source: "manual_app",
      type: "timer_stop"
    }, session);
    const result = await processActivityEvent({
      clientEventId: `shortcut:${randomUUID()}`,
      occurredAt: new Date(now - 3_000),
      rawPayload: { origin: "ios_app_shortcut" },
      description: "A",
      source: "shortcut",
      type: "shortcut_action"
    }, session);
    expect(result.startOutcome).toBeUndefined();
    const running = await pool.query(
      `select description from time_entries where workspace_id = $1 and stopped_at is null`, [workspaceId]
    );
    expect(running.rows).toEqual([{ description: "A" }]);
  });

  // Owner decision 22 Oct 2026 (PR A option a): a Start made in the iPhone app that reaches the server
  // late is placed like a Shortcut Start; it used to fail on every retry (stability audit SERVER-1).
  it("places an in-app Start older than a block started elsewhere in its own slot", async () => {
    await block(20, null, "web", "W");
    const result = await appStart(10, "Y");
    expect(result).toMatchObject({ startOutcome: "recorded_completed" });
    expect(typeof result.timeEntryId).toBe("string");
    expect(await timeline()).toEqual([["Y", 10, 20], ["W", 20, null]]);
  });

  it("an in-app Start newer than the running block still replaces it", async () => {
    await block(0, null, "web", "P");
    const result = await appStart(10, "Y");
    expect(result.startOutcome).toBeUndefined();
    expect(await timeline()).toEqual([["P", 0, 10], ["Y", 10, null]]);
  });

  it("refuses an in-app Start at a running block's own start with a typed error, never a silent drop", async () => {
    await block(10, null, "web", "W");
    await expect(appStart(10, "Y")).rejects.toBeInstanceOf(TimerReplacementWindowError);
    expect(await timeline()).toEqual([["W", 10, null]]);
  });

  it("refuses a Stop earlier than its block's start instead of failing the database rule", async () => {
    const running = await block(20, null, "web", "W");
    await expect(appStop(10, running)).rejects.toBeInstanceOf(TimerStopBeforeStartError);
    await expect(appStop(10)).rejects.toBeInstanceOf(TimerStopBeforeStartError);
    expect(await timeline()).toEqual([["W", 20, null]]);
    await expect(appStop(30, running)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["W", 20, 30]]);
  });

  it("ends a late-placed in-app Start where its own queued Stop ran, never touching the newer block (Codex r1 on #531)", async () => {
    await block(20, null, "web", "W");
    const start = await appStart(0, "Y");
    expect(await timeline()).toEqual([["Y", 0, 20], ["W", 20, null]]);
    await expect(appStop(10, start.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["Y", 0, 10], ["W", 20, null]]);
  });

  it("ends a block a later Start replaced where its own earlier Stop ran (offline Start, Stop, Start)", async () => {
    const y = await appStart(0, "Y");
    await appStart(30, "Z");
    expect(await timeline()).toEqual([["Y", 0, 30], ["Z", 30, null]]);
    await expect(appStop(10, y.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["Y", 0, 10], ["Z", 30, null]]);
  });

  it("keeps an end a person set, even one equal to the next block's start (Codex r2 on #531)", async () => {
    const edited = await block(0, 15, "web", "E");
    await updateTimeEntry(edited, { stoppedAt: at(20).toISOString() }, session);
    await block(20, null, "web", "N");
    await expect(appStop(10, edited)).resolves.toMatchObject({ stopOutcome: "superseded" });
    expect(await timeline()).toEqual([["E", 0, 20], ["N", 20, null]]);
  });

  // Codex r3 on #531: a saved title, activity or tags is not an end a person chose.
  it("ends a block at its own earlier Stop after a person edited only its details", async () => {
    const y = await appStart(0, "Y");
    await updateTimeEntry(y.timeEntryId!, { description: "Y titled", tagNames: ["focus"] }, session);
    await appStart(20, "W");
    expect(await timeline()).toEqual([["Y titled", 0, 20], ["W", 20, null]]);
    await expect(appStop(10, y.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["Y titled", 0, 10], ["W", 20, null]]);
  });

  it("ends a block at its own earlier Stop after a details save that resent its unchanged times", async () => {
    const y = await appStart(0, "Y");
    await appStart(20, "W");
    await updateTimeEntry(y.timeEntryId!, {
      description: "Y titled", startedAt: at(0).toISOString(), stoppedAt: at(20).toISOString()
    }, session);
    await expect(appStop(10, y.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["Y titled", 0, 10], ["W", 20, null]]);
  });

  it("keeps an end a person set through an edit, also after a later details-only save", async () => {
    const y = await appStart(0, "Y");
    await appStart(30, "W");
    await updateTimeEntry(y.timeEntryId!, { stoppedAt: at(25).toISOString() }, session);
    await updateTimeEntry(y.timeEntryId!, { description: "Y titled" }, session);
    await expect(appStop(10, y.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "superseded" });
    expect(await timeline()).toEqual([["Y titled", 0, 25], ["W", 30, null]]);
  });

  // Codex r4 on #531: an edit made before edits were recorded has no audit row, and keeps its end.
  async function editedBeforeRecording(id: string) {
    await pool.query("update time_entries set user_edited_at = now() - interval '1 day' where id = $1", [id]);
  }

  it("keeps the end of a block edited before edits were recorded", async () => {
    const y = await appStart(0, "Y");
    await appStart(30, "W");
    await editedBeforeRecording(y.timeEntryId!);
    await expect(appStop(10, y.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "superseded" });
    expect(await timeline()).toEqual([["Y", 0, 30], ["W", 30, null]]);
  });

  it("keeps that legacy end through a later details-only edit, single or grouped", async () => {
    const y = await appStart(0, "Y");
    const w = await appStart(30, "W");
    await appStart(60, "V");
    await editedBeforeRecording(y.timeEntryId!);
    await editedBeforeRecording(w.timeEntryId!);
    await updateTimeEntry(y.timeEntryId!, { description: "Y titled" }, session);
    await updateTimeEntryDescriptions([w.timeEntryId!, y.timeEntryId!], "Both", session);
    await expect(appStop(10, y.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "superseded" });
    await expect(appStop(40, w.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "superseded" });
    expect(await timeline()).toEqual([["Both", 0, 30], ["Both", 30, 60], ["V", 60, null]]);
  });

  it("ends a block at its own earlier Stop after a grouped description save", async () => {
    const y = await appStart(0, "Y");
    const w = await appStart(30, "W");
    await appStart(60, "V");
    await updateTimeEntryDescriptions([y.timeEntryId!, w.timeEntryId!], "Both", session);
    await expect(appStop(10, y.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["Both", 0, 10], ["Both", 30, 60], ["V", 60, null]]);
  });

  it("records an end moved by less than a millisecond as one a person set", async () => {
    const y = await appStart(0, "Y");
    await appStart(30, "W");
    await pool.query("update time_entries set stopped_at = '2026-10-14T09:25:00.123100Z' where id = $1", [y.timeEntryId]);
    await updateTimeEntry(y.timeEntryId!, { stoppedAt: "2026-10-14T09:25:00.123900Z" }, session);
    await expect(appStop(10, y.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "superseded" });
    const end = await pool.query<{ end: string }>(
      "select to_char(stopped_at at time zone 'UTC', 'HH24:MI:SS.US') as end from time_entries where id = $1", [y.timeEntryId]
    );
    expect(end.rows[0]!.end).toBe("09:25:00.123900");
  });

  it("keeps an earlier end when a later Stop for the block arrives", async () => {
    const finished = await block(0, 15, "web", "E");
    await expect(appStop(30, finished)).resolves.toMatchObject({ stopOutcome: "superseded" });
    expect(await timeline()).toEqual([["E", 0, 15]]);
  });

  it("ends a late Start bounded by a recorded Stop where its own Stop ran (Codex r2 on #531)", async () => {
    await block(0, null, "mobile_app", "P");
    await shortcutStop(20);
    const y = await appStart(5, "Y");
    expect(await timeline()).toEqual([["P", 0, 5], ["Y", 5, 20]]);
    await expect(appStop(10, y.timeEntryId!)).resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["P", 0, 5], ["Y", 5, 10]]);
  });

  it("sees a replacement committed while the Stop waited for the block's lock (Codex r2 on #531)", async () => {
    const y = await block(0, null, "mobile_app", "Y");
    const replacer = await pool.connect();
    try {
      await replacer.query("begin");
      await replacer.query("update time_entries set stopped_at = $1 where id = $2", [at(20), y]);
      await replacer.query(
        `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at)
         values ($1, $2, $3, 'web', 'high', 'confirmed', 'Z', $4)`,
        [randomUUID(), workspaceId, userId, at(20)]
      );
      const replacerPid = (await replacer.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      const stop = appStop(10, y);
      for (let tries = 0; tries < 200; tries += 1) {
        const waiting = await pool.query(
          "select 1 from pg_stat_activity where wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(pid))",
          [replacerPid]
        );
        if (waiting.rows.length) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await replacer.query("commit");
      await expect(stop).resolves.toMatchObject({ stopOutcome: "stopped" });
    } finally {
      replacer.release();
    }
    expect(await timeline()).toEqual([["Y", 0, 10], ["Z", 20, null]]);
  });

  // Codex r4 on #531: a PATCH holds its transaction (the same writes updateTimeEntry makes) until the
  // entry-scoped Stop waits on the row, then commits. The Stop must judge the end by that edit's audit row.
  async function stopWhileEditHeld(entryId: string, stopMinute: number, endMinute: number | null, action: string) {
    const editor = await pool.connect();
    try {
      await editor.query("begin");
      await editor.query(
        `update time_entries set stopped_at = coalesce($1, stopped_at), user_edited_at = now(), updated_at = now()
         where id = $2`,
        [endMinute === null ? null : at(endMinute), entryId]
      );
      await editor.query(
        `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata, created_at)
         select workspace_id, user_id, $2, 'time_entry', id,
                case when $2 = 'time_entry.end_set' then jsonb_build_object('stoppedAt', stopped_at) else '{}'::jsonb end,
                user_edited_at
         from time_entries where id = $1`,
        [entryId, action]
      );
      const editorPid = (await editor.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      const stop = appStop(stopMinute, entryId);
      for (let tries = 0; tries < 200; tries += 1) {
        const waiting = await pool.query(
          "select 1 from pg_stat_activity where wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(pid))",
          [editorPid]
        );
        if (waiting.rows.length) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await editor.query("commit");
      return await stop;
    } finally {
      editor.release();
    }
  }

  it("keeps an end a person set while the Stop waited for the block's lock (Codex r4 on #531)", async () => {
    const y = await appStart(0, "Y");
    await appStart(30, "W");
    await expect(stopWhileEditHeld(y.timeEntryId!, 10, 25, "time_entry.end_set"))
      .resolves.toMatchObject({ stopOutcome: "superseded" });
    expect(await timeline()).toEqual([["Y", 0, 25], ["W", 30, null]]);
  });

  it("pulls back an end after a details edit committed while the Stop waited (Codex r4 on #531)", async () => {
    const y = await appStart(0, "Y");
    await appStart(30, "W");
    await expect(stopWhileEditHeld(y.timeEntryId!, 10, null, "time_entry.edited"))
      .resolves.toMatchObject({ stopOutcome: "stopped" });
    expect(await timeline()).toEqual([["Y", 0, 10], ["W", 30, null]]);
  });

  // Codex r3 on #531: a block another client stopped a second ago bounds an in-app Start only once the
  // Start is more than ten seconds old, so a phone clock a little behind never finishes a fresh Start.
  async function stoppedElsewhereJustNow(now: number) {
    const id = randomUUID();
    await pool.query(
      `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at)
       values ($1, $2, $3, 'manual_app', 'high', 'confirmed', 'P', $4)`,
      [id, workspaceId, userId, new Date(now - 30 * 60_000)]
    );
    await expect(processActivityEvent({
      clientEventId: `web:${randomUUID()}`, occurredAt: new Date(now - 1_000),
      rawPayload: { origin: "web_timer_stop", stopScope: "entry", targetEntryId: id },
      source: "manual_app", type: "timer_stop"
    }, session)).resolves.toMatchObject({ stopOutcome: "stopped" });
  }

  function appStartAt(startedAt: Date) {
    return processActivityEvent({
      clientEventId: `mobile:${randomUUID()}`, occurredAt: startedAt, description: "Y", source: "mobile_app", type: "timer_start",
      rawPayload: { origin: "mobile_timer_start", startedAt: startedAt.toISOString(), tagNames: [] }
    }, session);
  }

  async function runningDescriptions() {
    return (await pool.query<{ description: string }>(
      "select description from time_entries where workspace_id = $1 and stopped_at is null", [workspaceId]
    )).rows.map((row) => row.description);
  }

  it("an in-app Start delivered within ten seconds runs even just before a Stop recorded elsewhere", async () => {
    const now = Date.now();
    await stoppedElsewhereJustNow(now);
    const result = await appStartAt(new Date(now - 4_000));
    expect(result.startOutcome).toBeUndefined();
    expect(await runningDescriptions()).toEqual(["Y"]);
  });

  it("an in-app Start more than ten seconds old ends at a Stop recorded elsewhere after it", async () => {
    const now = Date.now();
    await stoppedElsewhereJustNow(now);
    const startedAt = new Date(now - 20_000);
    const result = await appStartAt(startedAt);
    expect(result.startOutcome).toBe("recorded_completed");
    expect(await runningDescriptions()).toEqual([]);
    const y = (await pool.query<{ startedAt: Date; stoppedAt: Date }>(
      `select started_at as "startedAt", stopped_at as "stoppedAt" from time_entries where id = $1`, [result.timeEntryId]
    )).rows[0]!;
    expect([y.startedAt.getTime(), y.stoppedAt.getTime()]).toEqual([startedAt.getTime(), now - 1_000]);
  });

  it("refuses an in-app Start at another block's exact start even when a later bound exists (Codex r1 on #531)", async () => {
    await block(10, null, "web", "W");
    await block(30, 40, "web", "L");
    await expect(appStart(10, "Y")).rejects.toBeInstanceOf(TimerReplacementWindowError);
    expect(await timeline()).toEqual([["W", 10, null], ["L", 30, 40]]);
  });

  it("checks an unscoped Stop against a start edited while it waited for the block (Codex r1 on #531)", async () => {
    const running = await block(0, null, "web", "W");
    const editor = await pool.connect();
    try {
      await editor.query("begin");
      await editor.query("update time_entries set started_at = $1 where id = $2", [at(20), running]);
      const editorPid = (await editor.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      const stop = appStop(10);
      // Commit only once the Stop is waiting on the edited row, so it has already passed (or is
      // holding) its check: deterministic whatever the machine's speed.
      for (let tries = 0; tries < 200; tries += 1) {
        const waiting = await pool.query(
          "select 1 from pg_stat_activity where wait_event_type = 'Lock' and $1 = any(pg_blocking_pids(pid))",
          [editorPid]
        );
        if (waiting.rows.length) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await editor.query("commit");
      await expect(stop).rejects.toBeInstanceOf(TimerStopBeforeStartError);
    } finally {
      editor.release();
    }
    expect(await timeline()).toEqual([["W", 20, null]]);
  });

  it("repeats a late-placed in-app Start's outcome when it is delivered again", async () => {
    await block(20, null, "web", "W");
    const clientEventId = `mobile:${randomUUID()}`;
    const deliver = () => processActivityEvent({
      clientEventId, occurredAt: at(10), description: "Y", source: "mobile_app", type: "timer_start",
      rawPayload: { origin: "mobile_timer_start", startedAt: at(10).toISOString(), tagNames: [] }
    }, session);
    const first = await deliver();
    const again = await deliver();
    expect(again).toMatchObject({ startOutcome: "recorded_completed", timeEntryId: first.timeEntryId });
  });

  it("never stops a running Health entry", async () => {
    await block(0, null, "health_workout", "Workout");
    await expect(shortcutStop(10)).resolves.toMatchObject({ stopOutcome: "superseded" });
    expect(await timeline()).toEqual([["Workout", 0, null]]);
  });

  it("closes a recent Start delivered seconds after its Stop (Codex r7 on #403)", async () => {
    const now = Date.now();
    const id = randomUUID();
    await pool.query(
      `insert into time_entries (id, workspace_id, user_id, source, confidence, review_status, description, started_at)
       values ($1, $2, $3, 'mobile_app', 'high', 'confirmed', 'P', $4)`,
      [id, workspaceId, userId, new Date(now - 60_000)]
    );
    const startedAt = new Date(now - 4_000);
    await processActivityEvent({
      clientEventId: `shortcut:${randomUUID()}`, occurredAt: new Date(now - 2_000),
      rawPayload: { origin: "ios_app_shortcut", stopScope: "running_at" }, source: "shortcut", type: "timer_stop"
    }, session);
    const start = await processActivityEvent({
      clientEventId: `shortcut:${randomUUID()}`, occurredAt: startedAt,
      rawPayload: { origin: "ios_app_shortcut" }, description: "A", source: "shortcut", type: "shortcut_action"
    }, session);
    expect(start.startOutcome).toBe("recorded_completed");
    const running = await pool.query(`select 1 from time_entries where workspace_id = $1 and stopped_at is null`, [workspaceId]);
    expect(running.rows).toHaveLength(0);
  });

  it("ignores a superseded exact-entry Stop as a bound for a later-placed Start (Codex r7 on #403)", async () => {
    const p = await block(0, 5, "mobile_app", "P");
    await block(40, null, "mobile_app", "Q");
    await expect(processActivityEvent({
      clientEventId: `live-activity:${randomUUID()}`, occurredAt: at(30),
      rawPayload: { origin: "ios_live_activity", stopScope: "entry", targetEntryId: p },
      source: "shortcut", type: "timer_stop"
    }, session)).resolves.toMatchObject({ stopOutcome: "superseded" });
    await shortcutStart(20, "A");
    expect(await timeline()).toEqual([["P", 0, 5], ["A", 20, 40], ["Q", 40, null]]);
  });

  it("uses an exact-entry Stop that ended a block as a bound", async () => {
    const p = await block(0, null, "mobile_app", "P");
    await expect(processActivityEvent({
      clientEventId: `web:${randomUUID()}`, occurredAt: at(30),
      rawPayload: { origin: "web_timer_stop", stopScope: "entry", targetEntryId: p },
      source: "manual_app", type: "timer_stop"
    }, session)).resolves.toMatchObject({ stopOutcome: "stopped" });
    await shortcutStart(10, "A");
    await shortcutStart(20, "B");
    expect(await timeline()).toEqual([["P", 0, 10], ["A", 10, 20], ["B", 20, 30]]);
  });

  it("repeats a Start's outcome when it is delivered again", async () => {
    await block(30, null, "mobile_app", "Q");
    const clientEventId = `shortcut:${randomUUID()}`;
    const input = {
      clientEventId, occurredAt: at(10), rawPayload: { origin: "ios_app_shortcut" },
      description: "A", source: "shortcut" as const, type: "shortcut_action" as const
    };
    await expect(processActivityEvent(input, session)).resolves.toMatchObject({ startOutcome: "recorded_completed" });
    await expect(processActivityEvent(input, session)).resolves.toMatchObject({ duplicate: true, startOutcome: "recorded_completed" });
  });

  it("refuses a client-supplied server Stop outcome", async () => {
    await shortcutStop(10);
    const forged = await processActivityEvent({
      clientEventId: `web:${randomUUID()}`, occurredAt: at(20),
      rawPayload: { origin: "web_timer_stop", serverStopOutcome: "stopped" }, source: "manual_app", type: "timer_stop"
    }, session);
    const stored = await pool.query(`select raw_payload->>'serverStopOutcome' as outcome from activity_events where id = $1`, [forged.eventId]);
    expect(stored.rows[0]?.outcome ?? null).toBeNull();
  });

  it("does not use a Stop of a Health entry as a bound (Codex r8 on #403)", async () => {
    const workout = await block(0, null, "health_workout", "Workout");
    await processActivityEvent({
      clientEventId: `web:${randomUUID()}`, occurredAt: at(30),
      rawPayload: { origin: "web_timer_stop", stopScope: "entry", targetEntryId: workout },
      source: "manual_app", type: "timer_stop"
    }, session);
    await block(40, null, "mobile_app", "Q");
    await shortcutStart(10, "A");
    expect(await timeline()).toEqual([["Workout", 0, 30], ["A", 10, 40], ["Q", 40, null]]);
  });

  it("leaves overlapping Health entries alone", async () => {
    await block(-60, 60, "health_sleep", "Sleep");
    await block(0, null, "mobile_app", "P");
    await shortcutStop(20);
    await shortcutStart(10, "A");
    expect(await timeline()).toEqual([["Sleep", -60, 60], ["P", 0, 10], ["A", 10, 20]]);
  });

  // Stability audit server-1: a Stop or Start that waited offline ends only blocks a timer ran, at an end
  // no person set. Manual entries, Review blocks and person-set ends keep their time.
  describe("blocks a timer did not end", () => {
    const manual = (start: number, stop: number, description: string) =>
      createManualEntry({ description, startedAt: at(start).toISOString(), stoppedAt: at(stop).toISOString() }, session);

    async function reviewBlock(start: number, stop: number, description: string) {
      const event = await pool.query<{ id: string }>(
        `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, review_status)
         values ($1, $2, 'geofence_specific', 'geofence_enter', $3, 'medium', 'confirmed') returning id`,
        [workspaceId, userId, at(start)]
      );
      await pool.query(
        `insert into time_entries (workspace_id, user_id, source, confidence, review_status, description, started_at, stopped_at, created_from_event_id)
         values ($1, $2, 'geofence_specific', 'medium', 'confirmed', $3, $4, $5, $6)`,
        [workspaceId, userId, description, at(start), at(stop), event.rows[0].id]
      );
    }

    function webStart(minute: number, description: string) {
      return processActivityEvent({
        occurredAt: at(minute),
        rawPayload: { origin: "web_timer", startedAt: at(minute).toISOString() },
        description,
        source: "manual_app",
        type: "timer_start"
      }, session);
    }

    it("a late Shortcut Stop leaves a manual entry whole", async () => {
      await manual(0, 120, "M");
      await expect(shortcutStop(60)).resolves.toMatchObject({ stopOutcome: "superseded" });
      expect(await timeline()).toEqual([["M", 0, 120]]);
    });

    it("a late Shortcut Stop leaves a Review-confirmed block whole", async () => {
      await reviewBlock(0, 120, "R");
      await expect(shortcutStop(60)).resolves.toMatchObject({ stopOutcome: "superseded" });
      expect(await timeline()).toEqual([["R", 0, 120]]);
    });

    it("a late Shortcut Stop keeps an end a person extended", async () => {
      const extended = await block(0, 30, "mobile_app", "P");
      await updateTimeEntry(extended, { stoppedAt: at(90).toISOString() }, session);
      await expect(shortcutStop(60)).resolves.toMatchObject({ stopOutcome: "superseded" });
      expect(await timeline()).toEqual([["P", 0, 90]]);
    });

    it("a late Shortcut Stop keeps a manual entry whose title and end a person edited", async () => {
      const entry = await manual(0, 100, "M");
      await updateTimeEntry(entry.id, { description: "M2", stoppedAt: at(120).toISOString() }, session);
      await shortcutStop(60);
      expect(await timeline()).toEqual([["M2", 0, 120]]);
    });

    it("a Shortcut Stop ends the running timer but not a manual entry overlapping it", async () => {
      await block(0, null, "mobile_app", "P");
      await manual(30, 50, "M");
      await expect(shortcutStop(40)).resolves.toMatchObject({ stopOutcome: "stopped" });
      expect(await timeline()).toEqual([["P", 0, 40], ["M", 30, 50]]);
    });

    it("a late Shortcut Start inside a manual entry is recorded beside it without cutting it", async () => {
      await manual(0, 120, "M");
      await expect(shortcutStart(60, "S")).resolves.toMatchObject({ startOutcome: "recorded_completed" });
      expect(await timeline()).toEqual([["M", 0, 120], ["S", 60, 120]]);
    });

    it("an entry-scoped Stop never pulls back a manual entry", async () => {
      const entry = await manual(0, 120, "M");
      await appStop(60, entry.id);
      expect(await timeline()).toEqual([["M", 0, 120]]);
    });

    it("still ends a finished web timer block at an earlier Shortcut Stop (PRD D20)", async () => {
      await webStart(0, "W");
      await webStart(30, "X");
      await expect(shortcutStop(20)).resolves.toMatchObject({ stopOutcome: "stopped" });
      expect(await timeline()).toEqual([["W", 0, 20], ["X", 30, null]]);
    });
  });
});

function permutations<Item>(items: Item[]): Item[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest])
  );
}
