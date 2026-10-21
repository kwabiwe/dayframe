import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { getLocationGroups } from "./location-groups";
import type { RequestSession } from "../session";

// Run with DAYFRAME_LOCATION_GROUPS_TEST_DATABASE_URL pointing at a disposable local *_test database
// (base or ordered schema). Synthetic ids and coordinates only.
const databaseUrl = process.env.DAYFRAME_LOCATION_GROUPS_TEST_DATABASE_URL;
const workspaceId = "63000000-0000-4000-8000-000000000001";
const userId = "63000000-0000-4000-8000-000000000002";
const otherUserId = "63000000-0000-4000-8000-000000000003";
const homeId = "63000000-0000-4000-8000-000000000101";
const entries = {
  there: "63000000-0000-4000-8000-000000000201",
  stay: "63000000-0000-4000-8000-000000000202",
  back: "63000000-0000-4000-8000-000000000203",
  manual: "63000000-0000-4000-8000-000000000204"
};
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read"] };
const at = (minutes: number) => new Date(Date.parse("2026-10-20T08:00:00.000Z") + minutes * 60_000).toISOString();
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("named patterns on disposable PostgreSQL (location v3 PR 14)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Location group integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    const db = database;
    await db.query("delete from workspaces where id = $1", [workspaceId]);
    await db.query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
    await db.query("insert into users (id, email, name) values ($1, 'groups@example.test', 'Groups'), ($2, 'other@example.test', 'Other')",
      [userId, otherUserId]);
    await db.query("insert into workspaces (id, name) values ($1, 'Groups')", [workspaceId]);
    await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')",
      [workspaceId, userId, otherUserId]);
    await db.query("insert into places (id, workspace_id, name, latitude, longitude, radius_meters) values ($1, $2, 'Home', 10, 20, 100)",
      [homeId, workspaceId]);
    // Stays: Home before, the unsaved school stop, Home after (synthetic coordinates).
    const stays: [string, string | null, number, number, number][] = [
      ["seg-home-before", homeId, 10, 20, -60],
      ["seg-school", null, 10.01, 20.01, 10],
      ["seg-home-after", homeId, 10, 20, 40]
    ];
    for (const [segmentId, placeId, latitude, longitude, start] of stays) {
      await db.query(
        `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, place_id, started_at, stopped_at, centre)
         values ($1, $2, $3, 'device-1', $4, $5, $6, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography)`,
        [workspaceId, userId, segmentId, placeId, at(start), at(start + 20), latitude, longitude]);
    }
    const event = async (id: string, eventType: string, payload: Record<string, unknown>, start: number, stop: number) => {
      const eventId = (await db.query<{ id: string }>(
        `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
         values ($1, $2, 'location_learning', $3, $4, 'medium', $5::jsonb) returning id`,
        [workspaceId, userId, eventType, at(start), JSON.stringify(payload)])).rows[0].id;
      await db.query(
        `insert into time_entries (id, workspace_id, user_id, source, started_at, stopped_at, created_from_event_id)
         values ($1, $2, $3, 'location_learning', $4, $5, $6)`,
        [id, workspaceId, userId, at(start), at(stop), eventId]);
    };
    await event(entries.there, "commute_detected", { clientSegmentId: "seg-m1", fromStaySegmentId: "seg-home-before", toStaySegmentId: "seg-school" }, 0, 10);
    await event(entries.stay, "unknown_stay_detected", { clientSegmentId: "seg-school", namePatternKey: "hashed-school-key" }, 10, 30);
    await event(entries.back, "commute_detected", { clientSegmentId: "seg-m2", fromStaySegmentId: "seg-school", toStaySegmentId: "seg-home-after" }, 30, 40);
    await db.query(
      `insert into time_entries (id, workspace_id, user_id, source, started_at, stopped_at) values ($1, $2, $3, 'manual_app', $4, $5)`,
      [entries.manual, workspaceId, userId, at(50), at(60)]);
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
    await database.end();
  });

  const listed = async () => (await database!.query<{ id: string; source: string; startedAt: string; stoppedAt: string }>(
    `select id, source, started_at as "startedAt", stopped_at as "stoppedAt" from time_entries where workspace_id = $1 order by started_at`,
    [workspaceId])).rows;

  it("leaves an unnamed pattern alone", async () => {
    await database!.query("delete from location_name_patterns where workspace_id = $1", [workspaceId]);
    expect((await getLocationGroups(database!, session, await listed())).size).toBe(0);
  });

  it("groups the Moves and the Stay once the person has named the Stay's pattern", async () => {
    await database!.query(
      `insert into location_name_patterns (workspace_id, user_id, pattern_key, band, name, uses)
       values ($1, $2, 'hashed-school-key', 'morning', 'School run', 2), ($1, $2, 'hashed-school-key', 'evening', 'Pick-up', 1)
       on conflict (workspace_id, user_id, pattern_key, band) do update set name = excluded.name, uses = excluded.uses`,
      [workspaceId, userId]);
    const groups = await getLocationGroups(database!, session, await listed());
    expect([...groups.keys()].sort()).toEqual([entries.there, entries.stay, entries.back].sort());
    expect(groups.get(entries.there)).toEqual({ key: `named:${entries.stay}`, name: "School run", parts: 3 });
    expect(groups.has(entries.manual)).toBe(false);
  });

  it("finds the Moves' ends through the owner and client segment index (Codex r1 on #501)", async () => {
    const client = await database!.connect();
    try {
      await client.query("begin");
      await client.query("set local enable_seqscan = off");
      const plan = await client.query<{ "QUERY PLAN": string }>(
        `explain select client_segment_id from stay_segments
          where workspace_id = $1 and user_id = $2 and client_segment_id = any($3::text[])`,
        [workspaceId, userId, ["seg-home-before", "seg-home-after"]]);
      expect(plan.rows.map((row) => row["QUERY PLAN"]).join("\n")).toContain("idx_stay_segments_owner_client");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("groups a Stay split in Review: both parts stand for the stay the Moves name (Codex r1 on #501)", async () => {
    const db = database!;
    // A second outing later in the day, its stop split into two parts by a correction.
    const parent = (await db.query<{ id: string }>(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, started_at, stopped_at, centre)
       values ($1, $2, 'seg-park', 'device-1', $3, $4, ST_SetSRID(ST_MakePoint(20.02, 10.02), 4326)::geography) returning id`,
      [workspaceId, userId, at(130), at(160)])).rows[0].id;
    const children: string[] = [];
    for (const [clientId, start, stop] of [["seg-park-left", 130, 145], ["seg-park-right", 145, 160]] as const) {
      children.push((await db.query<{ id: string }>(
        `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, started_at, stopped_at, parent_segment_id, source)
         values ($1, $2, $3, 'device-1', $4, $5, $6, 'manual_split') returning id`,
        [workspaceId, userId, clientId, at(start), at(stop), parent])).rows[0].id);
    }
    for (const [segmentId, start] of [["seg-home-before-2", 100], ["seg-home-after-2", 170]] as const) {
      await db.query(
        `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, place_id, started_at, stopped_at, centre)
         values ($1, $2, $3, 'device-1', $4, $5, $6, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography)`,
        [workspaceId, userId, segmentId, homeId, at(start), at(start + 10)]);
    }
    const ids = ["63000000-0000-4000-8000-000000000301", "63000000-0000-4000-8000-000000000302",
      "63000000-0000-4000-8000-000000000303", "63000000-0000-4000-8000-000000000304"];
    const parts: [string, string, Record<string, unknown>, number, number][] = [
      [ids[0], "commute_detected", { clientSegmentId: "seg-m3", fromStaySegmentId: "seg-home-before-2", toStaySegmentId: "seg-park" }, 120, 130],
      [ids[1], "unknown_stay", { segmentId: children[0], correction: true, namePatternKey: "hashed-park-key" }, 130, 145],
      [ids[2], "unknown_stay", { segmentId: children[1], correction: true, namePatternKey: "hashed-park-key" }, 145, 160],
      [ids[3], "commute_detected", { clientSegmentId: "seg-m4", fromStaySegmentId: "seg-park", toStaySegmentId: "seg-home-after-2" }, 160, 170]
    ];
    for (const [id, eventType, payload, start, stop] of parts) {
      const eventId = (await db.query<{ id: string }>(
        `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
         values ($1, $2, 'location_learning', $3, $4, 'medium', $5::jsonb) returning id`,
        [workspaceId, userId, eventType, at(start), JSON.stringify(payload)])).rows[0].id;
      await db.query(
        `insert into time_entries (id, workspace_id, user_id, source, started_at, stopped_at, created_from_event_id)
         values ($1, $2, $3, 'location_learning', $4, $5, $6)`,
        [id, workspaceId, userId, at(start), at(stop), eventId]);
    }
    await db.query(
      `insert into location_name_patterns (workspace_id, user_id, pattern_key, band, name, uses)
       values ($1, $2, 'hashed-park-key', 'morning', 'Park run', 1)`, [workspaceId, userId]);
    const groups = await getLocationGroups(database!, session, await listed());
    expect(ids.map((id) => groups.get(id))).toEqual(ids.map(() => ({ key: `named:${ids[1]}`, name: "Park run", parts: 4 })));
  });

  it("never uses another person's names or blocks", async () => {
    const other: RequestSession = { ...session, userId: otherUserId };
    expect((await getLocationGroups(database!, other, await listed())).size).toBe(0);
  });
});
