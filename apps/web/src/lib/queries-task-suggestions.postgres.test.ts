import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { REVIEW_DECISION_PAYLOAD_KEY } from "./review-decision-signal";
import type { RequestSession } from "./session";

// Run with DAYFRAME_HISTORY_FLAGS_TEST_DATABASE_URL pointing at a disposable local *_test database
// that has every packages/db migration applied (the #363 pattern). All names are invented fixtures.
const databaseUrl = process.env.DAYFRAME_HISTORY_FLAGS_TEST_DATABASE_URL;
const workspaceId = "64000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "64000000-0000-4000-8000-000000000003";
const userId = "64000000-0000-4000-8000-000000000002";
const otherUserId = "64000000-0000-4000-8000-000000000004";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read"] };
let database: pg.Pool | null = null;
let sequence = 0;

vi.mock("./db", async (importOriginal) => {
  const original = await importOriginal<typeof import("./db")>();
  return {
    ...original,
    query: (text: string, values: unknown[] = []) => {
      if (!database) throw new Error("Test database is not connected.");
      return database.query(text, values);
    }
  };
});

const { getTaskSuggestionSets } = await import("./queries");

const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("typed Description candidate pool on disposable PostgreSQL (#386, #363)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Candidate pool tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await clearFixtures(database);
    await database.query(
      "insert into users (id, email, name) values ($1, 'pool-a@example.test', 'A'), ($2, 'pool-b@example.test', 'B')",
      [userId, otherUserId]
    );
    await database.query(
      "insert into workspaces (id, name) values ($1, 'Pool'), ($2, 'Other pool')",
      [workspaceId, otherWorkspaceId]
    );
    await database.query(
      `insert into workspace_members (workspace_id, user_id, role) values
         ($1, $3, 'owner'), ($1, $4, 'member'), ($2, $3, 'owner')`,
      [workspaceId, otherWorkspaceId, userId, otherUserId]
    );
    await seed(database);
  });

  afterAll(async () => {
    if (database) {
      await clearFixtures(database);
      await database.end();
      database = null;
    }
  });

  it("searches owner-titled split and merge parts, never Dayframe's suggested titles", async () => {
    const { taskSuggestions, taskSuggestionCandidates } = await getTaskSuggestionSets(session);
    const pool = Object.fromEntries(taskSuggestionCandidates.map((candidate) => [candidate.description, candidate.learningTier]));

    expect(pool).toEqual({
      "Typed block": 1,
      // Split and confirm: the part the owner titled is searchable, the inherited title is not.
      "Picnic": 2,
      // Merge and confirm: the same two cases.
      "Gym and sauna": 2,
      // Renamed in Review on the visit's own accepted item.
      "Lunch with friends": 2
    });
    // The contextual list never learns from correction parts (unchanged behaviour).
    expect(taskSuggestions.map((suggestion) => suggestion.description)).not.toContain("Picnic");
    expect(taskSuggestions.map((suggestion) => suggestion.description)).not.toContain("Gym and sauna");
  });

  it("never reads another user's or workspace's blocks or Review decisions", async () => {
    const theirs = await getTaskSuggestionSets({ ...session, userId: otherUserId });
    expect(theirs.taskSuggestionCandidates.map((candidate) => candidate.description)).toEqual(["Their picnic"]);

    const elsewhere = await getTaskSuggestionSets({ ...session, workspaceId: otherWorkspaceId });
    // That workspace's correction part points at an event in the first workspace: not confirmed there.
    expect(elsewhere.taskSuggestionCandidates.map((candidate) => candidate.description)).toEqual(["Elsewhere typed"]);
  });
});

