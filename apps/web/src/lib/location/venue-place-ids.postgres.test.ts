import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
// The service's own pool must point at the disposable database too.
vi.hoisted(() => {
  if (process.env.DAYFRAME_VENUE_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.DAYFRAME_VENUE_TEST_DATABASE_URL;
});

import { pool as servicePool } from "../db";
import type { RequestSession } from "../session";
import { VENUE_HISTORY_RADIUS_METERS, VENUE_HISTORY_SQL } from "./location-query-service";
import { setSuggestedVenue } from "./venue-suggestion-service";

// Run with DAYFRAME_VENUE_TEST_DATABASE_URL pointing at a disposable local *_test database (base
// or ordered schema). Synthetic ids, Place IDs and coordinates only (location v3 PR 8).
const databaseUrl = process.env.DAYFRAME_VENUE_TEST_DATABASE_URL;
const workspaceId = "64000000-0000-4000-8000-000000000001";
const userId = "64000000-0000-4000-8000-000000000002";
const otherUserId = "64000000-0000-4000-8000-000000000003";
const savedPlaceId = "64000000-0000-4000-8000-000000000101";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:write"] };
const otherSession: RequestSession = { workspaceId, userId: otherUserId, authMode: "dev", scopes: ["app:write"] };
let database: pg.Pool | null = null;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("venue Place IDs on disposable PostgreSQL (location v3 PR 8)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Venue Place ID integration tests require a disposable local *_test database.");
    }
    if (servicePool.options.connectionString !== databaseUrl) {
      throw new Error("The app pool is not the disposable test database; run this file in its own worker.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await clear(database);
    await database.query("insert into users (id, email, name) values ($1, 'venue@example.test', 'Venue'), ($2, 'venue-other@example.test', 'Other')",
      [userId, otherUserId]);
    await database.query("insert into workspaces (id, name) values ($1, 'Venue')", [workspaceId]);
    await database.query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'member')",
      [workspaceId, userId, otherUserId]);
    await database.query("insert into places (id, workspace_id, name, latitude, longitude, radius_meters) values ($1, $2, 'Saved spot', 10, 20, 100)",
      [savedPlaceId, workspaceId]);
  });

  afterAll(async () => {
    if (!database) return;
    await clear(database);
    await database.end();
  });

  async function reviewFor(user: string, options: { status?: string; placeId?: string | null; commute?: boolean } = {}) {
    const db = database!;
    // A card whose segment is not a stay (a Move's) never takes a venue.
    const segment = options.commute
      ? "64000000-0000-4000-8000-000000000999"
      : (await db.query<{ id: string }>(
          `insert into stay_segments (workspace_id, user_id, place_id, started_at, stopped_at, centre)
           values ($1, $2, $3, now() - interval '1 hour', now(), ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography) returning id`,
          [workspaceId, user, options.placeId ?? null])).rows[0].id;
    const review = await db.query<{ id: string }>(
      `insert into review_items (workspace_id, user_id, location_segment_id, type, title, suggested_started_at, suggested_stopped_at, confidence, status)
       values ($1, $2, $3, 'location', 'Unknown place', now() - interval '1 hour', now(), 'medium', $4) returning id`,
      [workspaceId, user, segment, options.status ?? "open"]);
    return { reviewId: review.rows[0].id, segmentId: segment };
  }

  const suggestion = async (segmentId: string) => (await database!.query<{ id: string | null }>(
    "select suggested_venue_place_id as id from stay_segments where id = $1", [segmentId])).rows[0]?.id ?? null;

  it("stores and clears a suggestion only on the person's own open, unsaved stay", async () => {
    const open = await reviewFor(userId);
    expect(await setSuggestedVenue(open.reviewId, "ISYNTHETICA", session)).toBe("stored");
    expect(await suggestion(open.segmentId)).toBe("ISYNTHETICA");
    // Unchanged is still a success; null clears it.
    expect(await setSuggestedVenue(open.reviewId, "ISYNTHETICA", session)).toBe("stored");
    expect(await setSuggestedVenue(open.reviewId, null, session)).toBe("stored");
    expect(await suggestion(open.segmentId)).toBeNull();

    // Someone else in the workspace can't set it.
    expect(await setSuggestedVenue(open.reviewId, "ISYNTHETICB", otherSession)).toBeNull();
    expect(await suggestion(open.segmentId)).toBeNull();

    const decided = await reviewFor(userId, { status: "accepted" });
    expect(await setSuggestedVenue(decided.reviewId, "ISYNTHETICC", session)).toBeNull();
    expect(await suggestion(decided.segmentId)).toBeNull();

    const saved = await reviewFor(userId, { placeId: savedPlaceId });
    expect(await setSuggestedVenue(saved.reviewId, "ISYNTHETICD", session)).toBeNull();
    expect(await suggestion(saved.segmentId)).toBeNull();

    const commute = await reviewFor(userId, { commute: true });
    expect(await setSuggestedVenue(commute.reviewId, "ISYNTHETICE", session)).toBeNull();
  });

  it("never lands after a concurrent decision: busy while it is held, refused once it commits (Codex r1 on #519)", async () => {
    const card = await reviewFor(userId);
    const decision = await database!.connect();
    try {
      await decision.query("begin");
      // A decision holds the card's row, as resolveLocationReviewAction does.
      await decision.query("select id from review_items where id = $1 for update", [card.reviewId]);
      expect(await setSuggestedVenue(card.reviewId, "ISYNTHETICRACE", session)).toBe("busy");
      await decision.query("update review_items set status = 'accepted' where id = $1", [card.reviewId]);
      await decision.query("commit");
    } finally {
      decision.release();
    }
    expect(await setSuggestedVenue(card.reviewId, "ISYNTHETICRACE", session)).toBeNull();
    expect(await suggestion(card.segmentId)).toBeNull();
  });

  it("lists venues the person picked within 150 m, newest first, never someone else's, through its index", async () => {
    const client = await database!.connect();
    try {
      await client.query("begin");
      const stay = async (user: string, venue: string | null, east: number, daysAgo: number) => (await client.query<{ id: string }>(
        `insert into stay_segments (workspace_id, user_id, venue_place_id, status, started_at, stopped_at, centre)
         values ($1, $2, $3, 'finalised', now() - ($5 || ' days')::interval - interval '1 hour', now() - ($5 || ' days')::interval,
                 ST_SetSRID(ST_MakePoint(20 + $4 / 109640.0, 10), 4326)::geography) returning id`,
        [workspaceId, user, venue, east, daysAgo])).rows[0].id;
      const current = await stay(userId, null, 0, 0);
      await stay(userId, "INEAROLD", 40, 9);
      await stay(userId, "INEARNEW", 100, 1);
      await stay(userId, "INEAROLD", 60, 3); // the same venue again, more recently
      await stay(userId, "IFAR", 400, 0);
      await stay(otherUserId, "IOTHER", 10, 0);
      const history = async () => (await client.query<{ placeId: string }>(VENUE_HISTORY_SQL,
        [workspaceId, userId, current, 20, 10, VENUE_HISTORY_RADIUS_METERS])).rows.map((row) => row.placeId);
      expect(await history()).toEqual(["INEARNEW", "INEAROLD"]);

      // At scale (mostly stays without a picked venue) the read uses the partial index.
      await client.query(
        `insert into stay_segments (workspace_id, user_id, venue_place_id, started_at, stopped_at, centre)
         select $1, $2, case when n % 50 = 0 then 'IBULK' || n end, now() - n * interval '1 hour', now() - n * interval '1 hour' + interval '20 minutes',
                ST_SetSRID(ST_MakePoint(20 + (n % 300) * 0.01, 10 + (n / 300) * 0.01), 4326)::geography
           from generate_series(1, 6000) n`,
        [workspaceId, otherUserId]);
      await client.query("analyze stay_segments");
      const plan = (await client.query<{ "QUERY PLAN": string }>(`explain ${VENUE_HISTORY_SQL}`,
        [workspaceId, userId, current, 20, 10, VENUE_HISTORY_RADIUS_METERS])).rows.map((row) => row["QUERY PLAN"]).join("\n");
      expect(plan).toContain("idx_stay_segments_venue_history");
    } finally {
      await client.query("rollback");
      client.release();
    }
  }, 30_000);
});

async function clear(db: pg.Pool) {
  await db.query("delete from review_items where workspace_id = $1", [workspaceId]);
  await db.query("delete from stay_segments where workspace_id = $1", [workspaceId]);
  await db.query("delete from places where workspace_id = $1", [workspaceId]);
  await db.query("delete from workspace_members where workspace_id = $1", [workspaceId]);
  await db.query("delete from workspaces where id = $1", [workspaceId]);
  await db.query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
}
