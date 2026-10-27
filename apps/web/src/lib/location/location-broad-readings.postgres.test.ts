import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { bundledStations, distanceMeters, LOCATION_ENGINE_V2_CONFIG as config, nearestStation } from "@dayframe/shared";
import type { RequestSession } from "../session";

// Run with DAYFRAME_BROAD_READINGS_TEST_DATABASE_URL pointing at a disposable local *_test database
// (base or ordered schema). Synthetic ids; positions between two bundled Underground stations (public data, read
// from the station list, never written here), as a silence is a leg only with a station near both ends (card A).
const databaseUrl = process.env.DAYFRAME_BROAD_READINGS_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const workspaceId = "67000000-0000-4000-8000-000000000001";
const userId = "67000000-0000-4000-8000-000000000002";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read"] };
const at = (minutes: number) => new Date(Date.parse("2026-10-20T00:00:00.000Z") + minutes * 60_000).toISOString();
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("broad readings across ingest and replay on disposable PostgreSQL (location v4 step 7)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Broad-reading integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = $1", [userId]);
    await database.query("insert into users (id, email, name) values ($1, 'broad@example.test', 'B')", [userId]);
    await database.query("insert into workspaces (id, name) values ($1, 'Broad')", [workspaceId]);
    await database.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = $1", [userId]);
    await database.end();
    const { pool } = await import("../db");
    await pool.end();
  });

  /** Two bundled Underground stations away from rail, 6–9 km apart: a seven-minute ride between them is 14–21 m/s. */
  const [from, to] = (() => {
    const list = bundledStations("underground").filter((station) => !nearestStation(station, ["rail"], config.tripStationRadiusMeters));
    for (const a of list) for (const b of list) {
      const metres = distanceMeters(a, b);
      if (metres >= 6_000 && metres <= 9_000) return [a, b];
    }
    throw new Error("no Underground pair");
  })();
  const span = distanceMeters(from, to);
  /** A point `metres` along the line from one station towards the other. */
  const along = (metres: number) => ({ latitude: from.latitude + (to.latitude - from.latitude) * metres / span,
    longitude: from.longitude + (to.longitude - from.longitude) * metres / span });

  /** A stay, a seven-minute ride whose accurate fixes are six minutes apart near two stations, and a stay; as ingest stores them. */
  async function seed(deviceId: string, broadInSilence: boolean) {
    const db = database!;
    const rows: Array<[string, string, number, number | null, number, number | null, boolean, string | null]> = [];
    for (let index = 0; index < 8; index += 1) rows.push([`a-${index}`, "standard_location", 70 + index * 30 / 7, 0, 8, 0, true, null]);
    for (const [minute, east, speed] of [[101, 0, 12], [101.5, 400, 13], [107.5, span - 400, 13], [108, span, 12]] as const) {
      rows.push([`fix-${minute}`, "standard_location", minute, east, 8, speed, true, null]);
    }
    for (let index = 0; index < 8; index += 1) rows.push([`b-${index}`, "standard_location", 109 + index * 31 / 7, span, 8, 0, true, null]);
    // Ingest keeps a reading too broad to accept without its position or speed, as rejected.
    if (broadInSilence) for (const minute of [103, 104, 105, 106]) rows.push([`broad-${minute}`, "standard_location", minute, null, 300, null, false, "accuracy_too_broad"]);
    for (const [id, kind, minute, east, accuracy, speed, accepted, reason] of rows) {
      await db.query(
        `insert into location_evidence (workspace_id, user_id, device_id, client_evidence_id, client_batch_id, evidence_type, occurred_at,
           coordinate, horizontal_accuracy_m, speed_mps, accepted, rejection_reason, algorithm_version, time_zone, is_simulated, expires_at)
         values ($1, $2, $3, $4, 'batch-1', $5, $6,
           case when $7::double precision is null then null else ST_SetSRID(ST_MakePoint($7::double precision, $14::double precision), 4326)::geography end,
           $8, $9, $10, $11, $12, 'UTC', false, $13)`,
        [workspaceId, userId, deviceId, id, kind, at(minute), east == null ? null : along(east).longitude, accuracy, speed, accepted, reason,
          config.algorithmVersion, at(60 * 24 * 30), east == null ? null : along(east).latitude]);
    }
    for (const [minute, activity] of [[0, "stationary"], [101, "automotive"], [108, "stationary"]] as const) {
      await db.query(
        `insert into location_evidence (workspace_id, user_id, device_id, client_evidence_id, client_batch_id, evidence_type, occurred_at,
           algorithm_version, time_zone, is_simulated, metadata, expires_at)
         values ($1, $2, $3, $4, 'batch-1', 'motion_activity', $5, $6, 'UTC', false, $7::jsonb, $8)`,
        [workspaceId, userId, deviceId, `motion-${minute}`, at(minute), config.algorithmVersion,
          JSON.stringify({ motionActivity: activity, motionConfidence: "high" }), at(60 * 24 * 30)]);
    }
  }

  async function legModes(deviceId: string) {
    const { replayLocationEvidence } = await import("./location-replay-service");
    const client = await database!.connect();
    try {
      await client.query("begin");
      await replayLocationEvidence(client, session, { deviceId, algorithmVersion: config.algorithmVersion, processingAt: at(200) });
      await client.query("commit");
    } finally {
      client.release();
    }
    const trips = await database!.query<{ legs: Array<{ mode: string; unobserved?: boolean }> | null }>(
      `select metadata -> 'legs' as legs from commute_segments where workspace_id = $1 and device_id = $2 and status <> 'superseded'`,
      [workspaceId, deviceId]);
    // Only the silence's own leg: a ride seen between Underground stations is the Underground too.
    return trips.rows.flatMap((row) => (row.legs ?? []).filter((leg) => leg.unobserved).map((leg) => leg.mode));
  }

  it("lets readings stored as too broad still break a silence, by their times alone (Codex r3 on #563)", async () => {
    await seed("device-quiet", false);
    await seed("device-seen", true);
    expect(await legModes("device-quiet")).toEqual(["underground"]);
    expect(await legModes("device-seen")).toEqual([]);
  }, 30_000);
});
