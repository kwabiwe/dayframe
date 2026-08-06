import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ query: mocks.query }));

const http2Mocks = vi.hoisted(() => ({
  calls: [] as Array<{ authority: string; headers?: Record<string, string>; body?: string }>,
  status: 200,
  responseBody: ""
}));
vi.mock("node:http2", () => ({
  default: {
    connect: (authority: string) => ({
      close: vi.fn(),
      once: vi.fn(),
      request: (headers: Record<string, string>) => {
        const call = { authority, headers, body: undefined as string | undefined };
        http2Mocks.calls.push(call);
        const handlers: Record<string, (value?: unknown) => void> = {};
        return {
          setEncoding: vi.fn(),
          on: (event: string, handler: (value?: unknown) => void) => {
            handlers[event] = handler;
          },
          once: (event: string, handler: (value?: unknown) => void) => {
            handlers[event] = handler;
          },
          end: (body: string) => {
            call.body = body;
            handlers.response?.({ ":status": http2Mocks.status });
            if (http2Mocks.responseBody) handlers.data?.(http2Mocks.responseBody);
            handlers.end?.();
          }
        };
      }
    })
  }
}));

const { notifyLiveActivities, registerLiveActivity } = await import("./live-activity-push");

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

describe("Live Activity remote sync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    http2Mocks.calls.length = 0;
    http2Mocks.status = 200;
    http2Mocks.responseBody = "";
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_PRIVATE_KEY;
  });

  it("stores tokens inside the authenticated user and workspace", async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: "token-row" }], rowCount: 1 });
    await registerLiveActivity(session, {
      token: "a".repeat(64),
      activityId: "activity-1",
      activeEntryId: "80000000-0000-4000-8000-000000000001",
      environment: "production"
    });

    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.query.mock.calls[0][0]).toContain("live_activity_push_tokens");
    expect(mocks.query.mock.calls[0][1]).toEqual([
      session.workspaceId,
      session.userId,
      "a".repeat(64),
      "activity-1",
      "80000000-0000-4000-8000-000000000001",
      "production"
    ]);
  });

  it("does no database or network work until APNs is configured", async () => {
    await notifyLiveActivities(session);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("pushes the newest running timer state to every registered activity", async () => {
    configureApns();
    mocks.query
      .mockResolvedValueOnce({ rows: [{ token: "b".repeat(64), environment: "production" }] })
      .mockResolvedValueOnce({ rows: [{
        id: "entry-1",
        description: "Architecture",
        categoryName: "Work",
        categoryColor: "#123456",
        startedAt: "2026-08-06T05:00:00.000Z"
      }] })
      .mockResolvedValueOnce({ rows: [] });
    await notifyLiveActivities(session);

    const request = http2Mocks.calls[0];
    expect(request.authority).toBe("https://api.push.apple.com");
    expect(request.headers).toEqual(expect.objectContaining({
      ":path": `/3/device/${"b".repeat(64)}`,
      "apns-push-type": "liveactivity",
      "apns-topic": "com.layereight.dayframe.push-type.liveactivity"
    }));
    expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
      aps: expect.objectContaining({
        event: "update",
        "content-state": expect.objectContaining({
          title: "Architecture",
          categoryName: "Work",
          isRunning: true
        })
      })
    }));
  });

  it("ends and immediately dismisses stale activities after a remote stop", async () => {
    configureApns();
    mocks.query
      .mockResolvedValueOnce({ rows: [{ token: "c".repeat(64), environment: "development" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValue({ rows: [] });
    await notifyLiveActivities(session);

    const request = http2Mocks.calls[0];
    expect(request.authority).toContain("api.sandbox.push.apple.com");
    const payload = JSON.parse(String(request.body));
    expect(payload.aps.event).toBe("end");
    expect(payload.aps["dismissal-date"]).toBeLessThan(payload.aps.timestamp);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toContain("invalidated_at");
  });
});

function configureApns() {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  process.env.APNS_KEY_ID = "KEY123";
  process.env.APNS_TEAM_ID = "TEAM123";
  process.env.APNS_PRIVATE_KEY = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}
