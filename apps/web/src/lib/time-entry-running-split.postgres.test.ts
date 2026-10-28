import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { RequestSession } from "./session";

// Run with DAYFRAME_TIME_ENTRY_SPLIT_TEST_DATABASE_URL pointing at a disposable local *_test database.
// Synthetic ids, names and times only. Split a running block (owner 28 Oct 2026), its Undo, and Stop after it.
const databaseUrl = process.env.DAYFRAME_TIME_ENTRY_SPLIT_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const workspaceId = "67000000-0000-4000-8000-000000000011";
const userId = "67000000-0000-4000-8000-000000000012";
const categoryId = "67000000-0000-4000-8000-000000000013";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read"] };
const MINUTE = 60_000;
// Minutes ago, on a whole minute so the halves read cleanly.
const ago = (minutes: number) => new Date(Math.floor(Date.now() / MINUTE) * MINUTE - minutes * MINUTE).toISOString();
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

type Row = { id: string; startedAt: Date; stoppedAt: Date | null; placeLabel: string | null; categoryId: string | null;
  description: string | null; source: string; tags: string[] };

async function blocks() {
  return (await database!.query<Row>(
    `select te.id, te.started_at as "startedAt", te.stopped_at as "stoppedAt", te.place_label as "placeLabel",
            te.category_id as "categoryId", te.description, te.source,
            coalesce((select array_agg(t.name order by t.name) from time_entry_tags tet join tags t on t.id = tet.tag_id
                      where tet.time_entry_id = te.id), array[]::text[]) as tags
       from time_entries te where te.workspace_id = $1 order by te.started_at`, [workspaceId])).rows;
}

async function version(id: string) {
  return (await database!.query<{ updatedAt: Date }>(`select updated_at as "updatedAt" from time_entries where id = $1`, [id])).rows[0].updatedAt.toISOString();
}

