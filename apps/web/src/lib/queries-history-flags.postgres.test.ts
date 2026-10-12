import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { buildTimeEntriesQuery } from "./queries";
import type { RequestSession } from "./session";

// Run with DAYFRAME_HISTORY_FLAGS_TEST_DATABASE_URL pointing at a disposable local *_test database
// that has every packages/db migration applied. All names below are invented fixtures.
const databaseUrl = process.env.DAYFRAME_HISTORY_FLAGS_TEST_DATABASE_URL;
const workspaceId = "63000000-0000-4000-8000-000000000001";
const otherWorkspaceId = "63000000-0000-4000-8000-000000000003";
const userId = "63000000-0000-4000-8000-000000000002";
const otherUserId = "63000000-0000-4000-8000-000000000004";
const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read"] };
let database: pg.Pool | null = null;
let sequence = 0;

const describeWithDatabase = databaseUrl ? describe : describe.skip;

type Flags = { confirmedInReview: boolean; generatedDescription: boolean };

describeWithDatabase("history entry Review flags on disposable PostgreSQL (E1)", () => {
  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("History flag tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await clearFixtures(database);
    await database.query(
      "insert into users (id, email, name) values ($1, 'history-a@example.test', 'A'), ($2, 'history-b@example.test', 'B')",
      [userId, otherUserId]
    );
    await database.query(
      "insert into workspaces (id, name) values ($1, 'History'), ($2, 'Other history')",
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
    }
  });

  it("flags only owner-renamed Review confirmations as owner-written, scoped to the session", async () => {
    const statement = buildTimeEntriesQuery(session, { limit: 100 });
    const result = await database!.query<{ description: string | null } & Flags>(statement.text, statement.values);
    const flags = Object.fromEntries(result.rows.map((row) => [
      row.description,
      { confirmedInReview: row.confirmedInReview, generatedDescription: row.generatedDescription }
    ]));

    expect(flags).toEqual({
      // Confirmed in Review under the suggested title: confirmed, but the words are Dayframe's.
      "Visit Example Clinic": { confirmedInReview: true, generatedDescription: true },
      // Renamed in Review (edit and confirm), even with different case and spacing elsewhere.
      "Lunch with friends": { confirmedInReview: true, generatedDescription: false },
      // Auto-logged at a saved place: no Review item at all.
      "Auto logged visit": { confirmedInReview: false, generatedDescription: false },
      // Split and confirm: one part keeps the parent's generated title, the other was renamed.
      "Visit Sample Park": { confirmedInReview: true, generatedDescription: true },
      "Picnic": { confirmedInReview: true, generatedDescription: false },
      // A correction Review item renamed by the owner and then accepted.
      "Football practice": { confirmedInReview: true, generatedDescription: false },
      // A suggestion still open in Review: its needs-review block is not confirmed.
      "Open suggestion": { confirmedInReview: false, generatedDescription: true },
      // Typed by the owner: no Review involved.
      "Typed block": { confirmedInReview: false, generatedDescription: false },
      // Another user's Review titles in the same workspace never mark this user's words generated.
      "Shared words": { confirmedInReview: true, generatedDescription: false }
    });
  });

  it("never reads another user's or workspace's Review items", async () => {
    const otherSession: RequestSession = { ...session, userId: otherUserId };
    const statement = buildTimeEntriesQuery(otherSession, { limit: 100 });
    const result = await database!.query<{ description: string | null } & Flags>(statement.text, statement.values);
    expect(result.rows.map((row) => [row.description, row.confirmedInReview, row.generatedDescription])).toEqual([
      // This user's own block with no Review decision of theirs; their own suggestion titles
      // (not the first user's) decide whether the words are generated.
      ["Lunch with friends", false, true]
    ]);

    const elsewhere = buildTimeEntriesQuery({ ...session, workspaceId: otherWorkspaceId }, { limit: 100 });
    const rows = await database!.query<{ description: string | null } & Flags>(elsewhere.text, elsewhere.values);
    expect(rows.rows.map((row) => [row.description, row.confirmedInReview, row.generatedDescription])).toEqual([
      ["Visit Example Clinic", false, false]
    ]);
  });

  it("reads each accepted-item and generated-title list once per query, not once per row", async () => {
    const db = database!;
    // Realistic volumes so the planner's choice is the one a real account gets.
    await db.query(
      `insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
       select $1, $2, 'history-flags-bulk:' || n, 'location_learning', 'unknown_stay', now() - make_interval(hours => n), 'medium', '{}'::jsonb, 'confirmed'
       from generate_series(1, 1500) n`,
      [workspaceId, userId]
    );
    await db.query(
      `insert into review_items (workspace_id, user_id, event_id, type, title, confidence, status)
       select workspace_id, user_id, id, 'location_stay', 'Bulk suggestion ' || client_event_id, 'medium', 'accepted'
       from activity_events where workspace_id = $1 and user_id = $2 and client_event_id like 'history-flags-bulk:%'`,
      [workspaceId, userId]
    );
    await db.query(
      `insert into time_entries (workspace_id, user_id, source, confidence, review_status, description, started_at, stopped_at, created_from_event_id)
       select workspace_id, user_id, 'location_learning', 'medium', 'confirmed', 'Bulk block', occurred_at, occurred_at + interval '30 minutes', id
       from activity_events where workspace_id = $1 and user_id = $2 and client_event_id like 'history-flags-bulk:%'`,
      [workspaceId, userId]
    );
    await db.query("analyze time_entries; analyze review_items; analyze activity_events");

    const statement = buildTimeEntriesQuery(session, { limit: 2000 });
    const plan = await db.query<{ "QUERY PLAN": string }>(`explain (verbose) ${statement.text}`, statement.values);
    const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n");
    // Both uncorrelated lists (accepted items, generated titles) are built once and probed as
    // hash tables ("hashed SubPlan" in the verbose output), never re-scanned per block.
    const hashed = new Set([...text.matchAll(/hashed SubPlan (\d+)/g)].map((match) => match[1]));
    expect(hashed.size).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/COALESCE\(\(\(hashed SubPlan \d+\)/);
    expect(text).toMatch(/COALESCE\(\(hashed SubPlan \d+\)/);
  });
});

async function seed(db: pg.Pool) {
  // Renamed confirmation, kept-title confirmation.
  const kept = await event(db, "location_learning", "learned_place_visit");
  await review(db, kept, "location_stay", "Visit Example Clinic", "accepted");
  await entry(db, "location_learning", "Visit Example Clinic", kept);

  const renamed = await event(db, "location_learning", "unknown_stay");
  await review(db, renamed, "location_stay", "Visit at an unknown place", "accepted");
  await entry(db, "location_learning", "Lunch with friends", renamed);

  // Auto-logged: confirmed block, no Review item.
  const automatic = await event(db, "location_learning", "geofence_exit");
  await entry(db, "location_learning", "Auto logged visit", automatic);

  // Split and confirm: parent item accepted, children from correction events without items.
  const parent = await event(db, "location_learning", "geofence_exit");
  await review(db, parent, "location_stay", "Visit  sample park", "accepted");
  const left = await event(db, "location_learning", "unknown_stay", "location-correction:left");
  await entry(db, "location_learning", "Visit Sample Park", left);
  const right = await event(db, "location_learning", "unknown_stay", "location-correction:right");
  await entry(db, "location_learning", "Picnic", right);

  // Split, then the owner renamed the part's correction item and accepted it.
  const corrected = await event(db, "location_learning", "unknown_stay", "location-correction:renamed");
  await review(db, corrected, "location_manual_correction", "Football practice", "accepted");
  await entry(db, "location_learning", "Football practice", corrected);

  // Open suggestion with a needs-review block.
  const open = await event(db, "location_learning", "unknown_stay");
  await review(db, open, "location_stay", "Open suggestion", "open");
  await entry(db, "location_learning", "Open suggestion", open, "needs_review");

  await entry(db, "mobile_app", "Typed block", null);

  // The other user in the same workspace has a generated title equal to this user's words.
  const foreign = await event(db, "location_learning", "unknown_stay", null, otherUserId);
  await review(db, foreign, "location_stay", "Shared words", "accepted", otherUserId);
  await review(db, foreign, "location_stay", "Lunch with friends", "accepted", otherUserId);
  await entry(db, "location_learning", "Lunch with friends", null, "confirmed", otherUserId);
  const mine = await event(db, "location_learning", "unknown_stay");
  await review(db, mine, "location_stay", "Visit at an unknown place", "accepted");
  await entry(db, "location_learning", "Shared words", mine);

  // Another workspace of the same user, with an accepted item whose title is generated there.
  const elsewhere = await event(db, "location_learning", "unknown_stay", null, userId, otherWorkspaceId);
  await entry(db, "location_learning", "Visit Example Clinic", elsewhere, "confirmed", userId, otherWorkspaceId);
}

async function event(
  db: pg.Pool,
  source: string,
  eventType: string,
  clientEventId: string | null = null,
  owner = userId,
  workspace = workspaceId
) {
  sequence += 1;
  const result = await db.query<{ id: string }>(
    `insert into activity_events (workspace_id, user_id, client_event_id, source, event_type, occurred_at, confidence, raw_payload, review_status)
     values ($1, $2, $3, $4, $5, now() - make_interval(hours => $6), 'medium', '{}'::jsonb, 'confirmed') returning id`,
    [workspace, owner, clientEventId ?? `history-flags:${sequence}`, source, eventType, sequence]
  );
  return result.rows[0].id;
}

async function review(db: pg.Pool, eventId: string, type: string, title: string, status: string, owner = userId) {
  await db.query(
    `insert into review_items (workspace_id, user_id, event_id, type, title, confidence, status)
     values ($1, $2, $3, $4, $5, 'medium', $6)`,
    [workspaceId, owner, eventId, type, title, status]
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
