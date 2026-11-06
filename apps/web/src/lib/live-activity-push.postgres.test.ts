import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestSession } from "./session";

const databaseUrl = process.env.DAYFRAME_LIVE_ACTIVITY_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
let database: pg.Pool;
let session: RequestSession;
let entryId: string;
const now = Date.now();
const startedAt = new Date(now - 600_000);

vi.mock("./db", () => ({
  query: (text: string, values: unknown[] = []) => database.query(text, values)
}));

const { notifyLiveActivities, registerLiveActivity, retryLiveActivityDeliveryBestEffort } =
  await import("./live-activity-push");

type Outbox = {
  revision: string;
  event: string;
  status: string;
  attempt_count: number;
  next_attempt_at: Date;
  expires_at: Date;
  leased_until: Date | null;
  payload: { aps: { timestamp: number; "content-state": { title: string; elapsedSeconds: number } } };
};

async function outbox() {
  const { rows } = await database.query<Outbox>(
    `select revision::text, event, status, attempt_count, next_attempt_at, expires_at, leased_until, payload
       from live_activity_delivery_outbox where workspace_id = $1 and user_id = $2`,
    [session.workspaceId, session.userId]
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

describeWithDatabase("Live Activity retries on disposable Postgres", () => {
  beforeAll(() => {
    const target = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.endsWith("_test")) {
      throw new Error("Live Activity tests require a disposable local *_test database.");
    }
    database = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  });

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    // No Apple requests. These tests exercise the real queue SQL with a synthetic device token.
    vi.stubEnv("APNS_BUNDLE_ID", "");
    session = { workspaceId: randomUUID(), userId: randomUUID(), authMode: "dev", scopes: ["app:write"] };
    entryId = randomUUID();
    await database.query("insert into users (id, email, name) values ($1, $2, 'QA user')",
      [session.userId, `${session.userId}@example.test`]);
    await database.query("insert into workspaces (id, name) values ($1, 'QA workspace')", [session.workspaceId]);
    await database.query(
      `insert into time_entries (id, workspace_id, user_id, source, description, started_at)
       values ($1, $2, $3, 'manual_app', 'Original timer', $4)`,
      [entryId, session.workspaceId, session.userId, startedAt]
    );
    await registerLiveActivity(session, {
      token: randomUUID().replaceAll("-", ""),
      activityId: "qa-live-activity",
      activeEntryId: entryId,
      environment: "development"
    });
    await notifyLiveActivities(session);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    if (!database || !session) return;
    await database.query("delete from workspaces where id = $1", [session.workspaceId]);
    await database.query("delete from users where id = $1", [session.userId]);
  });

  afterAll(async () => {
    await database?.end();
  });

  it("leaves the revision, attempt count, lease and deadline intact while only the timer ticks", async () => {
    await database.query(
      `update live_activity_delivery_outbox
          set attempt_count = 3, next_attempt_at = now() + interval '1 minute',
              leased_until = now() + interval '20 seconds'
        where workspace_id = $1 and user_id = $2`,
      [session.workspaceId, session.userId]
    );
    const original = await outbox();
    vi.setSystemTime(new Date(now + 30_000));

    await retryLiveActivityDeliveryBestEffort(session);

    expect(await outbox()).toEqual(original);
  });

  it.each([
    { status: "delivered", attempts: 1 },
    { status: "permanent_failure", attempts: 8 }
  ])("preserves a $status update until timer metadata changes, and queues a distinct Stop", async ({ status, attempts }) => {
    await database.query(
      `update live_activity_delivery_outbox set status = $3, attempt_count = $4
        where workspace_id = $1 and user_id = $2`,
      [session.workspaceId, session.userId, status, attempts]
    );
    const original = await outbox();
    vi.setSystemTime(new Date(now + 60_000));
    await notifyLiveActivities(session);
    expect(await outbox()).toEqual(original);

    await database.query("update time_entries set description = 'Edited timer' where id = $1", [entryId]);
    await notifyLiveActivities(session);
    const edited = await outbox();
    expect(edited).toMatchObject({
      revision: "2", event: "update", status: "pending", attempt_count: 0, leased_until: null,
      payload: { aps: { "content-state": { title: "Edited timer", elapsedSeconds: 660 } } }
    });
    expect(edited.payload.aps.timestamp).toBeGreaterThan(original.payload.aps.timestamp);

    await database.query("update time_entries set stopped_at = $1 where id = $2", [new Date(), entryId]);
    await notifyLiveActivities(session);
    const ended = await outbox();
    expect(ended).toMatchObject({ revision: "3", event: "end", status: "pending", attempt_count: 0 });
    expect(ended.payload.aps.timestamp).toBeGreaterThan(edited.payload.aps.timestamp);
  });
});
