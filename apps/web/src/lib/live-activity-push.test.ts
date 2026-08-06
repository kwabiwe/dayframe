import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  activeRows: [] as Array<Record<string, unknown>>,
  claimRows: [] as Array<Record<string, unknown>>,
  tokenRows: [] as Array<Record<string, unknown>>,
  writes: [] as Array<{ sql: string; params: unknown[] }>,
  query: vi.fn()
}));

vi.mock("./db", () => ({ query: database.query }));

const http2Mocks = vi.hoisted(() => ({
  calls: [] as Array<{ authority: string; headers?: Record<string, string>; body?: string }>,
  status: 200,
  responseBody: "",
  responseHeaders: {} as Record<string, string>
}));

vi.mock("node:http2", () => ({
  default: {
    constants: { NGHTTP2_CANCEL: 8 },
    connect: (authority: string) => ({
      close: vi.fn(),
      once: vi.fn(),
      request: (headers: Record<string, string>) => {
        const call = { authority, headers, body: undefined as string | undefined };
        http2Mocks.calls.push(call);
        const handlers: Record<string, (value?: unknown) => void> = {};
        return {
          close: vi.fn(),
          setEncoding: vi.fn(),
          setTimeout: vi.fn(),
          on: (event: string, handler: (value?: unknown) => void) => {
            handlers[event] = handler;
          },
          once: (event: string, handler: (value?: unknown) => void) => {
            handlers[event] = handler;
          },
          end: (body: string) => {
            call.body = body;
            handlers.response?.({
              ":status": http2Mocks.status,
              ...http2Mocks.responseHeaders
            });
            if (http2Mocks.responseBody) handlers.data?.(http2Mocks.responseBody);
            handlers.end?.();
          }
        };
      }
    })
  }
}));

const {
  classifyApnsFailure,
  drainLiveActivityOutbox,
  notifyLiveActivities,
  parseRetryAfterMs,
  registerLiveActivity,
  retryDelayMs
} = await import("./live-activity-push");

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

