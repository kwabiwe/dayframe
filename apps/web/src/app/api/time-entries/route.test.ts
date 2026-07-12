import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  processActivityEvent: vi.fn(),
  createManualEntry: vi.fn(),
  splitActiveEntry: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  processActivityEvent: mocks.processActivityEvent,
  createManualEntry: mocks.createManualEntry,
  splitActiveEntry: mocks.splitActiveEntry,
  TimerReplacementWindowError: class TimerReplacementWindowError extends Error {
    status = 409;

    constructor(message = "Start time must be after the currently running timer's start time.") {
      super(message);
      this.name = "TimerReplacementWindowError";
    }
  }
}));

const { POST } = await import("./route");

describe("POST /api/time-entries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.processActivityEvent.mockResolvedValue({ eventId: "event-1", candidate: { action: "start_timer" } });
    mocks.createManualEntry.mockResolvedValue(undefined);
  });

  it("starts a category-only task without requiring a project", async () => {
    const response = await POST(jsonRequest({ mode: "start", projectId: "", categoryId: categoryId(), description: "Focus" }));

    expect(response.status).toBe(201);
    expect(mocks.processActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timer_start",
        projectId: undefined,
        categoryId: categoryId(),
        description: "Focus"
      }),
      session
    );
  });

  it("omits blank descriptions for category-only starts", async () => {
    const response = await POST(jsonRequest({ mode: "start", categoryId: categoryId(), description: "   " }));

    expect(response.status).toBe(201);
    expect(mocks.processActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timer_start",
        categoryId: categoryId(),
        description: undefined
      }),
      session
    );
  });

  it("starts an uncategorized task without requiring a project", async () => {
    const response = await POST(jsonRequest({ mode: "start", projectId: "", categoryId: "", description: "Inbox zero" }));

    expect(response.status).toBe(201);
    expect(mocks.processActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timer_start",
        projectId: undefined,
        categoryId: undefined,
        description: "Inbox zero"
      }),
      session
    );
  });

  it("starts a bare uncategorized timer without description or category", async () => {
    const response = await POST(jsonRequest({ mode: "start", projectId: "", categoryId: "", description: "   " }));

    expect(response.status).toBe(201);
    expect(mocks.processActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timer_start",
        projectId: undefined,
        categoryId: undefined,
        description: undefined
      }),
      session
    );
  });

  it("starts a timer at a provided start time", async () => {
    const startedAt = "2026-07-04T09:15:00.000Z";
    const response = await POST(jsonRequest({ mode: "start", categoryId: categoryId(), description: "Focus", startedAt }));

    expect(response.status).toBe(201);
    expect(mocks.processActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timer_start",
        occurredAt: new Date(startedAt),
        categoryId: categoryId(),
        description: "Focus",
        rawPayload: { origin: "web_timer", startedAt }
      }),
      session
    );
  });

  it("returns a client error when a replacement start time would corrupt the active timer", async () => {
    const replacementError = new Error("Start time must be after the currently running timer's start time.");
    replacementError.name = "TimerReplacementWindowError";
    Object.assign(replacementError, { status: 409 });
    Object.setPrototypeOf(replacementError, (await import("@/lib/event-service")).TimerReplacementWindowError.prototype);
    mocks.processActivityEvent.mockRejectedValueOnce(replacementError);

    const response = await POST(jsonRequest({ mode: "start", startedAt: "2026-07-04T09:15:00.000Z" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Start time must be after the currently running timer's start time."
    });
  });

  it("creates a manual entry with no legacy project", async () => {
    const response = await POST(
      jsonRequest({
        mode: "manual",
        projectId: "",
        categoryId: categoryId(),
        description: "Manual block",
        startedAt: "2026-07-04T09:00:00.000Z",
        stoppedAt: "2026-07-04T10:00:00.000Z"
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createManualEntry).toHaveBeenCalledWith(
      {
        projectId: undefined,
        categoryId: categoryId(),
        placeId: undefined,
        description: "Manual block",
        startedAt: "2026-07-04T09:00:00.000Z",
        stoppedAt: "2026-07-04T10:00:00.000Z"
      },
      session
    );
  });

  it("returns a client error for incomplete manual entries", async () => {
    const response = await POST(jsonRequest({ mode: "manual", stoppedAt: "2026-07-04T10:00:00.000Z" }));

    expect(response.status).toBe(400);
    expect(mocks.createManualEntry).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/time-entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function categoryId() {
  return "20000000-0000-4000-8000-000000000001";
}