async function seed(db: pg.Pool) {
  const marked = { [REVIEW_DECISION_PAYLOAD_KEY]: { ownerAuthoredDescription: true } };

  await entry(db, "mobile_app", "Typed block", null);

  // Split and confirm: the parent item is accepted; its parts come from correction events.
  const splitParent = await event(db, "unknown_stay");
  await review(db, splitParent, "Visit Sample Park", "accepted");
  const inherited = await event(db, "unknown_stay", "location-correction:split-left");
  await entry(db, "location_learning", "Visit Sample Park", inherited);
  const titled = await event(db, "unknown_stay", "location-correction:split-right", userId, workspaceId, marked);
  await entry(db, "location_learning", "Picnic", titled);

  // Merge and confirm: two accepted items become one correction-backed block.
  const mergeA = await event(db, "unknown_stay");
  const mergeB = await event(db, "unknown_stay");
  await review(db, mergeA, "Visit Example Cafe", "accepted");
  await review(db, mergeB, "Visit Example Cafe", "accepted");
  const mergedKept = await event(db, "unknown_stay", "location-correction:merge-kept");
  await entry(db, "location_learning", "Visit Example Cafe", mergedKept);
  const mergedTitled = await event(db, "unknown_stay", "location-correction:merge-titled", userId, workspaceId, marked);
  await entry(db, "location_learning", "Gym and sauna", mergedTitled);

  // Confirmed under its suggested title on its own item, and renamed on its own item.
  const kept = await event(db, "learned_place_visit");
  await review(db, kept, "Visit Example Clinic", "accepted");
  await entry(db, "location_learning", "Visit Example Clinic", kept);
  const renamed = await event(db, "unknown_stay", null, userId, workspaceId, marked);
  await review(db, renamed, "Visit at an unknown place", "accepted");
  await entry(db, "location_learning", "Lunch with friends", renamed);

  // An auto-logged correction-looking part with a client-shaped marker but still needing review.
  const open = await event(db, "unknown_stay", "location-correction:open", userId, workspaceId, marked);
  await entry(db, "location_learning", "Open part", open, "needs_review");

  // Another user in the same workspace titled a split part; this user's block borrowing that
  // event must not count, and theirs stays theirs.
  const theirPart = await event(db, "unknown_stay", "location-correction:theirs", otherUserId, workspaceId, marked);
  await entry(db, "location_learning", "Their picnic", theirPart, "confirmed", otherUserId);
  await entry(db, "location_learning", "Borrowed words", theirPart);

  // The same user's other workspace: a typed block, and a part pointing at the first workspace's event.
  await entry(db, "manual_app", "Elsewhere typed", null, "confirmed", userId, otherWorkspaceId);
  await entry(db, "location_learning", "Cross workspace part", titled, "confirmed", userId, otherWorkspaceId);
}

async function event(
  db: pg.Pool,
  eventType: string,
  clientEventId: string | null = null,
  owner = userId,
  workspace = workspaceId,
  payload: Record<string, unknown> = {}
) {
  sequence += 1;
  const result = await db.query<{ id: string }>(
    `insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
     values ($1, $2, $3, 'location_learning', $4, now() - make_interval(hours => $5), 'medium', $6::jsonb, 'confirmed') returning id`,
    [workspace, owner, clientEventId ?? `task-pool:${sequence}`, eventType, sequence, JSON.stringify(payload)]
  );
  return result.rows[0].id;
}

async function review(db: pg.Pool, eventId: string, title: string, status: string, owner = userId) {
  await db.query(
    `insert into review_items (workspace_id, user_id, event_id, type, title, confidence, status)
     values ($1, $2, $3, 'location_stay', $4, 'medium', $5)`,
    [workspaceId, owner, eventId, title, status]
  );
}

async function entry(
  db: pg.Pool,
  source: string,
  description: string,
  eventId: string | null,
  reviewStatus = "confirmed",
  owner = userId,
  workspace = workspaceId
) {
  sequence += 1;
  await db.query(
    `insert into time_entries (workspace_id, user_id, source, confidence, review_status, description, started_at, stopped_at, created_from_event_id)
     values ($1, $2, $3, 'medium', $4, $5, now() - make_interval(hours => $6), now() - make_interval(hours => $6) + interval '30 minutes', $7)`,
    [workspace, owner, source, reviewStatus, description, sequence, eventId]
  );
}

async function clearFixtures(db: pg.Pool) {
  const workspaces = [workspaceId, otherWorkspaceId];
  await db.query("delete from time_entries where workspace_id = any($1::uuid[])", [workspaces]);
  await db.query("delete from review_items where workspace_id = any($1::uuid[])", [workspaces]);
  await db.query("delete from activity_events where workspace_id = any($1::uuid[])", [workspaces]);
  await db.query("delete from workspace_members where workspace_id = any($1::uuid[])", [workspaces]);
  await db.query("delete from workspaces where id = any($1::uuid[])", [workspaces]);
  await db.query("delete from users where id = any($1::uuid[])", [[userId, otherUserId]]);
}
