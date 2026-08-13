import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["events:write"]
};

const mocks = vi.hoisted(() => ({
  notifyLiveActivitiesBestEffort: vi.fn(),
  processActivityEvent: vi.fn(),
  resolveLiveActivityControlSession: vi.fn()
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      void callback();
    }
  };
});

vi.mock("@/lib/event-service", () => ({
  processActivityEvent: mocks.processActivityEvent
}));

vi.mock("@/lib/live-activity-push", () => ({
  LiveActivityControlError: class LiveActivityControlError extends Error {},
  notifyLiveActivitiesBestEffort: mocks.notifyLiveActivitiesBestEffort,
  resolveLiveActivityControlSession: mocks.resolveLiveActivityControlSession
}));

const { POST } = await import("./route");

const body = {
  token: "a".repeat(64),
  activityId: "activity-1",
  entryId: "80000000-0000-4000-8000-000000000001",
  clientEventId: "ios-shortcut-stop-1"
};

describe("/api/live-activities/stop", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveLiveActivityControlSession.mockResolvedValue(session);
    mocks.processActivityEvent.mockResolvedValue({
      eventId: "event-1",
      candidate: {},
      stopOutcome: "stopped"
    });
    mocks.notifyLiveActivitiesBestEffort.mockResolvedValue(undefined);
  });

  it("stops only the entry bound to the exact registered Activity capability", async () => {
    const response = await POST(new Request("https://dayframe.test/api/live-activities/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.resolveLiveActivityControlSession).toHaveBeenCalledWith({
      token: body.token,
      activityId: body.activityId,
      entryId: body.entryId
    });
    expect(mocks.processActivityEvent).toHaveBeenCalledWith({
      source: "shortcut",
      type: "timer_stop",
      occurredAt: expect.any(Date),
      clientEventId: body.clientEventId,
      rawPayload: {
        origin: "ios_live_activity",
        stopScope: "entry",
        targetActivityId: body.activityId,
        targetEntryId: body.entryId
      }
    }, session);
    expect(mocks.notifyLiveActivitiesBestEffort).toHaveBeenCalledWith(session);
  });

  it("returns idempotent duplicate delivery as success", async () => {
    mocks.processActivityEvent.mockResolvedValue({
      eventId: "event-1",
      candidate: {},
      duplicate: true
    });

    const response = await POST(new Request("https://dayframe.test/api/live-activities/stop", {
      method: "POST",
      body: JSON.stringify(body)
    }));

    expect(response.status).toBe(200);
  });

  it("confirms a stable retry after the timer mutation committed but its response was lost", async () => {
    mocks.processActivityEvent
      .mockResolvedValueOnce({
        eventId: "event-1",
        candidate: {},
        stopOutcome: "stopped"
      })
      .mockResolvedValueOnce({
        eventId: "event-1",
        candidate: {},
        duplicate: true
      });

    const request = () => new Request("https://dayframe.test/api/live-activities/stop", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        clientEventId: "ios-live-activity-stop-control-1"
      })
    });

    const committedResponse = await POST(request());
    const retryResponse = await POST(request());

    expect(committedResponse.status).toBe(201);
    expect(retryResponse.status).toBe(200);
    expect(mocks.resolveLiveActivityControlSession).toHaveBeenCalledTimes(2);
    expect(mocks.processActivityEvent).toHaveBeenNthCalledWith(2,
      expect.objectContaining({
        clientEventId: "ios-live-activity-stop-control-1",
        rawPayload: expect.objectContaining({
          targetEntryId: body.entryId
        })
      }),
      session
    );
  });

  it("rejects malformed capabilities before touching timer state", async () => {
    const response = await POST(new Request("https://dayframe.test/api/live-activities/stop", {
      method: "POST",
      body: JSON.stringify({ ...body, token: "not-a-token" })
    }));

    expect(response.status).toBe(400);
    expect(mocks.resolveLiveActivityControlSession).not.toHaveBeenCalled();
    expect(mocks.processActivityEvent).not.toHaveBeenCalled();
  });

  it("uses one generic response for stale or invalid capability identity", async () => {
    const { LiveActivityControlError } = await import("@/lib/live-activity-push");
    mocks.resolveLiveActivityControlSession.mockRejectedValue(
      new LiveActivityControlError("specific internal reason")
    );

    const response = await POST(new Request("https://dayframe.test/api/live-activities/stop", {
      method: "POST",
      body: JSON.stringify(body)
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Live Activity control is unavailable."
    });
    expect(mocks.processActivityEvent).not.toHaveBeenCalled();
  });
});
