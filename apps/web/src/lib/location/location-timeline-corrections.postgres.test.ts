import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { RequestSession } from "../session";

// Run with DAYFRAME_CORRECTIONS_TEST_DATABASE_URL pointing at a disposable local *_test database
// (base or ordered schema). Synthetic ids and coordinates only. Location v4 step 11.
const databaseUrl = process.env.DAYFRAME_CORRECTIONS_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const workspaceId = "66000000-0000-4000-8000-000000000001";
const userId = "66000000-0000-4000-8000-000000000002";
const otherWorkspaceId = "66000000-0000-4000-8000-000000000011";
const homeId = "66000000-0000-4000-8000-000000000101";
const otherPlaceId = "66000000-0000-4000-8000-000000000102";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read"] };
const at = (minutes: number) => new Date(Date.parse("2026-10-20T00:00:00.000Z") + minutes * 60_000).toISOString();
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("timeline corrections on disposable PostgreSQL (location v4 step 11)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Timeline correction integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    const db = database;
    await db.query("delete from workspaces where id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
    await db.query("delete from users where id = $1", [userId]);
    await db.query("insert into users (id, email, name) values ($1, 'corrections@example.test', 'C')", [userId]);
    await db.query("insert into workspaces (id, name) values ($1, 'Corrections'), ($2, 'Other')", [workspaceId, otherWorkspaceId]);
    await db.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
    await db.query(
      `insert into places (id, workspace_id, name, latitude, longitude, radius_meters) values ($1, $2, 'Home', 10, 20, 100), ($3, $4, 'Elsewhere', 11, 21, 100)`,
      [homeId, workspaceId, otherPlaceId, otherWorkspaceId]);
    const stay = async (segmentId: string, start: number, stop: number | null) => (await db.query<{ id: string }>(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, status, started_at, stopped_at, centre, metadata)
       values ($1, $2, $3, 'device-1', 'finalised', $4, $5, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography, '{"placeMatchKind":"unknown"}'::jsonb)
       returning id`,
      [workspaceId, userId, segmentId, at(start), stop == null ? null : at(stop)])).rows[0].id;
    const first = await stay("seg-a", 0, 480);
    const second = await stay("seg-b", 520, 700);
    const third = await stay("seg-c", 760, null);
    const trip = async (segmentId: string, start: number, stop: number, from: string, to: string) => (await db.query<{ id: string }>(
      `insert into commute_segments (workspace_id, user_id, device_id, client_segment_id, algorithm_version, status, started_at, stopped_at,
         from_stay_segment_id, to_stay_segment_id, confidence, metadata)
       values ($1, $2, 'device-1', $3, 'location-v2.0', 'finalised', $4, $5, $6, $7, 'medium', $8::jsonb) returning id`,
      [workspaceId, userId, segmentId, at(start), at(stop), from, to, JSON.stringify({ legs: [
        { startedAt: at(start), stoppedAt: at(start + 10), mode: "walking", confidence: "sure", distanceMeters: 700 },
        { startedAt: at(start + 10), stoppedAt: at(stop), mode: "automotive", confidence: "unsure", runnerUp: "bus", distanceMeters: 9000 }] })])).rows[0].id;
    const firstTrip = await trip("trip-1", 480, 520, first, second);
    const secondTrip = await trip("trip-2", 700, 760, second, third);
    // The second trip's open Review suggestion, and a block made from the first trip.
    const reviewEvent = (await db.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
       values ($1, $2, 'location_learning', 'commute_detected', $3, 'medium', '{"clientSegmentId":"trip-2"}'::jsonb, 'needs_review') returning id`,
      [workspaceId, userId, at(700)])).rows[0].id;
    await db.query(
      `insert into review_items (workspace_id, user_id, event_id, location_segment_id, type, title, status)
       values ($1, $2, $3, $4, 'commute', 'Trip', 'open')`, [workspaceId, userId, reviewEvent, secondTrip]);
    const blockEvent = (await db.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
       values ($1, $2, 'location_learning', 'commute_detected', $3, 'medium', '{"clientSegmentId":"trip-1"}'::jsonb) returning id`,
      [workspaceId, userId, at(480)])).rows[0].id;
    await db.query(
      `insert into time_entries (workspace_id, user_id, source, started_at, stopped_at, created_from_event_id)
       values ($1, $2, 'location_learning', $3, $4, $5)`, [workspaceId, userId, at(480), at(520), blockEvent]);
    // An open Review suggestion for the first place: its event, no block (Codex r1 on #566).
    const suggestion = (await db.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
       values ($1, $2, 'location_learning', 'unknown_stay', $3, 'low', '{"clientSegmentId":"seg-a"}'::jsonb, 'needs_review') returning id`,
      [workspaceId, userId, at(0)])).rows[0].id;
    await db.query(`update stay_segments set created_from_event_id = $1 where id = $2`, [suggestion, first]);
    await db.query(
      `insert into review_items (workspace_id, user_id, event_id, location_segment_id, type, title, status)
       values ($1, $2, $3, $4, 'unknown_stay', 'Unknown place', 'open')`, [workspaceId, userId, suggestion, first]);
    expect(firstTrip).toBeTruthy();
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
    await database.query("delete from users where id = $1", [userId]);
    await database.end();
    const { pool } = await import("../db");
    await pool.end();
  });

  it("sets a place event-first, marks it as set by you, and a newer correction of it replaces the older", async () => {
    const { correctLocationTimeline } = await import("./location-timeline-corrections");
    const first = await correctLocationTimeline({ kind: "place", subject: "place", itemId: "seg-b", placeId: homeId, learnedPlaceId: null }, session);
    expect(first.correction).toMatchObject({ subject: "place", kind: "place", spanStartedAt: at(520), spanStoppedAt: at(700),
      target: { placeId: homeId, learnedPlaceId: null } });
    const second = await correctLocationTimeline({ kind: "place", subject: "place", itemId: "seg-b", placeId: null, learnedPlaceId: null }, session);
    const rows = await database!.query<{ id: string; replacedById: string | null; eventType: string; label: string | null }>(
      `select c.id, c.replaced_by_id as "replacedById", e.event_type as "eventType", e.raw_payload ->> 'itemId' as label
         from location_timeline_corrections c join activity_events e on e.id = c.created_from_event_id
        where c.workspace_id = $1 order by c.created_at, c.id`, [workspaceId]);
    expect(rows.rows).toEqual([
      { id: first.correction.id, replacedById: second.correction.id, eventType: "timeline_correction", label: "seg-b" },
      { id: second.correction.id, replacedById: null, eventType: "timeline_correction", label: "seg-b" }
    ]);
    const stay = await database!.query(`select place_id as "placeId", metadata from stay_segments where client_segment_id = 'seg-b' and workspace_id = $1`, [workspaceId]);
    expect(stay.rows[0]).toMatchObject({ placeId: null, metadata: { placeMatchKind: "unknown", setByYou: true } });
    const { getLocationTimeline } = await import("./location-timeline-service");
    const timeline = await getLocationTimeline(session, { date: "2026-10-20", timeZone: "UTC", now: new Date(at(1_000)) });
    expect(timeline.items.find((item) => item.id === "seg-b")).toMatchObject({ setByYou: true });
    expect(timeline.items.find((item) => item.id === "seg-a")).not.toHaveProperty("setByYou");
  });

  it("refuses another workspace's place, an item that isn't there, and a trip that already has a block", async () => {
    const { correctLocationTimeline } = await import("./location-timeline-corrections");
    await expect(correctLocationTimeline({ kind: "place", subject: "place", itemId: "seg-a", placeId: otherPlaceId, learnedPlaceId: null }, session))
      .rejects.toMatchObject({ status: 422 });
    await expect(correctLocationTimeline({ kind: "delete", subject: "trip", itemId: "trip-missing" }, session)).rejects.toMatchObject({ status: 404 });
    await expect(correctLocationTimeline({ kind: "delete", subject: "trip", itemId: "trip-1" }, session)).rejects.toMatchObject({ status: 409 });
    // A leg's mode on a trip that is a block is still the person's to set.
    const leg = await correctLocationTimeline({ kind: "leg_mode", subject: "leg", itemId: "trip-1", legStartedAt: at(480), legStoppedAt: at(490), mode: "running" }, session);
    expect(leg.correction).toMatchObject({ subject: "leg", kind: "leg_mode", target: { mode: "running" } });
    await expect(correctLocationTimeline({ kind: "times", subject: "place", itemId: "seg-a", startedAt: at(900), stoppedAt: at(950) }, session))
      .rejects.toMatchObject({ status: 422 });
  });

  it("sets a leg's mode, and a place's times", async () => {
    const { correctLocationTimeline } = await import("./location-timeline-corrections");
    await correctLocationTimeline({ kind: "leg_mode", subject: "leg", itemId: "trip-2", legStartedAt: at(710), legStoppedAt: at(760), mode: "bus" }, session);
    const trip = await database!.query<{ metadata: { legs: unknown[] } }>(
      `select metadata from commute_segments where client_segment_id = 'trip-2' and workspace_id = $1`, [workspaceId]);
    expect(trip.rows[0].metadata.legs).toEqual([
      { startedAt: at(700), stoppedAt: at(710), mode: "walking", confidence: "sure", distanceMeters: 700 },
      { startedAt: at(710), stoppedAt: at(760), mode: "bus", confidence: "sure", distanceMeters: 9000, setByYou: true }
    ]);
    await expect(correctLocationTimeline({ kind: "leg_mode", subject: "leg", itemId: "trip-2", legStartedAt: at(705), legStoppedAt: at(760), mode: "bus" }, session))
      .rejects.toMatchObject({ status: 404 });
    await correctLocationTimeline({ kind: "times", subject: "place", itemId: "seg-a", startedAt: at(10), stoppedAt: at(470) }, session);
    const stay = await database!.query(`select started_at as "startedAt", stopped_at as "stoppedAt", metadata from stay_segments where client_segment_id = 'seg-a' and workspace_id = $1`, [workspaceId]);
    expect(stay.rows[0]).toMatchObject({ startedAt: new Date(at(10)), stoppedAt: new Date(at(470)), metadata: { setByYou: true } });
  });

  it("takes a trip that wasn't one off the timeline, with its open Review suggestion", async () => {
    const { correctLocationTimeline } = await import("./location-timeline-corrections");
    await correctLocationTimeline({ kind: "delete", subject: "trip", itemId: "trip-2" }, session);
    const trip = await database!.query(`select status from commute_segments where client_segment_id = 'trip-2' and workspace_id = $1`, [workspaceId]);
    expect(trip.rows[0].status).toBe("superseded");
    const review = await database!.query(
      `select ri.type, ri.status, ri.ignored_scope as "scope", e.review_status as "eventStatus" from review_items ri join activity_events e on e.id = ri.event_id
        where ri.workspace_id = $1 order by ri.type`, [workspaceId]);
    expect(review.rows).toEqual([{ type: "commute", status: "ignored", scope: "superseded", eventStatus: "ignored" },
      { type: "unknown_stay", status: "open", scope: null, eventStatus: "needs_review" }]);
  });

  it("applies the active corrections to replay's segments, and never stores coordinates", async () => {
    const { withTimelineCorrections } = await import("./location-timeline-corrections");
    const client = await database!.connect();
    try {
      const segments = [
        { kind: "stay", clientSegmentId: "seg-a", startedAt: at(0), stoppedAt: at(480), placeId: null, learnedPlaceId: null, placeMatchKind: "unknown" },
        { kind: "commute", clientSegmentId: "trip-2", startedAt: at(700), stoppedAt: at(760) }
      ] as Parameters<typeof withTimelineCorrections>[2];
      const corrected = await withTimelineCorrections(client, session, segments, at(1_000));
      expect(corrected.map((segment) => [segment.clientSegmentId, segment.startedAt, segment.stoppedAt, "setByYou" in segment]))
        .toEqual([["seg-a", at(10), at(470), true]]);
      await expect(client.query(
        `insert into location_timeline_corrections (workspace_id, user_id, subject, kind, span_started_at, span_stopped_at, target)
         values ($1, $2, 'place', 'place', $3, $4, '{"latitude": 51}'::jsonb)`, [workspaceId, userId, at(0), at(10)])).rejects.toThrow();
    } finally {
      client.release();
    }
  });
  it("ties a correction to its own item's engine span, never a neighbour's (Codex r1 on #566)", async () => {
    const { correctLocationTimeline } = await import("./location-timeline-corrections");
    // The first place (engine span 0–480, corrected earlier) now stretches into the second (520–700).
    await correctLocationTimeline({ kind: "times", subject: "place", itemId: "seg-a", startedAt: at(10), stoppedAt: at(560) }, session);
    const neighbour = await correctLocationTimeline({ kind: "place", subject: "place", itemId: "seg-b", placeId: homeId, learnedPlaceId: null }, session);
    const own = await correctLocationTimeline({ kind: "place", subject: "place", itemId: "seg-a", placeId: homeId, learnedPlaceId: null }, session);
    expect(own.correction).toMatchObject({ spanStartedAt: at(0), spanStoppedAt: at(480) });
    const kept = await database!.query(`select replaced_at from location_timeline_corrections where id = $1`, [neighbour.correction.id]);
    expect(kept.rows[0].replaced_at).toBeNull();
  });
  it("offers the corrected place and times in the open Review suggestion, routes the trip from it, and skips a deleted place on replay (Codex r2 on #566)", async () => {
    const db = database!;
    // The first place's open suggestion now offers Home, from 00:10 to 09:20 (its last corrections).
    const suggestion = await db.query(`select suggested_place_id as "placeId", title, suggested_started_at as "startedAt",
        suggested_stopped_at as "stoppedAt" from review_items where workspace_id = $1 and type = 'unknown_stay'`, [workspaceId]);
    expect(suggestion.rows[0]).toMatchObject({ placeId: homeId, title: "Home", startedAt: new Date(at(10)), stoppedAt: new Date(at(560)) });
    const event = await db.query(`select e.suggested_place_id as "placeId" from activity_events e join review_items ri on ri.event_id = e.id
        where ri.workspace_id = $1 and ri.type = 'unknown_stay'`, [workspaceId]);
    expect(event.rows[0].placeId).toBe(homeId);
    const trip = await db.query(`select from_place_id as "fromPlaceId" from commute_segments where workspace_id = $1 and client_segment_id = 'trip-1'`, [workspaceId]);
    expect(trip.rows[0].fromPlaceId).toBe(homeId);

    // A place the person picked, then deleted: replay skips that correction instead of writing a missing place back.
    const { correctLocationTimeline, withTimelineCorrections } = await import("./location-timeline-corrections");
    const gone = "66000000-0000-4000-8000-000000000103";
    await db.query(`insert into places (id, workspace_id, name, latitude, longitude, radius_meters) values ($1, $2, 'Gone', 12, 22, 100)`, [gone, workspaceId]);
    await correctLocationTimeline({ kind: "place", subject: "place", itemId: "seg-c", placeId: gone, learnedPlaceId: null }, session);
    await db.query(`update stay_segments set place_id = null where place_id = $1`, [gone]);
    await db.query(`delete from places where id = $1`, [gone]);
    const client = await db.connect();
    try {
      const replayed = await withTimelineCorrections(client, session, [
        { kind: "stay", clientSegmentId: "seg-c", startedAt: at(760), stoppedAt: null, placeId: null, learnedPlaceId: null, placeMatchKind: "unknown" }
      ] as Parameters<typeof withTimelineCorrections>[2], at(1_000));
      expect(replayed[0]).toMatchObject({ placeId: null });
    } finally {
      client.release();
    }
  });
});
