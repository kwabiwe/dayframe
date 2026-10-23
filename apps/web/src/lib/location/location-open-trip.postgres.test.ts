import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { OpenTrip } from "@dayframe/shared";
import type { RequestSession } from "../session";

// Run with DAYFRAME_OPEN_TRIP_TEST_DATABASE_URL pointing at a disposable local *_test database
// (base or ordered schema). Synthetic ids and coordinates only. Location v4 step 5.
const databaseUrl = process.env.DAYFRAME_OPEN_TRIP_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const workspaceId = "64000000-0000-4000-8000-000000000001";
const userId = "64000000-0000-4000-8000-000000000002";
const otherUserId = "64000000-0000-4000-8000-000000000003";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read", "app:write"] };
const otherSession: RequestSession = { ...session, userId: otherUserId };
const now = "2026-10-20T12:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(now) + minutes * 60_000).toISOString();
let database: pg.Pool | null = null;
const ids: Record<string, string> = {};

const describeWithDatabase = databaseUrl ? describe : describe.skip;

const trip = (fromStaySegmentId: string, lastObservedMinutes: number): OpenTrip => ({
  kind: "open_trip", clientSegmentId: `open-${fromStaySegmentId}`, fromStaySegmentId, fromPlaceId: null,
  startedAt: at(-30), lastObservedAt: at(lastObservedMinutes), routeSampleCount: 12, routeDistanceMeters: 2_400,
  travelMode: "automotive", evidenceIds: ["e1", "e2"]
});

describeWithDatabase("open trip on disposable PostgreSQL (location v4 step 5)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Open trip integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    const db = database;
    await db.query("delete from workspaces where id = $1", [workspaceId]);
    await db.query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
    await db.query("insert into users (id, email, name) values ($1, 'open-trip@example.test', 'Open'), ($2, 'open-other@example.test', 'Other')",
      [userId, otherUserId]);
    await db.query("insert into workspaces (id, name) values ($1, 'Open trip')", [workspaceId]);
    await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')",
      [workspaceId, userId, otherUserId]);
    // Two of the user's stays (the older one carries a stale trip and another metadata key) and one of another user's.
    const stays: [string, string, number, Record<string, unknown>][] = [
      ["seg-earlier", userId, -300, { placeMatchKind: "unknown", openTrip: { startedAt: at(-280), lastObservedAt: at(-270) } }],
      ["seg-origin", userId, -60, { placeMatchKind: "unknown", locationOnlyStoppedAt: at(-31) }],
      ["seg-other", otherUserId, -60, { placeMatchKind: "unknown" }]
    ];
    for (const [segmentId, owner, start, metadata] of stays) {
      ids[segmentId] = (await db.query<{ id: string }>(
        `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, started_at, stopped_at, centre, metadata)
         values ($1, $2, $3, 'device-1', $4, $5, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography, $6::jsonb) returning id`,
        [workspaceId, owner, segmentId, at(start), at(start + 30), JSON.stringify(metadata)])).rows[0].id;
    }
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
    await database.end();
    const { pool } = await import("../db");
    await pool.end();
  });

  const metadataOf = async (segmentId: string) =>
    (await database!.query<{ metadata: Record<string, unknown> }>("select metadata from stay_segments where id = $1", [ids[segmentId]])).rows[0].metadata;
  const persist = async (openTrip: OpenTrip | null, as = session) => {
    const { persistOpenTrip } = await import("./location-replay-service");
    const client = await database!.connect();
    try {
      await persistOpenTrip(client, as, "device-1", openTrip, new Map(Object.entries(ids)));
    } finally {
      client.release();
    }
  };

  it("stores the trip under its origin stay only, clears stale ones, and keeps the stay's other metadata", async () => {
    await persist(trip("seg-origin", -2));
    expect((await metadataOf("seg-origin")).openTrip).toEqual({ startedAt: at(-30), lastObservedAt: at(-2), routeSampleCount: 12,
      routeDistanceMeters: 2_400, travelMode: "automotive" });
    expect((await metadataOf("seg-origin")).locationOnlyStoppedAt).toBe(at(-31));
    expect(await metadataOf("seg-earlier")).not.toHaveProperty("openTrip");
    expect(await metadataOf("seg-earlier")).toHaveProperty("placeMatchKind", "unknown");
  });

  it("reads it for bootstrap while it is fresh, for its own user only, without coordinates", async () => {
    const { getOpenTrip } = await import("../queries");
    expect(await getOpenTrip(session, now)).toEqual({ startedAt: at(-30), lastObservedAt: at(-2), fromPlaceId: null, travelMode: "automotive" });
    expect(await getOpenTrip(otherSession, now)).toBeNull();
    expect(await getOpenTrip(session, at(-2 + 12))).not.toBeNull();
    expect(await getOpenTrip(session, at(-2 + 13))).toBeNull();
  });

  it("is cleared by a replay with no journey in progress", async () => {
    await persist(null);
    expect(await metadataOf("seg-origin")).not.toHaveProperty("openTrip");
    const { getOpenTrip } = await import("../queries");
    expect(await getOpenTrip(session, now)).toBeNull();
  });

  it("never touches another user's stays", async () => {
    await database!.query(`update stay_segments set metadata = metadata || '{"openTrip":{"startedAt":"x"}}'::jsonb where id = $1`, [ids["seg-other"]]);
    await persist(null);
    expect(await metadataOf("seg-other")).toHaveProperty("openTrip");
  });
});
