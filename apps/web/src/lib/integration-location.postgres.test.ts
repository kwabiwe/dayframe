import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { RequestSession } from "./session";

// Run with DAYFRAME_INTEGRATION_TEST_DATABASE_URL pointing at a disposable local *_test database
// (ordered schema). Synthetic ids, names and coordinates only.
const databaseUrl = process.env.DAYFRAME_INTEGRATION_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const workspaceId = "66000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "66000000-0000-4000-8000-000000000002";
const userId = "66000000-0000-4000-8000-000000000011";
const memberId = "66000000-0000-4000-8000-000000000012";
const strangerId = "66000000-0000-4000-8000-000000000013";
const homeId = "66000000-0000-4000-8000-000000000101";
const poolId = "66000000-0000-4000-8000-000000000102";
const otherHomeId = "66000000-0000-4000-8000-000000000103";
const otherPoolId = "66000000-0000-4000-8000-000000000104";
const categoryId = "66000000-0000-4000-8000-000000000201";
const session: RequestSession = { workspaceId, userId, authMode: "token", scopes: ["time:read", "location:read", "review:read"] };
const now = new Date("2026-10-25T12:00:00.000Z");
const day = (d: number, minutes = 0) => new Date(Date.parse("2026-10-01T00:00:00.000Z") + (d - 1) * 86_400_000 + minutes * 60_000).toISOString();
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("integration location and summary reads on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    const db = database;
    await db.query("delete from workspaces where id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
    await db.query("delete from users where id = any($1::uuid[])", [[userId, memberId, strangerId]]);
    await db.query(`insert into users (id, email, name) values ($1, 'i1@example.test', 'A'), ($2, 'i2@example.test', 'B'),
      ($3, 'i3@example.test', 'C')`, [userId, memberId, strangerId]);
    await db.query("insert into workspaces (id, name) values ($1, 'Mine'), ($2, 'Theirs')", [workspaceId, otherWorkspaceId]);
    await db.query(`insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member'),
      ($4, $5, 'owner')`, [workspaceId, userId, memberId, otherWorkspaceId, strangerId]);
    await db.query(`insert into places (id, workspace_id, name, latitude, longitude, radius_meters, role) values
      ($1, $3, 'Home', 10, 20, 100, 'home'), ($2, $3, '  Riverside   Pool ', 10.1, 20.1, 100, null),
      ($4, $6, 'Home', 30, 40, 100, 'home'), ($5, $6, 'Riverside Pool', 30.1, 40.1, 100, null)`,
      [homeId, poolId, workspaceId, otherHomeId, otherPoolId, otherWorkspaceId]);
    await db.query("insert into categories (id, workspace_id, name, color) values ($1, $2, 'Family', 'rose')", [categoryId, workspaceId]);

    let seq = 0;
    const stay = async (ws: string, owner: string, placeId: string | null, start: string, stop: string | null, status = "finalised") =>
      (await db.query<{ id: string }>(
        `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, place_id, status, started_at, stopped_at, centre)
         values ($1, $2, $3, 'device-1', $4, $5, $6, $7, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography) returning id`,
        [ws, owner, `stay-${++seq}`, placeId, status, start, stop])).rows[0].id;
    /** A trip from `from` to `to` on day `d` (08:40 for `minutes`), its block logged with `block` (or none). */
    const trip = async (id: string, input: {
      d: number; minutes?: number; from: string | null; to: string | null; ws?: string; owner?: string; status?: string;
      metadata?: Record<string, unknown>; block?: "confirmed" | "needs_review" | "ignored" | "deleted" | null;
    }) => {
      const ws = input.ws ?? workspaceId;
      const owner = input.owner ?? userId;
      const departed = day(input.d, 520);
      const arrived = day(input.d, 520 + (input.minutes ?? 15));
      const fromStay = await stay(ws, owner, input.from, day(input.d, 400), departed);
      const toStay = await stay(ws, owner, input.to, arrived, day(input.d, 640));
      await db.query(
        `insert into commute_segments (workspace_id, user_id, device_id, client_segment_id, algorithm_version, status, started_at, stopped_at,
           from_stay_segment_id, to_stay_segment_id, route_distance_m, confidence, metadata)
         values ($1, $2, 'device-1', $3, 'location-v2.0', $4, $5, $6, $7, $8, 4200, 'high', $9::jsonb)`,
        [ws, owner, id, input.status ?? "finalised", departed, arrived, fromStay, toStay, JSON.stringify(input.metadata ?? {
          travelMode: "automotive", legs: [
            { startedAt: departed, stoppedAt: day(input.d, 520 + (input.minutes ?? 15) - 2), mode: "automotive", confidence: "sure", distanceMeters: 4000 },
            { startedAt: day(input.d, 520 + (input.minutes ?? 15) - 2), stoppedAt: arrived, mode: "walking", confidence: "likely", distanceMeters: 150 }] })]);
      if (input.block === null || input.block === undefined) return;
      const eventId = (await db.query<{ id: string }>(
        `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
         values ($1, $2, 'location_learning', 'commute_detected', $3, 'high', $4::jsonb, 'confirmed') returning id`,
        [ws, owner, departed, JSON.stringify({ clientSegmentId: id })])).rows[0].id;
      if (input.block === "deleted") return;
      await db.query(
        `insert into time_entries (workspace_id, user_id, source, started_at, stopped_at, created_from_event_id, review_status)
         values ($1, $2, 'location_auto_log', $3, $4, $5, $6)`, [ws, owner, departed, arrived, eventId, input.block]);
    };

    // Three confirmed home drives to the pool (15, 17 and 20 minutes), one Pool→Home drive.
    await trip("drive-1", { d: 1, minutes: 15, from: homeId, to: poolId, block: "confirmed" });
    await trip("drive-2", { d: 3, minutes: 17, from: homeId, to: poolId, block: "confirmed" });
    await trip("drive-3", { d: 5, minutes: 20, from: homeId, to: poolId, block: "confirmed" });
    await trip("drive-back", { d: 6, from: poolId, to: homeId, block: "confirmed" });
    // Never driving evidence: unanswered, ignored or deleted blocks, no block, a walk, a stop, a bus leg,
    // a superseded trip, an unknown destination, someone else's drives.
    await trip("unanswered", { d: 7, from: homeId, to: poolId, block: "needs_review" });
    await trip("ignored", { d: 8, from: homeId, to: poolId, block: "ignored" });
    await trip("deleted", { d: 9, from: homeId, to: poolId, block: "deleted" });
    await trip("no-block", { d: 10, from: homeId, to: poolId, block: null });
    await trip("walk", { d: 11, from: homeId, to: poolId, block: "confirmed", metadata: { travelMode: "walking", legs: [] } });
    await trip("stopped", { d: 12, from: homeId, to: poolId, block: "confirmed",
      metadata: { travelMode: "automotive", legs: [], stops: [{ staySegmentId: "stay-x" }] } });
    await trip("bus", { d: 13, from: homeId, to: poolId, block: "confirmed", metadata: { travelMode: "automotive", legs: [
      { startedAt: day(13, 520), stoppedAt: day(13, 535), mode: "bus", confidence: "sure", distanceMeters: 4000 }] } });
    await trip("superseded", { d: 14, from: homeId, to: poolId, block: "confirmed", status: "superseded" });
    await trip("unknown-place", { d: 15, from: homeId, to: null, block: "confirmed" });
    await trip("member-drive", { d: 16, from: homeId, to: poolId, owner: memberId, block: "confirmed" });
    await trip("stranger-drive", { d: 17, from: otherHomeId, to: otherPoolId, ws: otherWorkspaceId, owner: strangerId, block: "confirmed" });

    // Now: at Home since 09:00 on the 25th, last seen 11:50; an unknown stay before it.
    await stay(workspaceId, userId, null, "2026-10-25T06:00:00.000Z", "2026-10-25T08:30:00.000Z");
    await stay(workspaceId, userId, homeId, "2026-10-25T09:00:00.000Z", null);
    await db.query(
      `insert into location_evidence (workspace_id, user_id, device_id, client_evidence_id, client_batch_id, evidence_type, occurred_at,
         algorithm_version, time_zone, expires_at)
       values ($1, $2, 'device-1', 'ev-1', 'batch-1', 'standard_location', '2026-10-25T11:50:00.000Z', 'location-v2.0', 'Europe/London', now() + interval '7 days')`,
      [workspaceId, userId]);

    // Time on Sunday 25 October (London: 23:00Z on the 24th to 00:00Z on the 26th, the clocks go back).
    await db.query(
      `insert into time_entries (workspace_id, user_id, category_id, source, started_at, stopped_at, review_status) values
        ($1, $2, $3, 'manual_app', '2026-10-24T22:30:00.000Z', '2026-10-24T23:30:00.000Z', 'confirmed'),
        ($1, $2, null, 'manual_app', '2026-10-25T09:00:00.000Z', '2026-10-25T09:30:00.000Z', 'needs_review'),
        ($1, $2, null, 'manual_app', '2026-10-25T11:00:00.000Z', null, 'confirmed'),
        ($1, $4, $3, 'manual_app', '2026-10-25T08:00:00.000Z', '2026-10-25T10:00:00.000Z', 'confirmed')`,
      [workspaceId, userId, categoryId, memberId]);

    // Review: a trip card, a Health card, an answered card, and the member's card.
    const event = async (owner: string, source: string, type: string) => (await db.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, review_status)
       values ($1, $2, $3, $4, now(), 'low', 'needs_review') returning id`, [workspaceId, owner, source, type])).rows[0].id;
    const card = async (owner: string, eventId: string, status: string, createdAt: string) => db.query(
      `insert into review_items (workspace_id, user_id, event_id, type, title, status, created_at) values ($1, $2, $3, 'suggestion', 'x', $4, $5)`,
      [workspaceId, owner, eventId, status, createdAt]);
    await card(userId, await event(userId, "location_learning", "commute_detected"), "open", "2026-10-20T08:00:00.000Z");
    await card(userId, await event(userId, "health_kit", "health_workout"), "open", "2026-10-22T08:00:00.000Z");
    await card(userId, await event(userId, "health_kit", "health_workout"), "accepted", "2026-10-18T08:00:00.000Z");
    await card(memberId, await event(memberId, "location_learning", "commute_detected"), "open", "2026-10-19T08:00:00.000Z");
  }, 60_000);

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
    await database.query("delete from users where id = any($1::uuid[])", [[userId, memberId, strangerId]]);
    await database.end();
    const { pool } = await import("./db");
    await pool.end();
  }, 60_000);

  it("returns only confirmed home-origin drives to saved places, newest first, in the preheat contract", async () => {
    const { getIntegrationDrives } = await import("./integration-location");
    const result = await getIntegrationDrives(session, { days: 180, limit: 1000, now });
    expect(result.samples.map((sample) => sample.provenance)).toEqual([
      "dayframe-location-drive:drive-3", "dayframe-location-drive:drive-2", "dayframe-location-drive:drive-1"]);
    expect(result.samples[0]).toEqual({
      routeId: "activity:riverside pool",
      departedAt: day(5, 520),
      arrivedAt: day(5, 540),
      confirmed: true,
      mode: "driving",
      homeOrigin: true,
      eventStartedAt: null,
      provenance: "dayframe-location-drive:drive-3",
      durationSeconds: 1200,
      drivingSeconds: 1080,
      destination: { placeId: poolId, name: "  Riverside   Pool ", role: null }
    });
    expect(result).toMatchObject({ ok: true, serverNow: now.toISOString(), truncated: false,
      coverage: { sampleCount: 3, routeCount: 1, latestDepartedAt: day(5, 520) } });
    expect(JSON.stringify(result)).not.toMatch(/latitude|longitude|distanceMeters/);
  });

  it("bounds drives by days and limit", async () => {
    const { getIntegrationDrives } = await import("./integration-location");
    const limited = await getIntegrationDrives(session, { days: 180, limit: 2, now });
    expect(limited.samples).toHaveLength(2);
    expect(limited.truncated).toBe(true);
    const recent = await getIntegrationDrives(session, { days: 22, limit: 1000, now });
    expect(recent.samples.map((sample) => sample.provenance)).toEqual(["dayframe-location-drive:drive-3"]);
  });

  it("returns no drives for another workspace's token and none of this workspace's for a member", async () => {
    const { getIntegrationDrives } = await import("./integration-location");
    const stranger = await getIntegrationDrives({ ...session, workspaceId: otherWorkspaceId, userId: strangerId }, { days: 180, limit: 1000, now });
    expect(stranger.samples.map((sample) => sample.provenance)).toEqual(["dayframe-location-drive:stranger-drive"]);
    const crossed = await getIntegrationDrives({ ...session, workspaceId: otherWorkspaceId }, { days: 180, limit: 1000, now });
    expect(crossed.samples).toEqual([]);
  });

  it("estimates routes only from at least the minimum of confirmed trips", async () => {
    const { getIntegrationRoutes } = await import("./integration-location");
    const result = await getIntegrationRoutes(session, { days: 180, minSamples: 3, now });
    expect(result.routes).toEqual([expect.objectContaining({
      routeId: `${homeId}:${poolId}:driving`, mode: "driving", sampleCount: 3,
      medianSeconds: 1020, p80Seconds: 1200, minSeconds: 900, maxSeconds: 1200, latestDepartedAt: day(5, 520)
    })]);
    expect((await getIntegrationRoutes(session, { days: 180, minSamples: 4, now })).routes).toEqual([]);
  });

  it("lists stays at saved places only, newest first, with a cursor", async () => {
    const { getIntegrationVisits } = await import("./integration-location");
    const { decodeIntegrationTimeCursor } = await import("./integration-time");
    const first = await getIntegrationVisits(session, { from: "2026-10-24T00:00:00.000Z", to: "2026-10-26T00:00:00.000Z", limit: 5, cursor: null, now });
    expect(first.visits).toEqual([{ id: expect.any(String), place: { id: homeId, name: "Home", role: "home" },
      startedAt: "2026-10-25T09:00:00.000Z", stoppedAt: null, durationSeconds: 3 * 3600 }]);
    const page = await getIntegrationVisits(session, { from: day(1), to: day(4), limit: 2, cursor: null, now });
    expect(page.hasMore).toBe(true);
    const next = await getIntegrationVisits(session, { from: day(1), to: day(4), limit: 2, cursor: decodeIntegrationTimeCursor(page.nextCursor) ?? null, now });
    expect(next.visits.map((visit) => visit.startedAt)).toEqual([day(1, 535), day(1, 400)]);
    expect(next.hasMore).toBe(false);
  });

  it("reports the current saved place and its freshness", async () => {
    const { getIntegrationCurrentPlace } = await import("./integration-location");
    expect(await getIntegrationCurrentPlace(session, now)).toEqual({
      place: { id: homeId, name: "Home", role: "home" }, since: "2026-10-25T09:00:00.000Z", travelling: false,
      observedAt: "2026-10-25T11:50:00.000Z", stale: false });
    const later = await getIntegrationCurrentPlace(session, new Date("2026-10-25T13:00:00.000Z"));
    expect(later.stale).toBe(true);
    expect(await getIntegrationCurrentPlace({ ...session, userId: memberId }, now)).toMatchObject({ observedAt: null, stale: true });
  });

  it("summarises the London day across the clock change, logged entries only", async () => {
    const { getIntegrationTimeSummary } = await import("./integration-summary");
    const summary = await getIntegrationTimeSummary(session, { period: "day", date: null, now });
    expect(summary).toMatchObject({
      date: "2026-10-25", range: { from: "2026-10-24T23:00:00.000Z", to: "2026-10-26T00:00:00.000Z" },
      totalSeconds: 30 * 60 + 3600, entryCount: 2, running: true
    });
    expect(summary.categories).toEqual([
      { id: null, name: null, color: null, seconds: 3600, entryCount: 1 },
      { id: categoryId, name: "Family", color: "rose", seconds: 1800, entryCount: 1 }]);
    const week = await getIntegrationTimeSummary(session, { period: "week", date: "2026-10-21", now });
    expect(week).toMatchObject({ date: "2026-10-19", range: { from: "2026-10-18T23:00:00.000Z", to: "2026-10-26T00:00:00.000Z" } });
  });

  it("counts open Review cards by kind for this user only", async () => {
    const { getIntegrationReviewSummary } = await import("./integration-summary");
    expect(await getIntegrationReviewSummary(session, now)).toEqual({
      ok: true, serverNow: now.toISOString(), workspaceId, openCards: 2,
      byKind: { place: 0, trip: 1, health: 1, other: 0 },
      oldestOpenAt: "2026-10-20T08:00:00.000Z", newestOpenAt: "2026-10-22T08:00:00.000Z"
    });
  });
});