describeWithDatabase("Split a running block on disposable PostgreSQL", () => {
  let running = "";
  const startedAt = ago(90);

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Split integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = $1", [userId]);
    await database.query("insert into users (id, email, name) values ($1, 'running-split@example.test', 'R')", [userId]);
    await database.query("insert into workspaces (id, name) values ($1, 'Running split')", [workspaceId]);
    await database.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
    await database.query("insert into categories (id, workspace_id, name, color) values ($1, $2, 'Writing', 'blue')", [categoryId, workspaceId]);
    const { processActivityEvent } = await import("./event-service");
    const started = await processActivityEvent({
      source: "mobile_app", type: "timer_start", occurredAt: startedAt, categoryId, description: "Draft chapter",
      clientEventId: "mobile-start-running-split", rawPayload: { origin: "mobile_timer", startedAt, tagNames: ["deep"] }
    }, session);
    running = started.timeEntryId!;
    // A one-time place: a name and no saved place.
    await database.query("update time_entries set place_label = 'Exampleton Library' where id = $1", [running]);
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = $1", [userId]);
    await database.end();
    const { pool } = await import("./db");
    await pool.end();
  });

  it("refuses a time outside start to now, and a block changed since it was read", async () => {
    const { splitFinishedEntry, TimeEntryConflictError, TimeEntryValidationError } = await import("./event-service");
    await expect(splitFinishedEntry(running, { splitAt: startedAt }, session)).rejects.toBeInstanceOf(TimeEntryValidationError);
    await expect(splitFinishedEntry(running, { splitAt: ago(10), now: new Date(ago(10)) }, session)).rejects.toBeInstanceOf(TimeEntryValidationError);
    await expect(splitFinishedEntry(running, { splitAt: ago(30), expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, session))
      .rejects.toBeInstanceOf(TimeEntryConflictError);
    expect(await blocks()).toHaveLength(1);
  });

  it("ends the block at the time and keeps the second part running with every detail; a repeat is answered", async () => {
    const { splitFinishedEntry } = await import("./event-service");
    const first = await splitFinishedEntry(running, {
      splitAt: ago(30), expectedUpdatedAt: await version(running), clientCommandId: "mobile-split-1", source: "mobile_app"
    }, session);
    expect(first).toMatchObject({ id: running, replayed: false, running: true });
    const again = await splitFinishedEntry(running, { splitAt: ago(30), clientCommandId: "mobile-split-1", source: "mobile_app" }, session);
    expect(again).toEqual({ id: running, newEntryId: first.newEntryId, replayed: true });
    const shared = { placeLabel: "Exampleton Library", categoryId, description: "Draft chapter", source: "mobile_app", tags: ["deep"] };
    expect((await blocks()).map(({ id, ...rest }) => ({ ...rest, id: id === running ? "original" : id === first.newEntryId ? "new" : id }))).toEqual([
      { ...shared, id: "original", startedAt: new Date(startedAt), stoppedAt: new Date(ago(30)) },
      { ...shared, id: "new", startedAt: new Date(ago(30)), stoppedAt: null }
    ]);
    // The running part is a block the timer runs, from its own event.
    const event = await database!.query(
      `select e.event_type as "eventType", e.client_event_id as "clientEventId", e.raw_payload->>'serverTimerStart' as "timerStart",
              e.raw_payload->>'splitFrom' as "splitFrom"
       from time_entries te join activity_events e on e.id = te.created_from_event_id where te.id = $1`,
      [first.newEntryId]);
    expect(event.rows[0]).toEqual({ eventType: "timer_switch", clientEventId: "time_entry_split:mobile-split-1", timerStart: "true", splitFrom: running });
  });

  it("Undo puts it back as one running block, once, however often it is sent", async () => {
    const { joinSplitEntries, TimeEntryNotFoundError } = await import("./event-service");
    const second = (await blocks())[1].id;
    expect(await joinSplitEntries(running, { splitEntryId: second, clientCommandId: "mobile-join-1" }, session))
      .toEqual({ id: running, replayed: false, running: true });
    expect(await joinSplitEntries(running, { splitEntryId: second, clientCommandId: "mobile-join-1" }, session))
      .toEqual({ id: running, replayed: true });
    await expect(joinSplitEntries(running, { splitEntryId: second, clientCommandId: "mobile-join-other" }, session))
      .rejects.toBeInstanceOf(TimeEntryNotFoundError);
    expect(await blocks()).toEqual([expect.objectContaining({ id: running, startedAt: new Date(startedAt), stoppedAt: null, tags: ["deep"] })]);
  });

  it("refuses to join blocks a split did not make", async () => {
    const { createManualEntry, joinSplitEntries, TimeEntryValidationError } = await import("./event-service");
    const other = await createManualEntry({ categoryId, description: "Elsewhere", startedAt: ago(200), stoppedAt: ago(150) }, session);
    await expect(joinSplitEntries(running, { splitEntryId: other.id }, session)).rejects.toBeInstanceOf(TimeEntryValidationError);
    await database!.query("delete from time_entries where id = $1", [other.id]);
  });

  it("Stop after a split stops the running second part, never the finished first", async () => {
    const { processActivityEvent, splitFinishedEntry } = await import("./event-service");
    const split = await splitFinishedEntry(running, { splitAt: ago(20), clientCommandId: "mobile-split-2", source: "mobile_app" }, session);
    const stoppedAt = ago(5);
    const stop = await processActivityEvent({
      source: "mobile_app", type: "timer_stop", occurredAt: stoppedAt, clientEventId: "mobile-stop-after-split",
      rawPayload: { origin: "mobile_timer_stop", stopScope: "entry", targetEntryId: split.newEntryId }
    }, session);
    expect(stop.timeEntryId).toBe(split.newEntryId);
    const rows = await blocks();
    expect(rows.map((row) => [row.startedAt.toISOString(), row.stoppedAt?.toISOString() ?? null])).toEqual([
      [startedAt, ago(20)],
      [ago(20), stoppedAt]
    ]);
    // Undo of a split whose second part has since stopped: one finished block to that stop.
    const { joinSplitEntries } = await import("./event-service");
    expect(await joinSplitEntries(running, { splitEntryId: split.newEntryId }, session)).toMatchObject({ running: false });
    expect((await blocks()).map((row) => [row.id, row.stoppedAt?.toISOString()])).toEqual([[running, stoppedAt]]);
  });
});
