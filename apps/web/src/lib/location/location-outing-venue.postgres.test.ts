import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { validReviewAcknowledgement } from "@dayframe/shared";
import type { RequestSession } from "../session";

// Run with DAYFRAME_OUTING_VENUE_TEST_DATABASE_URL pointing at a disposable local *_test database (base or ordered
// schema). Synthetic ids, names and Place IDs only. `confirm_outing` with a `venue` ("Visited {name}?" on an unknown
// stay with its trips either side) records the stay as `record_poi_once` does; the trips log as they always did.
const databaseUrl = process.env.DAYFRAME_OUTING_VENUE_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const workspaceId = "68000000-0000-4000-8000-000000000001";
const userId = "68000000-0000-4000-8000-000000000002";
const categoryId = "68000000-0000-4000-8000-000000000201";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:write"] };
const at = (minutes: number) => new Date(Date.parse("2026-10-21T08:00:00.000Z") + minutes * 60_000).toISOString();
const venue = { name: "Synthetic Cafe", applePlaceId: "ISYNTHETICVENUE1" };
let database: pg.Pool | null = null;
let outings = 0;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("confirm_outing with a venue on disposable PostgreSQL", () => {
  const db = () => database!;
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Outing venue integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await db().query("delete from workspaces where id = $1", [workspaceId]);
    await db().query("delete from users where id = $1", [userId]);
    await db().query("insert into users (id, email, name) values ($1, 'outing-venue@example.test', 'O')", [userId]);
    await db().query("insert into workspaces (id, name) values ($1, 'Outing venue')", [workspaceId]);
    await db().query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')", [workspaceId, userId]);
    await db().query("insert into categories (id, workspace_id, name, color) values ($1, $2, 'Errands', 'amber')", [categoryId, workspaceId]);
  });

  afterAll(async () => {
    if (!database) return;
    await db().query("delete from workspaces where id = $1", [workspaceId]);
    await db().query("delete from users where id = $1", [userId]);
    await db().end();
    const { pool } = await import("../db");
    await pool.end();
  });

  /** An unknown stay from +10 to +40 with a trip either side, three open cards on one outing key, a day apart per call. */
  async function outing(ownBlock: [number, number] | null = null) {
    const n = ++outings;
    const base = (n - 1) * 24 * 60;
    const key = `outing-${n}`;
    const stayRow = (await db().query<{ id: string }>(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, algorithm_version, status, started_at, stopped_at, centre, metadata)
       values ($1, $2, $3, 'device-1', 'location-v2.0', 'finalised', $4, $5, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography,
         '{"placeMatchKind":"unknown"}'::jsonb) returning id`,
      [workspaceId, userId, `${key}-stay`, at(base + 10), at(base + 40)])).rows[0].id;
    const homeRow = (await db().query<{ id: string }>(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, algorithm_version, status, started_at, stopped_at, centre, metadata)
       values ($1, $2, $3, 'device-1', 'location-v2.0', 'finalised', $4, $5, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography,
         '{"placeMatchKind":"saved"}'::jsonb) returning id`,
      [workspaceId, userId, `${key}-home`, at(base - 30), at(base)])).rows[0].id;
    const trip = async (name: string, start: number, stop: number, from: string, to: string) => (await db().query<{ id: string }>(
      `insert into commute_segments (workspace_id, user_id, device_id, client_segment_id, algorithm_version, status, started_at, stopped_at,
         from_stay_segment_id, to_stay_segment_id, confidence, metadata)
       values ($1, $2, 'device-1', $3, 'location-v2.0', 'finalised', $4, $5, $6, $7, 'medium', '{}'::jsonb) returning id`,
      [workspaceId, userId, `${key}-${name}`, at(base + start), at(base + stop), from, to])).rows[0].id;
    const ask = async (name: string, segmentId: string, role: string, eventType: string, start: number, stop: number) => {
      const eventId = (await db().query<{ id: string }>(
        `insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
         values ($1, $2, $3, 'location_learning', $4, $5, 'medium', $6::jsonb, 'needs_review') returning id`,
        [workspaceId, userId, `location-segment:${key}-${name}`, eventType, at(base + start),
          JSON.stringify({ clientSegmentId: `${key}-${name}`, outingKey: key, outingRole: role })])).rows[0].id;
      const reviewId = (await db().query<{ id: string }>(
        `insert into review_items (workspace_id, user_id, event_id, location_segment_id, type, title, status, confidence, suggested_started_at,
           suggested_stopped_at, suggested_category_id)
         values ($1, $2, $3, $4, $5, 'Outing', 'open', 'medium', $6, $7, $8) returning id`,
        [workspaceId, userId, eventId, segmentId, eventType, at(base + start), at(base + stop), eventType === "commute_detected" ? categoryId : null])).rows[0].id;
      return { eventId, reviewId };
    };
    const stay = await ask("stay", stayRow, "stay", "unknown_stay", 10, 40);
    const tripIn = await ask("in", await trip("in", 0, 10, homeRow, stayRow), "in", "commute_detected", 0, 10);
    const tripOut = await ask("out", await trip("out", 40, 55, stayRow, homeRow), "out", "commute_detected", 40, 55);
    if (ownBlock) {
      await db().query(`insert into time_entries (workspace_id, user_id, source, description, started_at, stopped_at)
        values ($1, $2, 'manual_app', 'My own block', $3, $4)`, [workspaceId, userId, at(base + ownBlock[0]), at(base + ownBlock[1])]);
    }
    return { base, stayRow, stay, tripIn, tripOut, members: [tripIn.reviewId, tripOut.reviewId] };
  }
  const resolve = async (reviewId: string, action: unknown) =>
    (await import("./location-review-service")).resolveLocationReviewAction(reviewId, action, session);
  const blocks = async (eventId: string) => (await db().query<{ placeLabel: string | null; placeId: string | null; categoryId: string | null; startedAt: Date }>(
    `select place_label as "placeLabel", place_id as "placeId", category_id as "categoryId", started_at as "startedAt"
       from time_entries where created_from_event_id = $1 order by started_at`, [eventId])).rows;
  const statuses = async (ids: string[]) => (await db().query<{ status: string }>(
    `select status from review_items where id = any($1::uuid[])`, [ids])).rows.map((row) => row.status);
  const placeCount = async () => (await db().query<{ count: number }>(`select count(*)::int as count from places where workspace_id = $1`, [workspaceId])).rows[0].count;

  it("logs the stay with the venue's one-time name and Place ID, and the trips as always", async () => {
    const o = await outing();
    const before = await placeCount();
    const result = await resolve(o.stay.reviewId, { action: "confirm_outing", memberReviewItemIds: o.members, venue }) as { status: string; entryIds: string[] };
    expect(result).toMatchObject({ ok: true, action: "confirm_outing", status: "accepted" });
    expect(result.entryIds).toHaveLength(3);
    expect(await statuses([o.stay.reviewId, ...o.members])).toEqual(["accepted", "accepted", "accepted"]);
    expect(await blocks(o.stay.eventId)).toMatchObject([{ placeLabel: venue.name, placeId: null }]);
    expect(await blocks(o.tripIn.eventId)).toMatchObject([{ placeLabel: null, categoryId }]);
    expect(await blocks(o.tripOut.eventId)).toMatchObject([{ placeLabel: null, categoryId }]);
    const stay = await db().query(`select venue_place_id as "venuePlaceId", place_id as "placeId" from stay_segments where id = $1`, [o.stayRow]);
    expect(stay.rows[0]).toEqual({ venuePlaceId: venue.applePlaceId, placeId: null });
    // A one-time name: never a saved place.
    expect(await placeCount()).toBe(before);
  });

  it("a retry with the same venue is the same answer; another venue, or none, is a conflict and changes nothing", async () => {
    const o = await outing();
    const action = { action: "confirm_outing", memberReviewItemIds: o.members, venue };
    await resolve(o.stay.reviewId, action);
    await expect(resolve(o.stay.reviewId, action)).resolves.toMatchObject({ ok: true, status: "accepted", alreadyResolved: true, equivalent: true });
    expect(await blocks(o.stay.eventId)).toHaveLength(1);
    for (const other of [{ ...venue, applePlaceId: "ISYNTHETICVENUE2" }, { ...venue, name: "Another Cafe" }]) {
      await expect(resolve(o.stay.reviewId, { ...action, venue: other })).rejects.toMatchObject({ code: "resolution_conflict" });
    }
    await expect(resolve(o.stay.reviewId, { action: "confirm_outing", memberReviewItemIds: o.members })).rejects.toMatchObject({ code: "resolution_conflict" });
    expect(await blocks(o.stay.eventId)).toMatchObject([{ placeLabel: venue.name }]);
  });

  it("an outing confirmed without a venue refuses a later venue", async () => {
    const o = await outing();
    await resolve(o.stay.reviewId, { action: "confirm_outing", memberReviewItemIds: o.members });
    await expect(resolve(o.stay.reviewId, { action: "confirm_outing", memberReviewItemIds: o.members, venue }))
      .rejects.toMatchObject({ code: "resolution_conflict" });
  });

  it("with an activity the stay logs only your free time; a stay you fully covered logs nothing and the trips still log", async () => {
    const part = await outing([20, 30]);
    const action = { action: "confirm_outing", memberReviewItemIds: part.members, venue, edit: { categoryId } };
    const result = await resolve(part.stay.reviewId, action) as { entryIds: string[] };
    expect(await blocks(part.stay.eventId)).toMatchObject([{ placeLabel: venue.name, categoryId }, { placeLabel: venue.name, categoryId }]);
    expect(result.entryIds).toHaveLength(4);
    await expect(resolve(part.stay.reviewId, action)).resolves.toMatchObject({ alreadyResolved: true, equivalent: true });
    expect(await blocks(part.stay.eventId)).toHaveLength(2);

    const full = await outing([5, 45]);
    const covered = await resolve(full.stay.reviewId, { action: "confirm_outing", memberReviewItemIds: full.members, venue, edit: { categoryId } }) as { status: string; entryIds: string[] };
    expect(covered.status).toBe("accepted");
    expect(covered.entryIds).toHaveLength(2);
    expect(await blocks(full.stay.eventId)).toEqual([]);
    expect(await statuses([full.stay.reviewId, ...full.members])).toEqual(["accepted", "accepted", "accepted"]);
  });

  it("only a stay's card takes a venue, and only confirm_outing", async () => {
    const o = await outing();
    await expect(resolve(o.tripIn.reviewId, { action: "confirm_outing", memberReviewItemIds: [o.stay.reviewId, o.tripOut.reviewId], venue }))
      .rejects.toMatchObject({ code: "invalid_action" });
    await expect(resolve(o.stay.reviewId, { action: "ignore_outing", memberReviewItemIds: o.members, venue })).rejects.toThrow();
    expect(await statuses([o.stay.reviewId, ...o.members])).toEqual(["open", "open", "open"]);
  });

  it("through the durable mutation: the receipt replays, its proof holds, and the same id with another venue is refused", async () => {
    const { resolveIdempotentReviewMutation } = await import("../review-mutation-service");
    const o = await outing();
    const envelope = { clientMutationId: "68000000-0000-4000-8000-0000000000e1",
      mutation: { action: "confirm_outing", memberReviewItemIds: o.members, venue } };
    const first = await resolveIdempotentReviewMutation(o.stay.reviewId, envelope, session);
    expect(validReviewAcknowledgement(first, envelope as never, o.stay.reviewId)).toBe(true);
    await expect(resolveIdempotentReviewMutation(o.stay.reviewId, envelope, session)).resolves.toMatchObject({ status: "accepted" });
    expect(await blocks(o.stay.eventId)).toHaveLength(1);
    await expect(resolveIdempotentReviewMutation(o.stay.reviewId, { ...envelope,
      mutation: { ...envelope.mutation, venue: { ...venue, applePlaceId: "ISYNTHETICVENUE2" } } }, session)).rejects.toBeTruthy();
    expect(await blocks(o.stay.eventId)).toMatchObject([{ placeLabel: venue.name }]);
  });
});
