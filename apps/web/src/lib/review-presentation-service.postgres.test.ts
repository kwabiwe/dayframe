import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { getReviewPresentation } from "./review-presentation-service";
import type { RequestSession } from "./session";

const databaseUrl = process.env.DAYFRAME_REVIEW_PRESENTATION_TEST_DATABASE_URL;
const workspaceId = "61000000-0000-4000-8000-000000000001";
const userId = "61000000-0000-4000-8000-000000000002";
const entryId = "61000000-0000-4000-8000-000000009001";
const reviewIds = Array.from(
  { length: 501 },
  (_, index) => `61000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`
);
const session: RequestSession = {
  workspaceId,
  userId,
  authMode: "dev",
  scopes: ["app:read"]
};
let database: pg.Pool | null = null;

describe("Review presentation service on disposable PostgreSQL", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    const target = new URL(databaseUrl);
    if (![
      "localhost",
      "127.0.0.1"
    ].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Review presentation integration tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    await clearFixtures(database);
    await database.query(
      "insert into users (id, email, name) values ($1, 'review-presentation@example.test', 'Review presentation test')",
      [userId]
    );
    await database.query("insert into workspaces (id, name) values ($1, 'Review presentation test')", [workspaceId]);
    await database.query(
      "insert into workspace_members (workspace_id, user_id, role) values ($1, $2, 'owner')",
      [workspaceId, userId]
    );
    await database.query(
      `insert into time_entries (
         id, workspace_id, user_id, source, confidence, review_status,
         description, started_at, stopped_at
       ) values ($1, $2, $3, 'manual_app', 'high', 'confirmed', 'Completed fixture', $4, $5)`,
      [entryId, workspaceId, userId, "2026-09-12T09:00:00.000Z", "2026-09-12T09:30:00.000Z"]
    );
    await database.query(
      `insert into review_items (
         id, workspace_id, user_id, type, title, suggested_started_at,
         suggested_stopped_at, confidence, status, created_at
       )
       select id, $2::uuid, $3::uuid, 'health', 'Synthetic Review',
              '2026-09-12T08:00:00.000Z'::timestamptz,
              '2026-09-12T08:30:00.000Z'::timestamptz,
              'medium', 'open', '2026-09-12T08:31:00.000Z'::timestamptz
       from unnest($1::uuid[]) as fixture(id)`,
      [reviewIds, workspaceId, userId]
    );
  });

  afterAll(async () => {
    if (!database) return;
    try {
      await clearFixtures(database);
    } finally {
      await database.end();
      database = null;
    }
  });

  it.skipIf(!databaseUrl)("uses the real transaction helper for window, backlog and lookup modes", async () => {
    const pool = database!;
    const window = await getReviewPresentation(session, {
      version: 1,
      mode: "window",
      timeZone: "Etc/UTC",
      window: { start: "2026-09-01T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
      today: { start: "2026-09-12T00:00:00.000Z", end: "2026-09-13T00:00:00.000Z" },
      limit: 200
    }, { databasePool: pool });
    expect(window.records).toHaveLength(200);
    expect(window.nextCursor).not.toBeNull();
    expect(window.links.map((link) => link.reviewItemId).sort()).toEqual(
      window.records.flatMap((record) => record.kind === "review" ? [record.reviewItemId] : []).sort()
    );

    const backlog = await getReviewPresentation(session, {
      version: 1,
      mode: "backlog",
      timeZone: "Etc/UTC",
      limit: 200
    }, { databasePool: pool });
    expect(backlog.records).toHaveLength(200);
    expect(backlog.nextCursor).not.toBeNull();
    expect(backlog.links).toHaveLength(200);
    expect(backlog.links.map((link) => link.reviewItemId).sort()).toEqual(
      backlog.records.flatMap((record) => record.kind === "review" ? [record.reviewItemId] : []).sort()
    );

    const lookup = await getReviewPresentation(session, {
      version: 1,
      mode: "lookup",
      timeZone: "Etc/UTC",
      reviewItemIds: [reviewIds[0]!],
      entryIds: [entryId],
      limit: 100
    }, { databasePool: pool });
    expect(lookup.links).toEqual([{ reviewItemId: reviewIds[0], entryIds: [], status: "open" }]);
    expect(lookup.lookup.reviewItems).toMatchObject([{ kind: "review", reviewItemId: reviewIds[0] }]);
    expect(lookup.lookup.entries).toMatchObject([{ kind: "completed_entry", entryId }]);
  }, 15_000);
});

async function clearFixtures(database: pg.Pool) {
  await database.query("delete from workspaces where id = $1", [workspaceId]);
  await database.query("delete from users where id = $1", [userId]);
}
