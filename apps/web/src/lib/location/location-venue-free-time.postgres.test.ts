import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { RequestSession } from "../session";

// Run with DAYFRAME_VENUE_FREE_TIME_TEST_DATABASE_URL pointing at a disposable local *_test database (base or
// ordered schema). Synthetic ids, names and Place IDs only. "Visited {name}?" Yes with an activity (Codex r2 on
// #620): `record_poi_once` with a category logs only the time the person's own blocks don't cover.
const databaseUrl = process.env.DAYFRAME_VENUE_FREE_TIME_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const workspaceId = "67000000-0000-4000-8000-000000000001";
const userId = "67000000-0000-4000-8000-000000000002";
const categoryId = "67000000-0000-4000-8000-000000000201";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:write"] };
const at = (minutes: number) => new Date(Date.parse("2026-10-20T08:00:00.000Z") + minutes * 60_000).toISOString();
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("record_poi_once with an activity on disposable PostgreSQL (Codex r2 on #620)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Venue free-time integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = $1", [userId]);
    await database.query("insert into users (id, email, name) values ($1, 'venue-free@example.test', 'V')", [userId]);
    await database.query("insert into workspaces (id, name) values ($1, 'Venue free time')", [workspaceId]);
    await database.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
    await database.query("insert into categories (id, workspace_id, name, color) values ($1, $2, 'Errands', 'amber')", [categoryId, workspaceId]);
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = $1", [workspaceId]);
    await database.query("delete from users where id = $1", [userId]);
    await database.end();
    const { pool } = await import("../db");
    await pool.end();
  });

  /** An unknown stay asking "?" from `start` to `stop` minutes, with the person's own block over `block`, if any. */
  async function stay(segment: string, start: number, stop: number, block: [number, number] | null) {
    const db = database!;
    const event = (await db.query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
       values ($1, $2, $3, 'location_learning', 'unknown_stay', $4, 'medium', $5::jsonb, 'needs_review') returning id`,
      [workspaceId, userId, `location-segment:${segment}`, at(start), JSON.stringify({ clientSegmentId: segment })])).rows[0].id;
    const segmentId = (await db.query<{ id: string }>(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, status, started_at, stopped_at, centre, metadata, created_from_event_id)
       values ($1, $2, $3, 'device-1', 'finalised', $4, $5, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography, '{"placeMatchKind":"unknown"}'::jsonb, $6)
       returning id`,
      [workspaceId, userId, segment, at(start), at(stop), event])).rows[0].id;
    const reviewId = (await db.query<{ id: string }>(
      `insert into review_items (workspace_id, user_id, event_id, location_segment_id, type, title, suggested_started_at, suggested_stopped_at,
         confidence, status)
       values ($1, $2, $3, $4, 'unknown_stay', 'Unknown place', $5, $6, 'medium', 'open') returning id`,
      [workspaceId, userId, event, segmentId, at(start), at(stop)])).rows[0].id;
    if (block) {
      await db.query(
        `insert into time_entries (workspace_id, user_id, source, description, started_at, stopped_at)
         values ($1, $2, 'manual_app', 'My own block', $3, $4)`, [workspaceId, userId, at(block[0]), at(block[1])]);
    }
    return { event, segmentId, reviewId };
  }

  const blocksFrom = async (event: string) => (await database!.query<{ startedAt: Date; stoppedAt: Date; categoryId: string; placeLabel: string; placeId: string | null }>(
    `select started_at as "startedAt", stopped_at as "stoppedAt", category_id as "categoryId", place_label as "placeLabel", place_id as "placeId"
       from time_entries where created_from_event_id = $1 order by started_at`, [event])).rows
    .map((row) => ({ ...row, startedAt: row.startedAt.toISOString(), stoppedAt: row.stoppedAt.toISOString() }));
  const action = { action: "record_poi_once", name: "Exampleton Bakery", applePlaceId: "ISYNTHETICBAKERY", edit: { categoryId } };

  it("fills only the gaps around the person's own block, with the name, and is acknowledged once on a retry", async () => {
    const { resolveLocationReviewAction } = await import("./location-review-service");
    const card = await stay("seg-part", 0, 60, [10, 20]);
    const first = await resolveLocationReviewAction(card.reviewId, action, session);
    expect(first).toMatchObject({ ok: true, status: "accepted" });
    const blocks = await blocksFrom(card.event);
    expect(blocks).toEqual([
      { startedAt: at(0), stoppedAt: at(10), categoryId, placeLabel: "Exampleton Bakery", placeId: null },
      { startedAt: at(20), stoppedAt: at(60), categoryId, placeLabel: "Exampleton Bakery", placeId: null }
    ]);
    const decided = await database!.query(
      `select ri.status, ae.review_status as "eventStatus", ae.raw_payload ->> 'semanticDisposition' as disposition,
              ae.raw_payload ->> 'recordedPlaceLabel' as label, ss.venue_place_id as venue
         from review_items ri join activity_events ae on ae.id = ri.event_id join stay_segments ss on ss.id = ri.location_segment_id
        where ri.id = $1`, [card.reviewId]);
    expect(decided.rows[0]).toEqual({ status: "accepted", eventStatus: "confirmed", disposition: "logged_by_you",
      label: "Exampleton Bakery", venue: "ISYNTHETICBAKERY" });
    // The same answer again (a retry after a lost reply): acknowledged, no second set of blocks.
    const retry = await resolveLocationReviewAction(card.reviewId, action, session);
    expect(retry).toMatchObject({ ok: true, alreadyResolved: true, equivalent: true });
    expect(await blocksFrom(card.event)).toEqual(blocks);
  });

  it("makes no block for a fully covered stay, yet records the name and closes the \"?\"", async () => {
    const { resolveLocationReviewAction } = await import("./location-review-service");
    const card = await stay("seg-full", 120, 150, [110, 160]);
    expect(await resolveLocationReviewAction(card.reviewId, action, session)).toMatchObject({ ok: true, status: "accepted", entryIds: [] });
    expect(await blocksFrom(card.event)).toEqual([]);
    const decided = await database!.query(
      `select ri.status, ae.raw_payload ->> 'recordedPlaceLabel' as label from review_items ri join activity_events ae on ae.id = ri.event_id
        where ri.id = $1`, [card.reviewId]);
    expect(decided.rows[0]).toEqual({ status: "accepted", label: "Exampleton Bakery" });
    expect(await resolveLocationReviewAction(card.reviewId, action, session)).toMatchObject({ alreadyResolved: true });
    expect(await blocksFrom(card.event)).toEqual([]);
  });

  it("keeps the whole stay without an activity, as before", async () => {
    const { resolveLocationReviewAction } = await import("./location-review-service");
    const card = await stay("seg-plain", 200, 230, [205, 210]);
    await resolveLocationReviewAction(card.reviewId, { action: "record_poi_once", name: "Exampleton Bakery" }, session);
    expect((await blocksFrom(card.event)).map((block) => [block.startedAt, block.stoppedAt, block.placeLabel]))
      .toEqual([[at(200), at(230), "Exampleton Bakery"]]);
  });
});
