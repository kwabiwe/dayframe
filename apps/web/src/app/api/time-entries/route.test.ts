import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  splitActiveEntry: vi.fn(),
  splitFinishedEntry: vi.fn(),
  duplicateFinishedEntry: vi.fn(),
  scheduleLiveActivityNotification: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  processActivityEvent: mocks.processActivityEvent,
  createManualEntry: mocks.createManualEntry,
  splitActiveEntry: mocks.splitActiveEntry,
  splitFinishedEntry: mocks.splitFinishedEntry,
  duplicateFinishedEntry: mocks.duplicateFinishedEntry,
  TimeEntryNotFoundError: class TimeEntryNotFoundError extends Error {},
  TimeEntryConflictError: class TimeEntryConflictError extends Error {},
  TimeEntryValidationError: class TimeEntryValidationError extends Error {},
  TimerStopBeforeStartError: class TimerStopBeforeStartError extends Error {
    status = 422;
    code = "timer_stop_before_start";
  },
  TimerReplacementWindowError: class TimerReplacementWindowError extends Error {
    status = 409;

    constructor(message = "Start time must be after the currently running timer's start time.") {
      super(message);
      this.name = "TimerReplacementWindowError";
    }
  },
  TimerMutationBusyError: class TimerMutationBusyError extends Error {
    code = "timer_busy";
    status = 503;

    constructor(message = "This timer is busy. Dayframe will retry the Stop shortly.") {
      super(message);
      this.name = "TimerMutationBusyError";
    }
  }
}));

vi.mock("@/lib/queries", () => ({ getTimeEntryById: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })) }));

vi.mock("@/lib/live-activity-post-response", () => ({
  scheduleLiveActivityNotification: mocks.scheduleLiveActivityNotification
}));

const { POST } = await import("./route");

