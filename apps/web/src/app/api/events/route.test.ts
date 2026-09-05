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
  scheduleLiveActivityNotification: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  processActivityEvent: mocks.processActivityEvent,
  TimerMutationBusyError: class TimerMutationBusyError extends Error {
    code = "timer_busy";
    status = 503;

    constructor(message = "This timer is busy. Dayframe will retry the Stop shortly.") {
      super(message);
      this.name = "TimerMutationBusyError";
    }
  }
}));

vi.mock("@/lib/live-activity-post-response", () => ({
  scheduleLiveActivityNotification: mocks.scheduleLiveActivityNotification
}));

const { databasePayloadError, databaseReadinessError, missingRequiredColumnError } = await import("@/lib/db");
const { POST } = await import("./route");

describe("POST /api/events", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.processActivityEvent.mockResolvedValue({ eventId: "event-1", candidate: { action: "create_review_item" } });
  });

  it("processes an activity event for the resolved session", async () => {
    const response = await POST(jsonRequest(healthSleepEvent()));
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload.eventId).toBe("event-1");
    expect(mocks.processActivityEvent).toHaveBeenCalledWith(healthSleepEvent(), session);
    expect(mocks.scheduleLiveActivityNotification).toHaveBeenCalledWith(session);
  });

  it("accepts an idempotent Live Activity stop retry without creating another mutation", async () => {
    const stopEvent = {
      source: "shortcut",
      type: "timer_stop",
      occurredAt: "2026-08-06T09:30:00.000Z",
      clientEventId: "ios-shortcut-stop-1722936600000-event",
      rawPayload: { origin: "ios_app_intent" }
    };
    mocks.processActivityEvent.mockResolvedValueOnce({
      eventId: "event-stop-1",
      candidate: { action: "stop_timer" },
      duplicate: true
    });

    const response = await POST(jsonRequest(stopEvent));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ eventId: "event-stop-1", duplicate: true });
    expect(mocks.processActivityEvent).toHaveBeenCalledWith(stopEvent, session);
  });

  it("preserves canonical timer-entry correlation on an idempotent start replay", async () => {
    const startEvent = {
      source: "mobile_app",
      type: "timer_start",
      occurredAt: "2026-08-08T06:00:00.000Z",
      clientEventId: "optimistic-active-timer:offline-replay",
      rawPayload: { origin: "mobile_custom_start_fallback" }
    };
    mocks.processActivityEvent.mockResolvedValueOnce({
      eventId: "event-start-existing",
      timeEntryId: "entry-start-canonical",
      candidate: { action: "start_timer" },
      duplicate: true
    });

    const response = await POST(jsonRequest(startEvent));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      duplicate: true,
      eventId: "event-start-existing",
      timeEntryId: "entry-start-canonical"
    });
  });

  it("returns a stable retryable response when an exact timer Stop is busy", async () => {
    const { TimerMutationBusyError } = await import("@/lib/event-service");
    mocks.processActivityEvent.mockRejectedValueOnce(new TimerMutationBusyError());

    const response = await POST(jsonRequest({
      source: "mobile_app",
      type: "timer_stop",
      occurredAt: "2026-08-19T09:30:00.000Z",
      clientEventId: "mobile-stop-entry-1",
      rawPayload: {
        origin: "mobile_timer_stop",
        stopScope: "entry",
        targetEntryId: "80000000-0000-4000-8000-000000000001"
      }
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "timer_busy" });
  });

  it.each([
    { code: "42703", message: 'column "resolved_time_entry_id" does not exist' },
    missingRequiredColumnError("activity_events", "resolved_time_entry_id", "schema prerequisite"),
  ])("returns the Health resolution-link migration prerequisite as retryable readiness", async (error) => {
    mocks.processActivityEvent.mockRejectedValueOnce(error);
    const response = await POST(jsonRequest(healthSleepEvent()));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "database_not_ready",
      reason: "required_migration_missing",
      objectName: "activity_events.resolved_time_entry_id",
      migrationHint: expect.stringContaining("202609040001_health_sleep_resolution_link.sql"),
    });
    expect(mocks.scheduleLiveActivityNotification).not.toHaveBeenCalled();
  });

  it("returns a precise schema error when health sleep storage is missing", async () => {
    mocks.processActivityEvent.mockRejectedValueOnce(
      databaseReadinessError(
        "Database schema is missing public.health_sleep_segments. Run supabase/migrations/202607070001_health_sleep_segments.sql before syncing Health events.",
        "public.health_sleep_segments",
        "supabase/migrations/202607070001_health_sleep_segments.sql"
      )
    );

    const response = await POST(jsonRequest(healthSleepEvent()));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain("public.health_sleep_segments");
    expect(payload.error).toContain("202607070001_health_sleep_segments.sql");
  });

  it("returns a precise schema error when mobile event idempotency is missing", async () => {
    mocks.processActivityEvent.mockRejectedValueOnce(
      missingRequiredColumnError(
        "activity_events",
        "client_event_id",
        "supabase/migrations/202607030001_mobile_event_idempotency_and_workouts.sql"
      )
    );

    const response = await POST(jsonRequest(healthSleepEvent()));
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toContain("activity_events.client_event_id");
    expect(payload.error).toContain("202607030001_mobile_event_idempotency_and_workouts.sql");
  });

  it("returns a precise payload error instead of the generic migration message", async () => {
    mocks.processActivityEvent.mockRejectedValueOnce(
      databasePayloadError(
        "Unable to sync this Health workout because a numeric value could not be stored. Update Dayframe and tap Retry failed.",
        "health_workout_import"
      )
    );

    const response = await POST(jsonRequest(healthWorkoutEvent()));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error).toContain("numeric value");
    expect(payload.error).not.toContain("migrations");
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function healthSleepEvent() {
  return {
    source: "health_sleep",
    type: "health_sleep_import",
    occurredAt: "2026-06-06T22:24:00.000Z",
    clientEventId: "local-health-sleep-1",
    rawPayload: {
      provider: "healthkit",
      externalSampleId: "sleep-sample-1",
      sleepStage: "asleep_core",
      startedAt: "2026-06-06T22:24:00.000Z",
      stoppedAt: "2026-06-07T05:55:00.000Z",
      sourceName: "Apple Watch"
    }
  };
}

function healthWorkoutEvent() {
  return {
    source: "health_workout",
    type: "health_workout_import",
    occurredAt: "2026-06-07T06:39:00.000Z",
    clientEventId: "local-health-workout-1",
    rawPayload: {
      provider: "healthkit",
      externalSampleId: "workout-sample-1",
      workoutType: "walking",
      startedAt: "2026-06-07T06:39:00.000Z",
      stoppedAt: "2026-06-07T07:43:18.000Z",
      durationSeconds: 3858.122684240341
    }
  };
}
