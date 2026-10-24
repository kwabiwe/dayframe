import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Location v4 step 18 against a disposable local database: synthetic ids and times only (Codex r1 on #569).
const databaseUrl = process.env.DAYFRAME_REPORT_LOCATION_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
const workspaceId = "18000000-0000-4000-8000-000000000001";
const userId = "18000000-0000-4000-8000-000000000002";
const session = { workspaceId, userId } as never;
const travel = "18000000-0000-4000-8000-000000000003";
let database: pg.Pool | undefined;

describeWithDatabase("Reports location lines on disposable PostgreSQL (location v4 step 18)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Report location integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    const db = database;
    await db.query("delete from workspaces where id = $1", [workspaceId]);
    await db.query("delete from users where id = $1", [userId]);
    await db.query("insert into users (id, email, name) values ($1, 'reports-location@example.test', 'R')", [userId]);
    await db.query("insert into workspaces (id, name) values ($1, 'Reports location')", [workspaceId]);
    await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
    await db.query("insert into categories (id, workspace_id, name, color, starter_key) values ($1, $2, 'Getting around', 'slate', 'travel')", [travel, workspaceId]);
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = $1", [userId]);
    await database.end();
    const { pool } = await import("./db");
    await pool.end();
  });

  const stay = async (segment: string, device: string, start: string, stop: string | null) => (await database!.query<{ id: string }>(
    `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, status, started_at, stopped_at, centre, metadata)
     values ($1, $2, $3, $4, 'finalised', $5, $6, ST_SetSRID(ST_MakePoint(0, 0), 4326)::geography, '{"placeMatchKind":"unknown"}'::jsonb)
     returning id`, [workspaceId, userId, segment, device, start, stop])).rows[0].id;

  it("picks a block's trip the same way whichever device's copy comes first", async () => {
    const db = database!;
    // Two devices recorded a trip under one client segment id; the one overlapping the block most is its trip.
    const trip = async (device: string, start: string, stop: string, mode: string) => {
      const from = await stay(`zz-${device}-from`, device, "2026-10-21T06:00:00Z", start);
      const to = await stay(`zz-${device}-to`, device, stop, "2026-10-21T12:00:00Z");
      await db.query(
        `insert into commute_segments (workspace_id, user_id, device_id, client_segment_id, algorithm_version, status, started_at, stopped_at,
           from_stay_segment_id, to_stay_segment_id, confidence, metadata)
         values ($1, $2, $3, 'zz-shared-trip', 'location-v2.0', 'finalised', $4, $5, $6, $7, 'high', $8::jsonb)`,
        [workspaceId, userId, device, start, stop, from, to, JSON.stringify({ legs: [{ startedAt: start, stoppedAt: stop, mode }] })]);
    };
    await trip("device-b", "2026-10-21T08:30:00Z", "2026-10-21T09:30:00Z", "train");
    await trip("device-a", "2026-10-21T08:00:00Z", "2026-10-21T09:00:00Z", "walking");
    const event = (await db.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
       values ($1, $2, 'location_learning', 'commute_detected', '2026-10-21T08:00:00Z', 'high', '{"clientSegmentId":"zz-shared-trip"}'::jsonb) returning id`,
      [workspaceId, userId])).rows[0].id;
    const entry = (await db.query<{ id: string }>(
      `insert into time_entries (workspace_id, user_id, source, category_id, started_at, stopped_at, created_from_event_id)
       values ($1, $2, 'location_learning', $3, '2026-10-21T08:00:00Z', '2026-10-21T09:00:00Z', $4) returning id`,
      [workspaceId, userId, travel, event])).rows[0].id;
    const { getGettingAround } = await import("./report-service");
    const range = { start: "2026-10-21T00:00:00.000Z", end: "2026-10-22T00:00:00.000Z" };
    const summary = await getGettingAround(session, [{ id: entry, categoryId: travel }], range, "2026-10-21T12:00:00.000Z");
    expect(summary).toEqual({ tripCount: 1, totalSeconds: 3_600, byMode: [{ mode: "walking", seconds: 3_600 }], stopsSeconds: 0 });
  });

  it("counts unnamed places that started more than 31 days before the range, open or long, as Calendar reads them", async () => {
    // Open since 40 days before the range, and a 45-day stay ending in it.
    await stay("zz-open-old", "device-a", "2026-09-11T10:00:00Z", null);
    await stay("zz-long-old", "device-a", "2026-09-06T10:00:00Z", "2026-10-21T02:00:00Z");
    const { getNotLogged } = await import("./report-service");
    const range = { start: "2026-10-21T00:00:00.000Z", end: "2026-10-22T00:00:00.000Z" };
    const result = await getNotLogged(session, range, "2026-10-21T04:00:00.000Z");
    // The open one from midnight to now (4h) and the long one from midnight to 02:00 (2h); the first test's
    // stays start at 06:00, after now.
    expect(result.seconds).toBe(6 * 3_600);
    expect(result.latestStartedAt).toBe("2026-10-21T00:00:00.000Z");
  });
});
