import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  processActivityEvent: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  processActivityEvent: mocks.processActivityEvent
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