describe("POST /api/time-entries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z"));
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.processActivityEvent.mockResolvedValue({ eventId: "event-1", candidate: { action: "start_timer" } });
    mocks.createManualEntry.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("splits or duplicates a finished block by id, fenced and with its command id, and keeps a bare split for the timer (card G)", async () => {
    const entryId = "11111111-1111-4111-8111-111111111111";
    mocks.splitFinishedEntry.mockResolvedValue({ id: entryId, newEntryId: "new-1", replayed: false });
    const split = await POST(new Request("http://localhost/api/time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Dayframe-Client-Command-Id": "web-split-1" },
      body: JSON.stringify({ mode: "split", entryId, splitAt: "2026-07-04T10:30:00.000Z", expectedUpdatedAt: "2026-07-04T11:00:00.000Z" })
    }));
    expect(split.status).toBe(201);
    expect(mocks.splitFinishedEntry).toHaveBeenCalledWith(entryId,
      { splitAt: "2026-07-04T10:30:00.000Z", expectedUpdatedAt: "2026-07-04T11:00:00.000Z", clientCommandId: "web-split-1" }, session);
    expect(mocks.splitActiveEntry).not.toHaveBeenCalled();
    mocks.duplicateFinishedEntry.mockResolvedValue({ id: entryId, newEntryId: "new-1", replayed: true });
    const duplicate = await POST(jsonRequest({ mode: "duplicate", entryId }));
    expect(duplicate.status).toBe(200);
    expect(mocks.duplicateFinishedEntry).toHaveBeenCalledWith(entryId, { expectedUpdatedAt: undefined, clientCommandId: undefined }, session);
    expect((await POST(jsonRequest({ mode: "duplicate" }))).status).toBe(400);
    await POST(jsonRequest({ mode: "split" }));
    expect(mocks.splitActiveEntry).toHaveBeenCalledWith(session);
  });

  it("answers a block changed elsewhere with 409 and the block, and a refused split with 422 (card G)", async () => {
    const entryId = "11111111-1111-4111-8111-111111111111";
    const { TimeEntryConflictError, TimeEntryValidationError } = await import("@/lib/event-service");
    mocks.splitFinishedEntry.mockRejectedValueOnce(new TimeEntryConflictError());
    const conflict = await POST(jsonRequest({ mode: "split", entryId, splitAt: "2026-07-04T10:30:00.000Z" }));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "time_entry_details_conflict", entry: { id: entryId } });
    mocks.duplicateFinishedEntry.mockRejectedValueOnce(new TimeEntryValidationError("That would end in the future."));
    const future = await POST(jsonRequest({ mode: "duplicate", entryId }));
    expect(future.status).toBe(422);
    expect(await future.json()).toEqual({ error: "That would end in the future." });
  });

  it("rejects an unknown mode instead of treating it as a timer start", async () => {
    const response = await POST(jsonRequest({ mode: "restart" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "mode must be one of start, stop, manual, split, or duplicate."
    });
    expect(mocks.processActivityEvent).not.toHaveBeenCalled();
    expect(mocks.createManualEntry).not.toHaveBeenCalled();
    expect(mocks.splitActiveEntry).not.toHaveBeenCalled();
  });

  it("returns a client error for malformed JSON", async () => {
    const response = await POST(new Request("https://dayframe.test/api/time-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{"
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Request body must be valid JSON." });
    expect(mocks.processActivityEvent).not.toHaveBeenCalled();
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

  it("adds optional tag names to the event payload without changing older requests", async () => {
    const response = await POST(jsonRequest({
      mode: "start",
      description: "Plan #planning",
      tagNames: ["Planning"]
    }));

    expect(response.status).toBe(201);
    expect(mocks.processActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Plan #planning",
        rawPayload: { origin: "web_timer", tagNames: ["Planning"] }
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

  it("maps a timer busy error without reporting a migration failure", async () => {
    const { TimerMutationBusyError } = await import("@/lib/event-service");
    mocks.processActivityEvent.mockRejectedValueOnce(new TimerMutationBusyError());

    const response = await POST(jsonRequest({ mode: "stop", source: "mobile_app" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "timer_busy" });
  });

  it("targets an exact entry when a browser Stop supplies its active entry id", async () => {
    const entryId = "80000000-0000-4000-8000-000000000001";
    const response = await POST(jsonRequest({ mode: "stop", entryId }));

    expect(response.status).toBe(201);
    expect(mocks.processActivityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "timer_stop",
        rawPayload: {
          origin: "web_timer",
          stopScope: "entry",
          targetEntryId: entryId
        }
      }),
      session
    );
    expect(mocks.scheduleLiveActivityNotification).toHaveBeenCalledWith(session);
  });

  it("rejects a malformed exact-entry Stop target", async () => {
    const response = await POST(jsonRequest({ mode: "stop", entryId: "not-an-entry" }));

    expect(response.status).toBe(400);
    expect(mocks.processActivityEvent).not.toHaveBeenCalled();
    expect(mocks.scheduleLiveActivityNotification).not.toHaveBeenCalled();
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

  it.each([
    [
      "invalid Start",
      { startedAt: "not-a-timestamp", stoppedAt: "2026-07-04T10:00:00.000Z" },
      "startedAt must be a valid date."
    ],
    [
      "invalid Finish",
      { startedAt: "2026-07-04T09:00:00.000Z", stoppedAt: "not-a-timestamp" },
      "stoppedAt must be a valid date."
    ],
    [
      "reversed interval",
      { startedAt: "2026-07-04T10:00:00.000Z", stoppedAt: "2026-07-04T09:00:00.000Z" },
      "Finish time must be after the start time."
    ],
    [
      "longer than 24 hours",
      { startedAt: "2026-07-04T09:00:00.000Z", stoppedAt: "2026-07-05T09:00:01.000Z" },
      "A block can be no longer than 24 hours."
    ]
  ])("returns a specific 400 for %s", async (_label, interval, error) => {
    const response = await POST(jsonRequest({ mode: "manual", ...interval }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(mocks.createManualEntry).not.toHaveBeenCalled();
  });

  it.each([
    ["ordinary past entry", "2026-07-04T09:00:00.000Z", "2026-07-04T10:00:00.000Z"],
    ["past midnight rollover", "2026-07-03T23:45:00.000Z", "2026-07-04T00:15:00.000Z"],
    ["future entry", "2026-07-04T13:00:00.000Z", "2026-07-04T14:00:00.000Z"],
    ["exactly 24 hours", "2026-07-04T13:00:00.000Z", "2026-07-05T13:00:00.000Z"]
  ])("accepts a valid %s", async (_label, startedAt, stoppedAt) => {
    const response = await POST(jsonRequest({ mode: "manual", startedAt, stoppedAt }));

    expect(response.status).toBe(201);
    expect(mocks.createManualEntry).toHaveBeenCalledWith(
      expect.objectContaining({ startedAt, stoppedAt }),
      session
    );
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