describe("Live Activity durable remote sync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    database.activeRows = [];
    database.claimRows = [];
    database.tokenRows = [];
    database.writes = [];
    database.query.mockImplementation((sql: string, params: unknown[] = []) => {
      if (sql.includes("from live_activity_push_tokens") && sql.includes('activity_id as "activityId"')) {
        return Promise.resolve({ rows: database.tokenRows, rowCount: database.tokenRows.length });
      }
      if (sql.includes("from time_entries te") && sql.includes('as "startedAt"')) {
        return Promise.resolve({ rows: database.activeRows, rowCount: database.activeRows.length });
      }
      if (sql.includes("with due as")) {
        const rows = database.claimRows;
        database.claimRows = [];
        return Promise.resolve({ rows, rowCount: rows.length });
      }
      database.writes.push({ sql, params });
      return Promise.resolve({ rows: [{ id: "token-row" }], rowCount: 1 });
    });
    http2Mocks.calls.length = 0;
    http2Mocks.status = 200;
    http2Mocks.responseBody = "";
    http2Mocks.responseHeaders = {};
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_PRIVATE_KEY;
    delete process.env.APNS_BUNDLE_ID;
  });

  it("stores tokens inside the authenticated user and workspace", async () => {
    await registerLiveActivity(session, {
      token: "a".repeat(64),
      activityId: "activity-1",
      activeEntryId: "80000000-0000-4000-8000-000000000001",
      environment: "production"
    });

    const write = database.writes[0];
    expect(write.sql).toContain("invalidated_previous_tokens");
    expect(write.params).toEqual([
      session.workspaceId,
      session.userId,
      "a".repeat(64),
      "activity-1",
      "80000000-0000-4000-8000-000000000001",
      "production"
    ]);
  });

  it("persists the newest desired state before deferring missing provider configuration", async () => {
    database.tokenRows = [{
      id: "token-row",
      token: "b".repeat(64),
      activityId: "activity-1",
      environment: "development"
    }];
    database.activeRows = [{
      id: "entry-1",
      description: "Architecture",
      categoryName: "Work",
      categoryColor: "#123456",
      startedAt: "2026-08-06T05:00:00.000Z"
    }];

    const result = await notifyLiveActivities(session);

    const outboxWrite = database.writes.find((write) => write.sql.includes("live_activity_delivery_outbox"));
    expect(outboxWrite?.sql).toContain("on conflict (token_id) do update");
    expect(outboxWrite?.sql).toContain("revision = live_activity_delivery_outbox.revision + 1");
    expect(outboxWrite?.sql).toContain("live_activity_delivery_outbox.payload #>> '{aps,timestamp}'");
    expect(JSON.parse(String(outboxWrite?.params[4]))).toMatchObject({
      aps: { event: "update", "content-state": { title: "Architecture", isRunning: true } }
    });
    expect(result.missingConfiguration).toEqual([
      "APNS_KEY_ID",
      "APNS_TEAM_ID",
      "APNS_PRIVATE_KEY",
      "APNS_BUNDLE_ID"
    ]);
    expect(http2Mocks.calls).toHaveLength(0);
  });

  it("delivers a due sandbox update and marks the exact revision delivered", async () => {
    configureApns();
    database.claimRows = [outboxRow({ environment: "development", event: "update" })];

    const result = await drainLiveActivityOutbox({ session });

    expect(result).toMatchObject({ claimed: 1, delivered: 1, retryScheduled: 0 });
    const request = http2Mocks.calls[0];
    expect(request.authority).toBe("https://api.sandbox.push.apple.com");
    expect(request.headers?.["apns-collapse-id"]).toBe("activity-1");
    expect(request.headers?.["apns-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(request.body)).aps.event).toBe("update");
    const delivered = database.writes.find((write) => write.sql.includes("status = 'delivered'"));
    expect(delivered?.params.slice(0, 2)).toEqual(["outbox-row", "7"]);
  });

  it("schedules retryable APNs failures using Retry-After without invalidating the token", async () => {
    configureApns();
    http2Mocks.status = 503;
    http2Mocks.responseBody = JSON.stringify({ reason: "Shutdown" });
    http2Mocks.responseHeaders = { "retry-after": "9", "apns-id": "apns-request-1" };
    database.claimRows = [outboxRow({ attemptCount: 1 })];

    const before = Date.now();
    const result = await drainLiveActivityOutbox({ session });

    expect(result).toMatchObject({ claimed: 1, retryScheduled: 1, permanentFailures: 0 });
    const tokenFailure = database.writes.find((write) =>
      write.sql.includes("consecutive_failures = consecutive_failures + 1")
    );
    expect(tokenFailure?.params).toEqual(["token-row", 503, "Shutdown", false]);
    const retry = database.writes.find((write) => write.sql.includes("set status = $3"));
    expect(retry?.params[2]).toBe("pending");
    expect(new Date(String(retry?.params[3])).getTime()).toBeGreaterThanOrEqual(before + 8_900);
    expect(retry?.params[6]).toBe("apns-request-1");
  });

  it("records permanent configuration failures without retrying or invalidating a good token", async () => {
    configureApns();
    http2Mocks.status = 403;
    http2Mocks.responseBody = JSON.stringify({ reason: "InvalidProviderToken" });
    database.claimRows = [outboxRow()];

    const result = await drainLiveActivityOutbox({ session });

    expect(result).toMatchObject({ permanentFailures: 1, retryScheduled: 0, invalidatedTokens: 0 });
    const tokenFailure = database.writes.find((write) =>
      write.sql.includes("consecutive_failures = consecutive_failures + 1")
    );
    expect(tokenFailure?.params).toEqual(["token-row", 403, "InvalidProviderToken", false]);
    const outboxFailure = database.writes.find((write) => write.sql.includes("set status = $3"));
    expect(outboxFailure?.params[2]).toBe("permanent_failure");
  });

  it("invalidates expired tokens and never logs token or provider secrets", async () => {
    configureApns();
    http2Mocks.status = 410;
    http2Mocks.responseBody = JSON.stringify({ reason: "Unregistered" });
    database.claimRows = [outboxRow()];
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await drainLiveActivityOutbox({ session });

    expect(result.invalidatedTokens).toBe(1);
    const tokenFailure = database.writes.find((write) =>
      write.sql.includes("consecutive_failures = consecutive_failures + 1")
    );
    expect(tokenFailure?.params).toEqual(["token-row", 410, "Unregistered", true]);
    const serialized = JSON.stringify(warning.mock.calls);
    expect(serialized).not.toContain("c".repeat(64));
    expect(serialized).not.toContain(process.env.APNS_PRIVATE_KEY);
  });

  it("recovers idempotently when a later reconciliation succeeds", async () => {
    configureApns();
    http2Mocks.status = 500;
    http2Mocks.responseBody = JSON.stringify({ reason: "InternalServerError" });
    database.claimRows = [outboxRow({ attemptCount: 0 })];
    await drainLiveActivityOutbox({ session });

    http2Mocks.status = 200;
    http2Mocks.responseBody = "";
    database.claimRows = [outboxRow({ attemptCount: 1 })];
    const recovered = await drainLiveActivityOutbox({ session });

    expect(recovered.delivered).toBe(1);
    expect(http2Mocks.calls).toHaveLength(2);
    expect(http2Mocks.calls[0].headers?.["apns-collapse-id"]).toBe("activity-1");
    expect(http2Mocks.calls[1].headers?.["apns-collapse-id"]).toBe("activity-1");
    expect(http2Mocks.calls[0].body).toBe(http2Mocks.calls[1].body);
  });

  it("classifies and bounds retry guidance", () => {
    expect(classifyApnsFailure(null, "NetworkError")).toBe("retry");
    expect(classifyApnsFailure(429, "TooManyRequests")).toBe("retry");
    expect(classifyApnsFailure(500, "InternalServerError")).toBe("retry");
    expect(classifyApnsFailure(400, "BadTopic")).toBe("permanent");
    expect(classifyApnsFailure(410, "Unregistered")).toBe("invalid_token");
    expect(parseRetryAfterMs("12", 0)).toBe(12_000);
    expect(retryDelayMs(2, "999999", 0)).toBe(60 * 60 * 1000);
  });
});

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "outbox-row",
    tokenId: "token-row",
    token: "c".repeat(64),
    activityId: "activity-1",
    environment: "production",
    revision: "7",
    event: "update",
    payload: {
      aps: {
        timestamp: 1_786_000_000,
        event: "update",
        "content-state": {
          title: "Architecture",
          categoryName: "Work",
          categoryColor: "#123456",
          startedAt: 807_692_800,
          elapsedSeconds: 5,
          isRunning: true
        }
      }
    },
    attemptCount: 0,
    expiresAt: "2026-08-07T05:00:00.000Z",
    ...overrides
  };
}

function configureApns() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  process.env.APNS_KEY_ID = "KEY123";
  process.env.APNS_TEAM_ID = "TEAM123";
  process.env.APNS_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  process.env.APNS_BUNDLE_ID = "com.layereight.dayframe";
}
