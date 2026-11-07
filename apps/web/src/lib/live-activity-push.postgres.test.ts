import { generateKeyPairSync, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestSession } from "./session";

const databaseUrl = process.env.DAYFRAME_LIVE_ACTIVITY_TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;
let database: pg.Pool;
let session: RequestSession;
let entryId: string;
let afterActiveRead: (() => Promise<void>) | undefined;
let onOwnerLock: (() => void) | undefined;
const now = Date.now();
const startedAt = new Date(now - 600_000);

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function controlledQuery(client: Pick<pg.Pool, "query">, text: string, values: unknown[] = []) {
  const result = client.query(text, values);
  if (text.includes("pg_advisory_xact_lock")) onOwnerLock?.();
  const rows = await result;
  if (text.includes("select te.id,") && text.includes("te.stopped_at is null")) {
    await afterActiveRead?.();
  }
  return rows;
}

const provider = vi.hoisted(() => ({
  reply: undefined as undefined | ((respond: (status: number, body?: string) => void) => void)
}));

vi.mock("node:http2", () => ({
  default: {
    connect: () => {
      if (!provider.reply) throw new Error("Synthetic provider network failure");
      return {
        close: () => {},
        once: () => {},
        request: () => {
          const callbacks = new Map<string, (value?: unknown) => void>();
          return {
            on: (event: string, callback: (value?: unknown) => void) => callbacks.set(event, callback),
            once: (event: string, callback: (value?: unknown) => void) => callbacks.set(event, callback),
            setEncoding: () => {},
            setTimeout: () => {},
            end: () => provider.reply!((status, body) => {
              callbacks.get("response")?.({ ":status": status });
              if (body) callbacks.get("data")?.(body);
              callbacks.get("end")?.();
            })
          };
        }
      };
    }
  }
}));

vi.mock("./db", () => ({
  isLockNotAvailableError: (error: unknown) => (error as { code?: string })?.code === "55P03",
  query: (text: string, values: unknown[] = []) => controlledQuery(database, text, values),
  pool: {
    connect: async () => {
      const client = await database.connect();
      return new Proxy(client, {
        get(target, property) {
          if (property === "query") {
            return (text: string, values?: unknown[]) => controlledQuery(target, text, values);
          }
          const member = Reflect.get(target, property);
          return typeof member === "function" ? member.bind(target) : member;
        }
      });
    }
  }
}));

const {
  drainLiveActivityOutbox, notifyLiveActivities, reconcileLiveActivityDesiredState, registerLiveActivity, retryLiveActivityDeliveryBestEffort
} =
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

async function outbox(owner = session) {
  const { rows } = await database.query<Outbox>(
    `select revision::text, event, status, attempt_count, next_attempt_at, expires_at, leased_until, payload
       from live_activity_delivery_outbox where workspace_id = $1 and user_id = $2`,
    [owner.workspaceId, owner.userId]
  );
  expect(rows).toHaveLength(1);
  return rows[0];
}

function configureSyntheticProvider() {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  vi.stubEnv("APNS_KEY_ID", "test");
  vi.stubEnv("APNS_TEAM_ID", "test");
  vi.stubEnv("APNS_PRIVATE_KEY", privateKey.export({ format: "pem", type: "pkcs8" }).toString());
  vi.stubEnv("APNS_BUNDLE_ID", "com.layereight.dayframe.test");
}

