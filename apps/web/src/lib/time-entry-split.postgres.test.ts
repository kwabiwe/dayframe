import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { RequestSession } from "./session";

// Run with DAYFRAME_TIME_ENTRY_SPLIT_TEST_DATABASE_URL pointing at a disposable local *_test database.
// Synthetic ids, names and times only. Card G: Split and Duplicate a finished block.
const databaseUrl = process.env.DAYFRAME_TIME_ENTRY_SPLIT_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const workspaceId = "67000000-0000-4000-8000-000000000001";
const userId = "67000000-0000-4000-8000-000000000002";
const categoryId = "67000000-0000-4000-8000-000000000003";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read"] };
const at = (minutes: number) => new Date(Date.parse("2026-03-02T09:00:00.000Z") + minutes * 60_000).toISOString();
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

type Row = { id: string; startedAt: Date; stoppedAt: Date; placeId: string | null; placeLabel: string | null; categoryId: string | null;
  description: string | null; source: string; tags: string[] };

async function blocks() {
  return (await database!.query<Row>(
    `select te.id, te.started_at as "startedAt", te.stopped_at as "stoppedAt", te.place_id as "placeId", te.place_label as "placeLabel",
            te.category_id as "categoryId", te.description, te.source,
            coalesce((select array_agg(t.name order by t.name) from time_entry_tags tet join tags t on t.id = tet.tag_id
                      where tet.time_entry_id = te.id), array[]::text[]) as tags
       from time_entries te where te.workspace_id = $1 order by te.started_at`, [workspaceId])).rows;
}

describeWithDatabase("Split and Duplicate a finished block on disposable PostgreSQL (card G)", () => {
  let original = "";

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Split integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = $1", [userId]);
    await database.query("insert into users (id, email, name) values ($1, 'split@example.test', 'S')", [userId]);
    await database.query("insert into workspaces (id, name) values ($1, 'Split')", [workspaceId]);
    await database.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
    await database.query("insert into categories (id, workspace_id, name, color) values ($1, $2, 'Reading', 'blue')", [categoryId, workspaceId]);
    const { createManualEntry } = await import("./event-service");
    original = (await createManualEntry({ categoryId, description: "Chapter four", startedAt: at(0), stoppedAt: at(90), tagNames: ["deep"] }, session)).id;
    // A one-time place: a name and no saved place.
    await database.query("update time_entries set place_label = 'Exampleton Library' where id = $1", [original]);
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = $1", [userId]);
    await database.end();
    const { pool } = await import("./db");
    await pool.end();
  });

  it("refuses a block changed since it was read, and a time outside it", async () => {
    const { splitFinishedEntry, TimeEntryConflictError, TimeEntryValidationError } = await import("./event-service");
    await expect(splitFinishedEntry(original, { splitAt: at(30), expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }, session))
      .rejects.toBeInstanceOf(TimeEntryConflictError);
    await expect(splitFinishedEntry(original, { splitAt: at(90) }, session)).rejects.toBeInstanceOf(TimeEntryValidationError);
    expect(await blocks()).toHaveLength(1);
  });

  it("splits in one go: the block ends at the time, a manual block with every detail starts there; a repeat is answered", async () => {
    const { splitFinishedEntry } = await import("./event-service");
    const version = (await database!.query<{ updatedAt: Date }>(`select updated_at as "updatedAt" from time_entries where id = $1`, [original])).rows[0];
    const first = await splitFinishedEntry(original, { splitAt: at(30), expectedUpdatedAt: version.updatedAt.toISOString(), clientCommandId: "web-split-1" }, session);
    const again = await splitFinishedEntry(original, { splitAt: at(30), clientCommandId: "web-split-1" }, session);
    expect(again).toEqual({ id: original, newEntryId: first.newEntryId, replayed: true });
    expect((await blocks()).map(({ id, ...rest }) => ({ ...rest, original: id === original }))).toEqual([
      { startedAt: new Date(at(0)), stoppedAt: new Date(at(30)), placeId: null, placeLabel: "Exampleton Library", categoryId,
        description: "Chapter four", source: "manual_app", tags: ["deep"], original: true },
      { startedAt: new Date(at(30)), stoppedAt: new Date(at(90)), placeId: null, placeLabel: "Exampleton Library", categoryId,
        description: "Chapter four", source: "manual_app", tags: ["deep"], original: false }
    ]);
    // The original's new end is one the person set, and the new block came from its own event.
    const audit = await database!.query(`select action from audit_log where entity_id = $1 and workspace_id = $2`, [original, workspaceId]);
    expect(audit.rows.map((row) => row.action)).toContain("time_entry.end_set");
    const event = await database!.query(
      `select e.event_type as "eventType", e.client_event_id as "clientEventId" from time_entries te join activity_events e on e.id = te.created_from_event_id where te.id = $1`,
      [first.newEntryId]);
    expect(event.rows[0]).toEqual({ eventType: "timer_start", clientEventId: "time_entry_split:web-split-1" });
  });

  it("duplicates right after it with every detail, never into the future", async () => {
    const { duplicateFinishedEntry, TimeEntryValidationError } = await import("./event-service");
    const copy = await duplicateFinishedEntry(original, { clientCommandId: "web-duplicate-1" }, session);
    expect(await duplicateFinishedEntry(original, { clientCommandId: "web-duplicate-1" }, session)).toMatchObject({ newEntryId: copy.newEntryId, replayed: true });
    const made = (await blocks()).find((row) => row.id === copy.newEntryId)!;
    expect(made).toMatchObject({ startedAt: new Date(at(30)), stoppedAt: new Date(at(60)), placeLabel: "Exampleton Library", tags: ["deep"] });
    await expect(duplicateFinishedEntry(original, { now: new Date(at(50)) }, session)).rejects.toBeInstanceOf(TimeEntryValidationError);
  });
});
