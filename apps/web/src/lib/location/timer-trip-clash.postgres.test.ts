import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { RequestSession } from "../session";

// Run with DAYFRAME_TIMER_TRIP_TEST_DATABASE_URL pointing at a disposable local *_test database (ordered
// schema). Synthetic ids only. A timer left running into a trip (location v4 design §7).
const databaseUrl = process.env.DAYFRAME_TIMER_TRIP_TEST_DATABASE_URL;
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
process.env.DAYFRAME_TIMER_TRIP_CHECKS = "on";
const workspaceId = "67000000-0000-4000-8000-000000000001";
const userId = "67000000-0000-4000-8000-000000000002";
const otherWorkspaceId = "67000000-0000-4000-8000-000000000011";
const otherUserId = "67000000-0000-4000-8000-000000000012";
const commuteId = "67000000-0000-4000-8000-000000000201";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read", "app:write"] };
const otherSession: RequestSession = { workspaceId: otherWorkspaceId, userId: otherUserId, authMode: "dev", scopes: ["app:read", "app:write"] };
const at = (minutes: number) => new Date(Date.parse("2026-10-27T00:00:00.000Z") + minutes * 60_000).toISOString();
const now = at(24 * 60);
const window = { from: at(-60), to: now };
let database: pg.Pool | null = null;
let mutation = 0;
const envelope = (action: "accept" | "ignore_once") => ({
  clientMutationId: `67000000-0000-4000-8000-${String(900_000_000_000 + ++mutation)}`, mutation: { action }
});

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("timer runs into a trip on disposable PostgreSQL (location v4 design §7)", () => {
  const db = () => database!;
  // A block a timer started (the server marks its Start event), unless `byHand`.
  const block = async (start: number, stop: number | null,
    extra: { categoryId?: string; description?: string; source?: string; byHand?: boolean } = {}) => {
    const startEvent = extra.byHand ? null : (await db().query<{ id: string }>(
      `insert into activity_events (workspace_id, user_id, source, event_type, occurred_at, confidence, raw_payload)
       values ($1, $2, 'mobile_app', 'timer_start', $3, 'high', '{"serverTimerStart": true}'::jsonb) returning id`,
      [workspaceId, userId, at(start)])).rows[0].id;
    return (await db().query<{ id: string }>(
      `insert into time_entries (workspace_id, user_id, source, category_id, description, started_at, stopped_at, created_from_event_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [workspaceId, userId, extra.source ?? "manual_app", extra.categoryId ?? null, extra.description ?? "Team sync", at(start),
        stop == null ? null : at(stop), startEvent])).rows[0].id;
  };
  const question = async (entryId: string) => (await db().query<{
    id: string; status: string; title: string; suggestedStartedAt: Date; suggestedStoppedAt: Date; payload: Record<string, unknown>;
  }>(
    `select ri.id, ri.status, ri.title, ri.suggested_started_at as "suggestedStartedAt", ri.suggested_stopped_at as "suggestedStoppedAt",
            ae.raw_payload as payload
       from activity_events ae join review_items ri on ri.event_id = ae.id
      where ae.workspace_id = $1 and ae.client_event_id = $2`, [workspaceId, `timer-trip-clash:${entryId}`])).rows[0];
  const reconcile = async (scope: { from: string; to: string } | { entryIds: string[] }, owner = session) => {
    const { reconcileTimerTripClashes } = await import("./timer-trip-clash-service");
    const client = await db().connect();
    try {
      await client.query("begin");
      const changes = await reconcileTimerTripClashes(client, owner, scope, now);
      await client.query("commit");
      return changes;
    } finally {
      client.release();
    }
  };

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Timer-trip integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 3 });
    await db().query("delete from workspaces where id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
    await db().query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
    await db().query("insert into users (id, email, name) values ($1, 'timer-trip@example.test', 'T'), ($2, 'other@example.test', 'O')",
      [userId, otherUserId]);
    await db().query("insert into workspaces (id, name) values ($1, 'Timer trip'), ($2, 'Other')", [workspaceId, otherWorkspaceId]);
    await db().query("insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner'), ($3, $4, 'owner')",
      [workspaceId, userId, otherWorkspaceId, otherUserId]);
    await db().query(`insert into categories (id, workspace_id, name, color, starter_key) values ($1, $2, 'Commute', 'graphite', 'commute')`,
      [commuteId, workspaceId]);
    const stay = async (segmentId: string, start: number, stop: number | null) => (await db().query<{ id: string }>(
      `insert into stay_segments (workspace_id, user_id, client_segment_id, device_id, status, started_at, stopped_at, centre, metadata)
       values ($1, $2, $3, 'device-1', 'finalised', $4, $5, ST_SetSRID(ST_MakePoint(20, 10), 4326)::geography, '{"placeMatchKind":"unknown"}'::jsonb)
       returning id`,
      [workspaceId, userId, segmentId, at(start), stop == null ? null : at(stop)])).rows[0].id;
    const work = await stay("seg-work", 480, 862);
    const home = await stay("seg-home", 890, null);
    // The trip home: 14:22 to 14:50.
    await db().query(
      `insert into commute_segments (workspace_id, user_id, device_id, client_segment_id, algorithm_version, status, started_at, stopped_at,
         from_stay_segment_id, to_stay_segment_id, confidence)
       values ($1, $2, 'device-1', 'trip-home', 'location-v2.0', 'finalised', $3, $4, $5, $6, 'medium')`,
      [workspaceId, userId, at(862), at(890), work, home]);
  });

  afterAll(async () => {
    if (!database) return;
    await database.query("delete from workspaces where id = any($1::uuid[])", [[workspaceId, otherWorkspaceId]]);
    await database.query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
    await database.end();
    const { pool } = await import("../db");
    await pool.end();
  });

  it("asks once on a block that ran into the trip, event first, and not for one started on the way or a Commute", async () => {
    const ranInto = await block(780, 880);
    const startedOnTheWay = await block(865, 880, { description: "Podcast" });
    const commute = await block(780, 880, { categoryId: commuteId, description: null as unknown as string });
    const health = await block(780, 880, { source: "health_workout" });
    const byHand = await block(780, 880, { description: "Added later", byHand: true });
    expect(await reconcile(window)).toBe(1);
    expect(await question(ranInto)).toMatchObject({
      status: "open", title: "Team sync ran 18m into your trip",
      suggestedStartedAt: new Date(at(780)), suggestedStoppedAt: new Date(at(862)),
      payload: { timeEntryId: ranInto, tripId: "trip-home", tripStartedAt: at(862), tripStoppedAt: at(890), overlapSeconds: 18 * 60 }
    });
    for (const id of [startedOnTheWay, commute, health, byHand]) expect(await question(id)).toBeUndefined();
    // Idempotent: nothing changed, nothing written; another account sees nothing.
    expect(await reconcile(window)).toBe(0);
    expect(await reconcile(window, otherSession)).toBe(0);
    const type = await db().query(`select type, location_segment_id from review_items where id = $1`, [(await question(ranInto)).id]);
    expect(type.rows[0]).toEqual({ type: "location_timer_trip_clash", location_segment_id: null });
    await db().query(`delete from time_entries where id = any($1::uuid[])`, [[startedOnTheWay, commute, health, byHand]]);
  });

  it("a block you already edited keeps asking until you set its end; an end you set never asks again", async () => {
    const { updateTimeEntry } = await import("../event-service");
    const id = await block(700, 900, { description: "Deep work" });
    await reconcile({ entryIds: [id] });
    expect((await question(id)).status).toBe("open");
    // A title edit is not an end you chose: the question stays, with the new name.
    await updateTimeEntry(id, { description: "Focus" }, session);
    expect(await question(id)).toMatchObject({ status: "open", title: "Focus ran 28m into your trip" });
    // Setting the end yourself (even still into the trip) is your answer: it retires, and stays retired.
    await updateTimeEntry(id, { stoppedAt: at(875) }, session);
    expect((await question(id)).status).toBe("superseded");
    await reconcile(window);
    expect((await question(id)).status).toBe("superseded");
  });

  it("a retired question comes back when its block runs into the trip again, and a move activity never asks", async () => {
    const { updateTimeEntry } = await import("../event-service");
    const id = await block(705, 900, { description: "Admin" });
    await reconcile({ entryIds: [id] });
    await db().query(`update commute_segments set started_at = $2, stopped_at = $3 where workspace_id = $1 and client_segment_id = 'trip-home'`, [workspaceId, at(950), at(980)]);
    await reconcile(window);
    expect((await question(id)).status).toBe("superseded");
    await db().query(`update commute_segments set started_at = $2, stopped_at = $3 where workspace_id = $1 and client_segment_id = 'trip-home'`, [workspaceId, at(862), at(890)]);
    await reconcile(window);
    expect(await question(id)).toMatchObject({ status: "open", title: "Admin ran 28m into your trip" });
    // A move activity merges with the trip instead (step 16): no question.
    await updateTimeEntry(id, { categoryId: commuteId }, session);
    expect((await question(id)).status).toBe("superseded");
  });

  it("End it moves a finished block's end to where the trip started, as your edit", async () => {
    const { resolveIdempotentReviewMutation } = await import("../review-mutation-service");
    const id = await block(790, 885, { description: "Planning" });
    await reconcile({ entryIds: [id] });
    const result = await resolveIdempotentReviewMutation((await question(id)).id, envelope("accept"), session);
    expect(result).toMatchObject({ ok: true, status: "accepted", entryId: id, endedAt: at(862) });
    expect(result).not.toHaveProperty("stoppedRunningTimer");
    const entry = await db().query(
      `select te.stopped_at as "stoppedAt",
              exists (select 1 from audit_log a where a.entity_id = te.id and a.action = 'time_entry.end_set') as "endSet"
         from time_entries te where te.id = $1`, [id]);
    expect(entry.rows[0]).toEqual({ stoppedAt: new Date(at(862)), endSet: true });
  });

  it("End it stops a running timer where the trip started, once; a resend is the same answer and Keep it then conflicts", async () => {
    const { resolveIdempotentReviewMutation } = await import("../review-mutation-service");
    const id = await block(800, null, { description: "Writing" });
    await reconcile(window);
    const item = await question(id);
    expect(item.title).toBe("Writing ran 28m into your trip");
    const answer = envelope("accept");
    const result = await resolveIdempotentReviewMutation(item.id, answer, session);
    expect(result).toMatchObject({ ok: true, status: "accepted", entryId: id, endedAt: at(862), stoppedRunningTimer: true });
    const link = await db().query(`select resolved_time_entry_id as "entryId" from activity_events where client_event_id = $1`,
      [`timer-trip-clash:${id}`]);
    expect(link.rows[0].entryId).toBe(id);
    const entry = await db().query(`select stopped_at as "stoppedAt", user_edited_at is not null as "edited" from time_entries where id = $1`, [id]);
    expect(entry.rows[0]).toEqual({ stoppedAt: new Date(at(862)), edited: true });
    expect(await resolveIdempotentReviewMutation(item.id, answer, session)).toEqual(result);
    await expect(resolveIdempotentReviewMutation(item.id, envelope("ignore_once"), session)).rejects.toMatchObject({ code: expect.any(String) });
    // Answered questions are never reopened or retired by later passes.
    await reconcile(window);
    expect((await question(id)).status).toBe("accepted");
  });

  it("a Stop queued offline before the trip, delivered after it was asked, retires the question", async () => {
    const { processActivityEvent } = await import("../event-service");
    const id = await block(805, null, { description: "Design review" });
    await reconcile({ entryIds: [id] });
    expect((await question(id)).status).toBe("open");
    const result = await processActivityEvent({
      clientEventId: "timer-trip-late-stop", occurredAt: at(860), source: "mobile_app", type: "timer_stop",
      rawPayload: { origin: "mobile_timer_stop", stopScope: "entry", targetEntryId: id }
    }, session);
    expect(result).toMatchObject({ stopOutcome: "stopped", timeEntryId: id });
    expect((await question(id)).status).toBe("superseded");
  });

  it("Keep it leaves the block as it is and never asks again; the legacy plain accept is refused", async () => {
    const { resolveIdempotentReviewMutation } = await import("../review-mutation-service");
    const { resolveReviewItem } = await import("../event-service");
    const id = await block(810, 950, { description: "Reading" });
    await reconcile({ entryIds: [id] });
    const item = await question(id);
    await expect(resolveReviewItem(item.id, "accept", session)).rejects.toMatchObject({ code: "invalid_action" });
    expect(await resolveIdempotentReviewMutation(item.id, envelope("ignore_once"), session)).toMatchObject({ ok: true, status: "ignored" });
    const entry = await db().query(`select stopped_at as "stoppedAt" from time_entries where id = $1`, [id]);
    expect(entry.rows[0].stoppedAt).toEqual(new Date(at(950)));
    await reconcile(window);
    expect((await question(id)).status).toBe("ignored");
    // Another account can't answer it.
    await expect(resolveIdempotentReviewMutation(item.id, envelope("accept"), otherSession)).rejects.toMatchObject({ code: "review_item_not_found" });
  });

  it("deleting the block, or the trip going (I didn't leave), retires its question", async () => {
    const { deleteTimeEntry } = await import("../event-service");
    const deleted = await block(820, 900, { description: "Calls" });
    const stays = await block(825, 900, { description: "Notes" });
    await reconcile(window);
    expect((await question(deleted)).status).toBe("open");
    await deleteTimeEntry(deleted, session);
    expect((await question(deleted)).status).toBe("superseded");
    expect((await question(stays)).status).toBe("open");
    await db().query(`update commute_segments set status = 'superseded' where workspace_id = $1 and client_segment_id = 'trip-home'`, [workspaceId]);
    await reconcile(window);
    expect((await question(stays)).status).toBe("superseded");    await db().query(`update commute_segments set status = 'finalised' where workspace_id = $1 and client_segment_id = 'trip-home'`, [workspaceId]);
    await db().query(`delete from time_entries where id = $1`, [stays]);
  });
  it("End it is refused for a changed proposal or a trip a correction removed, and changes nothing", async () => {
    const { resolveIdempotentReviewMutation } = await import("../review-mutation-service");
    const id = await block(815, 960, { description: "Sprint" });
    await reconcile({ entryIds: [id] });
    const item = await question(id);
    const stale = { ...envelope("accept"), mutation: { action: "accept" as const, expectedProposalHash: "0".repeat(64) } };
    await expect(resolveIdempotentReviewMutation(item.id, stale, session)).rejects.toMatchObject({ code: "proposal_changed" });
    await db().query(`update commute_segments set status = 'superseded' where workspace_id = $1 and client_segment_id = 'trip-home'`, [workspaceId]);
    await expect(resolveIdempotentReviewMutation(item.id, envelope("accept"), session)).rejects.toMatchObject({ code: "proposal_changed" });
    const entry = await db().query(`select stopped_at as "stoppedAt" from time_entries where id = $1`, [id]);
    expect(entry.rows[0].stoppedAt).toEqual(new Date(at(960)));
    expect((await question(id)).status).toBe("open");
    await db().query(`update commute_segments set status = 'finalised' where workspace_id = $1 and client_segment_id = 'trip-home'`, [workspaceId]);
  });

  it("an edit waiting behind Keep it never reopens the question (Codex r1 on #611)", async () => {
    const { updateTimeEntry } = await import("../event-service");
    const id = await block(830, 940, { description: "Review" });
    await reconcile({ entryIds: [id] });
    const item = await question(id);
    // Keep it, mid-answer: its Review item and event are written, not yet committed.
    const answer = await db().connect();
    try {
      await answer.query("begin");
      await answer.query(`update review_items set status = 'ignored', resolved_at = now() where id = $1`, [item.id]);
      await answer.query(`update activity_events set review_status = 'ignored' where client_event_id = $1`, [`timer-trip-clash:${id}`]);
      const edit = updateTimeEntry(id, { description: "Code review" }, session);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await answer.query("commit");
      await edit;
    } finally {
      answer.release();
    }
    expect((await question(id)).status).toBe("ignored");
  });

  it("a block deleted while a replay pass is deciding never gets a question (Codex r1 on #611)", async () => {
    const id = await block(840, 930, { description: "Inbox" });
    const deleting = await db().connect();
    try {
      await deleting.query("begin");
      await deleting.query(`delete from time_entries where id = $1`, [id]);
      const pass = reconcile(window);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await deleting.query("commit");
      await pass;
    } finally {
      deleting.release();
    }
    expect(await question(id)).toBeUndefined();
  });
  it("a replay pass holding a Log automatically block never deadlocks with a batch delete of it and a timer block (Codex r2 on #611)", async () => {
    const { deleteTimeEntries } = await import("../event-service");
    const { reconcileTimerTripClashes } = await import("./timer-trip-clash-service");
    const manual = await block(845, 900, { description: "Errand prep" });
    // The auto-logged block sorts after the timer's block, so the delete locks the timer's block first.
    const auto = (await db().query<{ id: string }>(
      `insert into time_entries (id, workspace_id, user_id, source, started_at, stopped_at)
       values ('ffffffff-0000-4000-8000-000000000001', $1, $2, 'location_auto_log', $3, $4) returning id`,
      [workspaceId, userId, at(600), at(700)])).rows[0].id;
    expect(manual < auto).toBe(true);
    const replay = await db().connect();
    try {
      await replay.query("begin");
      await replay.query(`select id from time_entries where id = $1 for update`, [auto]);
      const deleting = deleteTimeEntries([manual, auto], session);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await reconcileTimerTripClashes(replay, session, window, now);
      await replay.query("commit");
      await expect(deleting).resolves.toMatchObject({ deletedCount: 2 });
    } finally {
      replay.release();
    }
    expect(await question(manual)).toBeUndefined();
  });

  it("a title edit that commits while the pass waits for its block still asks (Codex r2 on #611)", async () => {
    const id = await block(850, 940, { description: "Standup" });
    await reconcile({ entryIds: [id] });
    const edit = await db().connect();
    try {
      await edit.query("begin");
      // What updateTimeEntry writes for a title edit: user_edited_at and its matching audit row.
      await edit.query(`update time_entries set description = 'Daily', user_edited_at = $2, updated_at = $2 where id = $1`,
        [id, "2026-10-28T01:00:00.000Z"]);
      await edit.query(
        `insert into audit_log (workspace_id, user_id, action, entity_type, entity_id, metadata, created_at)
         values ($1, $2, 'time_entry.edited', 'time_entry', $3, '{}'::jsonb, $4)`,
        [workspaceId, userId, id, "2026-10-28T01:00:00.000Z"]);
      const pass = reconcile({ entryIds: [id] });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await edit.query("commit");
      await pass;
    } finally {
      edit.release();
    }
    expect(await question(id)).toMatchObject({ status: "open", title: "Daily ran 28m into your trip" });
  });

  it("a Start that ends the running block before the trip, or a split before it, settles the question (Codex r2 on #611)", async () => {
    const { processActivityEvent, splitFinishedEntry } = await import("../event-service");
    await db().query(`delete from time_entries where workspace_id = $1 and stopped_at is null`, [workspaceId]);
    const running = await block(812, null, { description: "Pairing" });
    await reconcile({ entryIds: [running] });
    expect((await question(running)).status).toBe("open");
    await processActivityEvent({
      clientEventId: "timer-trip-switch", occurredAt: at(851), source: "mobile_app", type: "timer_start",
      rawPayload: { origin: "mobile_timer_start" }, description: "Lunch"
    }, session);
    expect((await question(running)).status).toBe("superseded");
    await db().query(`delete from time_entries where workspace_id = $1 and stopped_at is null`, [workspaceId]);
    const finished = await block(814, 900, { description: "Write-up" });
    await reconcile({ entryIds: [finished] });
    expect((await question(finished)).status).toBe("open");
    await splitFinishedEntry(finished, { splitAt: at(855) }, session);
    expect((await question(finished)).status).toBe("superseded");
  });
});