async function registerRunningTimer(owner: RequestSession, id: string, title: string) {
  await database.query("insert into users (id, email, name) values ($1, $2, 'QA user')",
    [owner.userId, `${owner.userId}@example.test`]);
  await database.query(
    `insert into time_entries (id, workspace_id, user_id, source, description, started_at)
     values ($1, $2, $3, 'manual_app', $4, $5)`,
    [id, owner.workspaceId, owner.userId, title, startedAt]
  );
  await registerLiveActivity(owner, {
    token: randomUUID().replaceAll("-", ""),
    activityId: "qa-live-activity",
    activeEntryId: id,
    environment: "development"
  });
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
    await database.query("insert into workspaces (id, name) values ($1, 'QA workspace')", [session.workspaceId]);
    await registerRunningTimer(session, entryId, "Original timer");
    await notifyLiveActivities(session);
  });

  afterEach(async () => {
    provider.reply = undefined;
    afterActiveRead = undefined;
    onOwnerLock = undefined;
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
    {
      action: "Stop",
      sql: "update time_entries set stopped_at = $1 where id = $2",
      value: new Date(now),
      expected: { event: "end", revision: "2" }
    },
    {
      action: "edit",
      sql: "update time_entries set description = $1 where id = $2",
      value: "Renamed while refreshing",
      expected: {
        event: "update",
        revision: "2",
        payload: { aps: { "content-state": { title: "Renamed while refreshing" } } }
      }
    }
  ])("keeps the newer $action when an earlier refresh already read the timer", async ({ sql, value, expected }) => {
    const captured = signal();
    const resume = signal();
    const newerLock = signal();
    afterActiveRead = async () => {
      afterActiveRead = undefined;
      captured.resolve();
      await resume.promise;
    };

    const stale = notifyLiveActivities(session);
    let newer: ReturnType<typeof notifyLiveActivities> | undefined;
    try {
      await Promise.race([captured.promise, stale]);
      await database.query(sql, [value, entryId]);
      onOwnerLock = newerLock.resolve;
      newer = notifyLiveActivities(session);
      // The newer enqueue can reach its lock while the earlier enqueue is still paused.
      // The old code instead writes the new revision before the earlier enqueue resumes.
      await Promise.race([newerLock.promise, newer]);
    } finally {
      resume.resolve();
      await Promise.all([stale, newer]);
    }
    expect(await outbox()).toMatchObject(expected);
  });

  it("does not end a replacement registered after the timer snapshot", async () => {
    const captured = signal();
    const resume = signal();
    afterActiveRead = async () => {
      afterActiveRead = undefined;
      captured.resolve();
      await resume.promise;
    };
    const replacementId = randomUUID();
    const stale = notifyLiveActivities(session);
    try {
      await Promise.race([captured.promise, stale]);
      await database.query("update time_entries set stopped_at = $1 where id = $2", [new Date(), entryId]);
      await database.query(
        `insert into time_entries (id, workspace_id, user_id, source, description, started_at)
         values ($1, $2, $3, 'manual_app', 'Replacement', $4)`,
        [replacementId, session.workspaceId, session.userId, new Date()]
      );
      await registerLiveActivity(session, {
        token: randomUUID().replaceAll("-", ""),
        activityId: "replacement-activity",
        activeEntryId: replacementId,
        environment: "development"
      });
    } finally {
      resume.resolve();
      await stale;
    }
    expect(await outbox()).toMatchObject({ event: "update", revision: "1" });

    await notifyLiveActivities(session);
    const { rows } = await database.query(
      `select t.activity_id, o.event, o.revision::int
       from live_activity_delivery_outbox o join live_activity_push_tokens t on t.id = o.token_id
       where o.workspace_id = $1 and o.user_id = $2 order by t.activity_id`,
      [session.workspaceId, session.userId]
    );
    expect(rows).toEqual([
      { activity_id: "qa-live-activity", event: "end", revision: 2 },
      { activity_id: "replacement-activity", event: "update", revision: 1 }
    ]);
  });

  it("keeps a successful reclaimed delivery when the previous lease replies late", async () => {
    configureSyntheticProvider();
    let lateReply: ((status: number, body?: string) => void) | undefined;
    const held = signal();
    provider.reply = reply => {
      lateReply = reply;
      held.resolve();
    };
    const first = drainLiveActivityOutbox({ session });
    try {
      await Promise.race([held.promise, first]);
      expect(lateReply).toBeDefined();
      // Model a delayed invocation whose lease expires before it can handle the response.
      await database.query(
        "update live_activity_delivery_outbox set leased_until = now() - interval '1 second' where workspace_id=$1 and user_id=$2",
        [session.workspaceId, session.userId]
      );
      provider.reply = reply => reply(200);
      expect(await drainLiveActivityOutbox({ session })).toMatchObject({ delivered: 1 });
      expect(await outbox()).toMatchObject({ revision: "1", status: "delivered", attempt_count: 1 });
    } finally {
      lateReply?.(503, '{"reason":"Shutdown"}');
      await first;
    }
    expect(await outbox()).toMatchObject({ revision: "1", status: "delivered", attempt_count: 1 });
  });

  it.each(["reclaimed lease", "new revision"] as const)("ignores a stale invalid-token reply during a %s", async supersession => {
    configureSyntheticProvider();
    const firstHeld = signal();
    const secondHeld = signal();
    let firstReply: ((status: number, body?: string) => void) | undefined;
    let secondReply: ((status: number, body?: string) => void) | undefined;
    provider.reply = reply => {
      firstReply = reply;
      firstHeld.resolve();
    };
    const first = drainLiveActivityOutbox({ session });
    let second: ReturnType<typeof drainLiveActivityOutbox> | undefined;
    try {
      await Promise.race([firstHeld.promise, first]);
      expect(firstReply).toBeDefined();
      provider.reply = reply => {
        secondReply = reply;
        secondHeld.resolve();
      };
      if (supersession === "reclaimed lease") {
        await database.query(
          "update live_activity_delivery_outbox set leased_until = now() - interval '1 second' where workspace_id=$1 and user_id=$2",
          [session.workspaceId, session.userId]
        );
        second = drainLiveActivityOutbox({ session });
      } else {
        await database.query("update time_entries set description = 'Newer edit' where id = $1", [entryId]);
        second = notifyLiveActivities(session);
      }
      await Promise.race([secondHeld.promise, second]);
      expect(secondReply).toBeDefined();
      const latestClaim = await outbox();

      firstReply?.(410, '{"reason":"Unregistered"}');
      expect(await first).toMatchObject({ claimed: 1, invalidatedTokens: 0 });
      expect(await outbox()).toEqual(latestClaim);
      const token = (await database.query(
        "select invalidated_at, consecutive_failures from live_activity_push_tokens where workspace_id=$1 and user_id=$2",
        [session.workspaceId, session.userId]
      )).rows[0];
      expect(token).toEqual({ invalidated_at: null, consecutive_failures: 0 });

      secondReply?.(200);
      expect(await second).toMatchObject({ delivered: 1 });
    } finally {
      firstReply?.(410, '{"reason":"Unregistered"}');
      secondReply?.(200);
      await Promise.all([first, second]);
    }
    expect(await outbox()).toMatchObject({
      revision: supersession === "reclaimed lease" ? "1" : "2",
      status: "delivered", attempt_count: 1
    });
  });

  it("retires the original token when its stopped entry is deleted during End delivery", async () => {
    await database.query("update time_entries set stopped_at = $1 where id = $2", [new Date(), entryId]);
    configureSyntheticProvider();
    const held = signal();
    let replyToEnd: ((status: number) => void) | undefined;
    provider.reply = reply => {
      replyToEnd = reply;
      held.resolve();
    };
    const end = notifyLiveActivities(session);
    try {
      await Promise.race([held.promise, end]);
      expect(replyToEnd).toBeDefined();
      expect(await outbox()).toMatchObject({ event: "end", revision: "2" });
      await database.query("delete from time_entries where id = $1", [entryId]);
    } finally {
      replyToEnd?.(200);
      await end;
    }
    expect(await end).toMatchObject({ delivered: 1 });
    const token = (await database.query(
      "select active_entry_id, invalidated_at from live_activity_push_tokens where workspace_id=$1 and user_id=$2",
      [session.workspaceId, session.userId]
    )).rows[0];
    expect(token).toEqual({ active_entry_id: null, invalidated_at: expect.any(Date) });
  });

  it("keeps processing other owners and drains due rows while the first owner is busy", async () => {
    const other = { ...session, userId: randomUUID() };
    const holder = await database.connect();
    try {
      await registerRunningTimer(other, randomUUID(), "Another owner's timer");
      await database.query(
        "update live_activity_push_tokens set last_registered_at = now() + interval '1 minute' where user_id = $1",
        [session.userId]
      );
      await database.query("update time_entries set description = 'Busy edit' where id = $1", [entryId]);
      await holder.query("begin");
      await holder.query("select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`live-activity-outbox:${session.workspaceId}:${session.userId}`]);

      configureSyntheticProvider();

      // Both due pushes enter the drain and use the mocked network failure.
      const result = await reconcileLiveActivityDesiredState();
      expect(result).toMatchObject({ claimed: 2, retryScheduled: 2 });
      expect(await outbox()).toMatchObject({ revision: "1", attempt_count: 1 });
      expect(await outbox(other)).toMatchObject({ event: "update", revision: "1", attempt_count: 1 });
    } finally {
      try {
        await holder.query("rollback");
      } finally {
        holder.release();
      }
      await database.query("delete from users where id = $1", [other.userId]);
    }
  });

  it("updates the current timer and ends all older valid registrations", async () => {
    await database.query(
      `insert into live_activity_push_tokens (workspace_id, user_id, token, activity_id, invalidated_at)
       select $1, $2, gen_random_uuid()::text, 'old-' || n,
              case when n = 150 then now() else null end
       from generate_series(1, 150) n`,
      [session.workspaceId, session.userId]
    );
    await notifyLiveActivities(session);

    const { rows } = await database.query(
      `select o.event, count(*)::int as count,
              bool_and((t.active_entry_id = $3) is true) as is_current
       from live_activity_delivery_outbox o
       join live_activity_push_tokens t on t.id = o.token_id
       where o.workspace_id = $1 and o.user_id = $2
       group by o.event order by o.event`,
      [session.workspaceId, session.userId, entryId]
    );
    expect(rows).toEqual([
      { event: "end", count: 149, is_current: false },
      { event: "update", count: 1, is_current: true }
    ]);
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
