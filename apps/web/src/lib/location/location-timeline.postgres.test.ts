import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { RequestSession } from "../session";

// Run with DAYFRAME_TIMELINE_TEST_DATABASE_URL pointing at a disposable local *_test database
// (base or ordered schema). Synthetic ids, names and coordinates only. Location v4 step 8.
const databaseUrl = process.env.DAYFRAME_TIMELINE_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const workspaceId = "65000000-0000-4000-8000-000000000001";
const userId = "65000000-0000-4000-8000-000000000002";
const otherUserId = "65000000-0000-4000-8000-000000000003";
const homeId = "65000000-0000-4000-8000-000000000101";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read"] };
const at = (minutes: number) => new Date(Date.parse("2026-10-20T00:00:00.000Z") + minutes * 60_000).toISOString();
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("location timeline on disposable PostgreSQL (location v4 step 8)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Timeline integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    const db = database;
    await db.query("delete from workspaces where id = $1", [workspaceId]);
    await db.query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
    await db.query("insert into users (id, email, name) values ($1, 'timeline@example.test', 'T'), ($2, 'timeline-other@example.test', 'O')",
      [userId, otherUserId]);
    await db.query("insert into workspaces (id, name) values ($1, 'Timeline')", [workspaceId]);
    await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')",
      [workspaceId, userId, otherUserId]);
    await db.query("insert into places (id, workspace_id, name, latitude, longitude, radius_meters, role) values ($1, $2, 'Home', 10, 20, 100, 'home')",
      [homeId, workspaceId]);
    const stay = async (segmentId: string, owner: string, placeId: string | null, start: number, stop: number | null, status = "finalised",
      metadata: Record<string, unknown> = {}) => (await db.query<{ id: string }>(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, place_id, status, started_at, stopped_at, centre, metadata)
       values ($1, $2, $3, 'device-1', $4, $5, $6, $7, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography, $8::jsonb) returning id`,
      [workspaceId, owner, segmentId, placeId, status, at(start), stop == null ? null : at(stop), JSON.stringify(metadata)])).rows[0].id;
    // The day (UTC): Home until 08:00, a trip with two legs, an unknown place 08:40–21:00, then a walk.
    const home = await stay("seg-home", userId, homeId, -120, 480, "finalised", { placeMatchKind: "saved" });
    // The unknown place 08:40–21:00, then a walk in progress (its metadata's openTrip) until 23:50.
    const shop = await stay("seg-unknown", userId, null, 520, 1_260, "finalised", { placeMatchKind: "unknown",
      openTrip: { startedAt: at(1_261), lastObservedAt: at(1_430), travelMode: "walking",
        legs: [{ startedAt: at(1_261), stoppedAt: at(1_430), mode: "walking", confidence: "sure", distanceMeters: 900 }] } });
    await stay("seg-replaced", userId, null, 600, 700, "superseded");
    await stay("seg-other", otherUserId, null, 100, 200);
    await db.query(
      `insert into commute_segments (workspace_id, user_id, device_id, client_segment_id, algorithm_version, status, started_at, stopped_at,
         from_stay_segment_id, to_stay_segment_id, route_distance_m, confidence, metadata)
       values ($1, $2, 'device-1', 'trip-1', 'location-v2.0', 'finalised', $3, $4, $5, $6, 3456.4, 'medium', $7::jsonb)`,
      [workspaceId, userId, at(480), at(520), home, shop, JSON.stringify({ qualificationReason: "significant_endpoint_displacement",
        travelMode: "automotive", legs: [
          { startedAt: at(480), stoppedAt: at(510), mode: "automotive", confidence: "sure", distanceMeters: 3000, latitude: 10 },
          { startedAt: at(512), stoppedAt: at(520), mode: "walking", confidence: "likely", distanceMeters: 400 }] })]);
    // The trip's automatic block, made from its event.
    const eventId = (await db.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
       values ($1, $2, 'location_learning', 'commute_detected', $3, 'medium', $4::jsonb) returning id`,
      [workspaceId, userId, at(480), JSON.stringify({ clientSegmentId: "trip-1" })])).rows[0].id;
    await db.query(
      `insert into time_entries (id, workspace_id, user_id, source, started_at, stopped_at, created_from_event_id)
       values ('65000000-0000-4000-8000-000000000301', $1, $2, 'location_learning', $3, $4, $5)`,
      [workspaceId, userId, at(480), at(520), eventId]);
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
    await database.end();
    const { pool } = await import("../db");
    await pool.end();
  }, 60_000);

  it("returns the day's places, trips with legs, the journey in progress and the gaps, without coordinates", async () => {
    const { getLocationTimeline } = await import("./location-timeline-service");
    const timeline = await getLocationTimeline(session, { date: "2026-10-20", timeZone: "UTC", now: new Date(at(1_435)) });
    expect(timeline).toMatchObject({ date: "2026-10-20", timeZone: "UTC", dayStart: at(0), dayEnd: at(1_440) });
    expect(timeline.items.map((item) => [item.kind, item.id])).toEqual([["place", "seg-home"], ["trip", "trip-1"], ["place", "seg-unknown"]]);
    expect(timeline.items[0]).toMatchObject({ name: "Home", role: "home", matchKind: "saved", startedAt: at(-120), stoppedAt: at(480) });
    expect(timeline.items[2]).toMatchObject({ name: null, matchKind: "unknown", placeId: null });
    expect(timeline.items[1]).toMatchObject({ fromId: "seg-home", toId: "seg-unknown", mode: "automotive", distanceMeters: 3456,
      reason: "significant_endpoint_displacement", blockIds: ["65000000-0000-4000-8000-000000000301"] });
    expect(timeline.items[0]).toMatchObject({ blockIds: [] });
    expect((timeline.items[1] as { legs: unknown[] }).legs).toEqual([
      { startedAt: at(480), stoppedAt: at(510), mode: "automotive", confidence: "sure", distanceMeters: 3000 },
      { startedAt: at(512), stoppedAt: at(520), mode: "walking", confidence: "likely", distanceMeters: 400 }]);
    expect(timeline.openTrip).toMatchObject({ fromId: "seg-unknown", startedAt: at(1_261), mode: "walking",
      legs: [{ startedAt: at(1_261), stoppedAt: at(1_430), mode: "walking", confidence: "sure", distanceMeters: 900 }] });
    expect(timeline.gaps).toEqual([]);
    expect(JSON.stringify(timeline)).not.toMatch(/latitude|longitude|centre/);
  });

  it("shows the unobserved afternoon as a gap once the journey is no longer fresh", async () => {
    const { getLocationTimeline } = await import("./location-timeline-service");
    const timeline = await getLocationTimeline(session, { date: "2026-10-20", timeZone: "UTC", now: new Date(at(1_500)) });
    expect(timeline.openTrip).toBeNull();
    expect(timeline.gaps).toEqual([{ kind: "gap", startedAt: at(1_260), stoppedAt: at(1_440) }]);
  });

  it("cuts the day in the requested zone and reads only the user's own segments", async () => {
    const { getLocationTimeline } = await import("./location-timeline-service");
    const other = await getLocationTimeline({ ...session, userId: otherUserId }, { date: "2026-10-20", timeZone: "UTC", now: new Date(at(1_500)) });
    expect(other.items.map((item) => item.id)).toEqual(["seg-other"]);
    const tokyo = await getLocationTimeline(session, { date: "2026-10-20", timeZone: "Asia/Tokyo", now: new Date(at(1_500)) });
    expect(tokyo).toMatchObject({ timeZone: "Asia/Tokyo", dayStart: at(-540), dayEnd: at(900) });
    const kiritimati = await getLocationTimeline(session, { date: "2026-10-21", timeZone: "Pacific/Kiritimati", now: new Date(at(1_500)) });
    // That day runs 10:00–10:00 UTC (UTC+14): the Home stay ended before it.
    expect(kiritimati.items.map((item) => item.id)).toEqual(["seg-unknown"]);
  });
  it("links blocks by segment whatever day they sit on, maps correction events, and keeps a journey whose origin was superseded (Codex r1 on #564)", async () => {
    const db = database!;
    const { getLocationTimeline } = await import("./location-timeline-service");
    // A block of the unknown place (20 Oct) that the user moved to 25 Oct keeps its link.
    const eventId = (await db.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
       values ($1, $2, 'location_learning', 'unknown_stay', $3, 'low', '{"clientSegmentId":"seg-unknown"}'::jsonb) returning id`,
      [workspaceId, userId, at(520)])).rows[0].id;
    await db.query(
      `insert into time_entries (id, workspace_id, user_id, source, started_at, stopped_at, created_from_event_id)
       values ('65000000-0000-4000-8000-000000000302', $1, $2, 'location_learning', $3, $4, $5)`,
      [workspaceId, userId, at(5 * 1_440 + 60), at(5 * 1_440 + 120), eventId]);
    // A Review correction's part names its row id; on 21 Oct.
    const part = (await db.query<{ id: string }>(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, status, started_at, stopped_at, centre, metadata)
       values ($1, $2, 'seg-part', 'device-1', 'finalised', $3, $4, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography, '{}'::jsonb) returning id`,
      [workspaceId, userId, at(1_440 + 600), at(1_440 + 700)])).rows[0].id;
    const correction = (await db.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
       values ($1, $2, 'location_learning', 'unknown_stay', $3, 'low', $4::jsonb) returning id`,
      [workspaceId, userId, at(1_440 + 600), JSON.stringify({ segmentId: part, correction: true, startedAt: at(1_440 + 600) })])).rows[0].id;
    await db.query(
      `insert into time_entries (id, workspace_id, user_id, source, started_at, stopped_at, created_from_event_id)
       values ('65000000-0000-4000-8000-000000000303', $1, $2, 'location_learning', $3, $4, $5)`,
      [workspaceId, userId, at(1_440 + 600), at(1_440 + 700), correction]);
    // 22 Oct: a fresh journey whose origin stay an older replay superseded.
    await db.query(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, status, started_at, stopped_at, centre, metadata)
       values ($1, $2, 'seg-origin', 'device-1', 'superseded', $3, $4, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography, $5::jsonb)`,
      [workspaceId, userId, at(2 * 1_440 + 400), at(2 * 1_440 + 500), JSON.stringify({ openTrip: { startedAt: at(2 * 1_440 + 500),
        lastObservedAt: at(2 * 1_440 + 530), legs: [] } })]);

    const first = await getLocationTimeline(session, { date: "2026-10-20", timeZone: "UTC", now: new Date(at(6 * 1_440)) });
    expect(first.items.find((item) => item.id === "seg-unknown")?.blockIds).toEqual(["65000000-0000-4000-8000-000000000302"]);
    const second = await getLocationTimeline(session, { date: "2026-10-21", timeZone: "UTC", now: new Date(at(6 * 1_440)) });
    expect(second.items.find((item) => item.id === "seg-part")?.blockIds).toEqual(["65000000-0000-4000-8000-000000000303"]);
    const third = await getLocationTimeline(session, { date: "2026-10-22", timeZone: "UTC", now: new Date(at(2 * 1_440 + 535)) });
    expect(third.openTrip).toMatchObject({ fromId: "seg-origin", startedAt: at(2 * 1_440 + 500) });
    expect(third.items.map((item) => item.id)).not.toContain("seg-origin");

    // With 20 months of history, the day's stay read is a bounded range on the user-time index.
    await db.query(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, status, started_at, stopped_at, centre, metadata)
       select $1, $2, 'seg-history-' || n, 'device-1', 'finalised', $3::timestamptz - n * interval '5 hours',
              $3::timestamptz - n * interval '5 hours' + interval '40 minutes', ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography, '{}'::jsonb
         from generate_series(1, 3000) as n`, [workspaceId, userId, at(-1_440)]);
    await db.query("analyze stay_segments");
    const client = await db.connect();
    try {
      const plan = (await client.query<{ "QUERY PLAN": string }>(
        `explain select s.id from stay_segments s
          where s.workspace_id = $1 and s.user_id = $2 and s.status <> 'superseded' and s.client_segment_id is not null
            and s.started_at >= $3::timestamptz and s.started_at < $4::timestamptz and coalesce(s.stopped_at, $5::timestamptz) > $6::timestamptz`,
        [workspaceId, userId, at(-31 * 1_440), at(1_440), at(6 * 1_440), at(0)])).rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(plan).toContain("idx_stay_segments_user_time");
      expect(plan).toMatch(/started_at >= /);
    } finally {
      client.release();
    }
  }, 60_000);
});
