import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  pool: {
    connect: vi.fn()
  },
  getNormalizationContext: vi.fn()
}));

vi.mock("./db", async () => {
  const actual = await vi.importActual<typeof import("./db")>("./db");
  return {
    ...actual,
    pool: mocks.pool,
    query: mocks.query
  };
});

vi.mock("./queries", () => ({
  getNormalizationContext: mocks.getNormalizationContext
}));

const {
  createPlace,
  createPlaceFromLearnedPlace,
  createEntity,
  deletePlace,
  deleteTimeEntry,
  processActivityEvent,
  reprocessHealthReviewItems,
  resolveReviewItem,
  TimeEntryNotFoundError,
  updateLearnedPlaceStatus,
  updateCategory,
  updatePlace
} = await import("./event-service");

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

describe("category persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getNormalizationContext.mockResolvedValue({
      projects: [],
      categories: [{ id: categoryId(), name: "Focus", color: "lime", isPinned: true }],
      places: [],
      automationRules: []
    });
  });

  it("persists pin state to the categories.is_pinned column", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ id: categoryId(), name: "Focus", color: "lime", isPinned: true }]
    });

    const result = await updateCategory(categoryId(), { isPinned: true }, session);

    expect(result?.isPinned).toBe(true);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('is_pinned = case when $7 then $8 else is_pinned end'),
      [
        categoryId(),
        session.workspaceId,
        false,
        null,
        false,
        null,
        true,
        true
      ]
    );
  });

  it("persists unpin state to the categories.is_pinned column", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ id: categoryId(), name: "Focus", color: "lime", isPinned: false }]
    });

    const result = await updateCategory(categoryId(), { isPinned: false }, session);

    expect(result?.isPinned).toBe(false);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.any(String),
      [
        categoryId(),
        session.workspaceId,
        false,
        null,
        false,
        null,
        true,
        false
      ]
    );
  });

  it("does not silently reload categories as unpinned when the pin column is missing", async () => {
    mocks.query.mockRejectedValueOnce(
      Object.assign(new Error('column "is_pinned" does not exist'), { code: "42703" })
    );

    await expect(updateCategory(categoryId(), { isPinned: true }, session)).rejects.toThrow(
      /categories\.is_pinned/
    );
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("closes an existing active timer before inserting a category-only replacement", async () => {
    const occurredAt = new Date("2026-07-05T09:30:00.000Z");
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("for update")) {
          return { rows: [{ id: "active-1", startedAt: "2026-07-05T09:00:00.000Z" }] };
        }
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(
      {
        source: "manual_app",
        type: "timer_start",
        occurredAt,
        categoryId: categoryId()
      },
      session
    );

    const closeActiveCall = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("set stopped_at = $1")
    );
    expect(closeActiveCall?.[1]).toEqual([occurredAt, session.workspaceId, session.userId]);

    const insertEntryCall = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(insertEntryCall?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      null,
      categoryId(),
      null,
      "manual_app",
      "high",
      null,
      occurredAt,
      "event-1"
    ]);
    expect(client.release).toHaveBeenCalled();
  });

  it("creates a review-only commute candidate from location learning", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("from categories")) return { rows: [] };
        if (statement.includes("insert into categories")) return { rows: [{ id: commuteCategoryId() }] };
        if (statement.includes("insert into activity_events")) return { rows: [{ id: "event-commute" }] };
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await processActivityEvent(
      {
        source: "location_learning",
        type: "commute_detected",
        occurredAt: new Date("2026-07-06T08:25:00.000Z"),
        rawPayload: {
          fromPlaceName: "Home",
          toPlaceName: "Gym",
          startedAt: "2026-07-06T08:00:00.000Z",
          stoppedAt: "2026-07-06T08:25:00.000Z"
        }
      },
      session
    );

    expect(result.candidate).toMatchObject({
      action: "create_review_item",
      reviewStatus: "needs_review",
      categoryId: commuteCategoryId(),
      title: "Commute from Home to Gym"
    });
    expect(client.query.mock.calls.some(([statement]) => String(statement).includes("insert into time_entries"))).toBe(false);
    const reviewInsert = client.query.mock.calls.find(([statement]) => String(statement).includes("insert into review_items"));
    expect(reviewInsert?.[1]).toEqual([
      session.workspaceId,
      "event-commute",
      "commute_detected_suggestion",
      "Commute from Home to Gym",
      null,
      commuteCategoryId(),
      null,
      "2026-07-06T08:00:00.000Z",
      "2026-07-06T08:25:00.000Z",
      "medium",
      "Commute learning proposes transitions between visits, but keeps them review-first before creating time."
    ]);
  });

  it("rolls learned place visits into learned_places while keeping the visit in review", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("insert into activity_events")) return { rows: [{ id: "event-learned" }] };
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await processActivityEvent(
      {
        source: "location_learning",
        type: "learned_place_visit",
        occurredAt: new Date("2026-07-06T09:24:00.000Z"),
        description: "Regular place near 51.610, -0.220",
        rawPayload: {
          candidateName: "Regular place near 51.610, -0.220",
          clusterKey: "51.610,-0.220",
          latitude: 51.61,
          longitude: -0.22,
          radiusMeters: 160,
          startedAt: "2026-07-06T09:00:00.000Z",
          stoppedAt: "2026-07-06T09:24:00.000Z",
          sampleCount: 3
        }
      },
      session
    );

    expect(result.candidate).toMatchObject({
      action: "create_review_item",
      reviewStatus: "needs_review",
      confidence: "low"
    });
    const learnedPlaceInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into learned_places")
    );
    expect(learnedPlaceInsert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      null,
      "51.610,-0.220",
      "Regular place near 51.610, -0.220",
      51.61,
      -0.22,
      160,
      3,
      "2026-07-06T09:00:00.000Z",
      "2026-07-06T09:24:00.000Z",
      expect.any(String)
    ]);
    expect(client.query.mock.calls.some(([statement]) => String(statement).includes("insert into time_entries"))).toBe(false);
  });

  it("rolls back when a replacement start would stop the active timer before it began", async () => {
    const occurredAt = new Date("2026-07-05T09:30:00.000Z");
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("for update")) {
          return { rows: [{ id: "active-1", startedAt: "2026-07-05T09:45:00.000Z" }] };
        }
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await expect(processActivityEvent(
      {
        source: "manual_app",
        type: "timer_start",
        occurredAt,
        categoryId: categoryId()
      },
      session
    )).rejects.toThrow(/Start time must be after/);

    expect(client.query).toHaveBeenCalledWith("rollback");
    expect(client.query.mock.calls.some(([statement]) => String(statement).includes("set stopped_at = $1"))).toBe(false);
    expect(client.query.mock.calls.some(([statement]) => String(statement).includes("insert into time_entries"))).toBe(false);
    expect(client.release).toHaveBeenCalled();
  });
});

describe("place persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates category-first places without default project or auto-start", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        id: placeId(),
        name: "Gym",
        latitude: 51.5,
        longitude: -0.12,
        radiusMeters: 100,
        priority: 5,
        defaultProjectId: null,
        defaultCategoryId: categoryId(),
        defaultActivityDescription: "Workout",
        autoStart: false
      }]
    });

    const result = await createPlace(
      {
        name: " Gym ",
        latitude: 51.5,
        longitude: -0.12,
        radiusMeters: 100,
        priority: 5,
        defaultCategoryId: categoryId(),
        defaultActivityDescription: " Workout ",
        autoStart: false
      },
      session
    );

    expect(result?.name).toBe("Gym");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("default_project_id"),
      [
        session.workspaceId,
        "Gym",
        51.5,
        -0.12,
        100,
        5,
        categoryId(),
        "Workout",
        false
      ]
    );
  });

  it("promotes a learned candidate while creating a saved place", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("from learned_places")) return { rows: [{ id: "learned-1" }] };
        if (statement.includes("with inserted as")) {
          return {
            rows: [{
              id: placeId(),
              name: "Office",
              latitude: 51.5,
              longitude: -0.12,
              radiusMeters: 160,
              priority: 5,
              defaultProjectId: null,
              defaultProjectName: null,
              defaultCategoryId: null,
              defaultCategoryName: null,
              defaultActivityDescription: null,
              autoStart: false
            }]
          };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await createPlaceFromLearnedPlace(
      "40000000-0000-4000-8000-000000000001",
      {
        name: "Office",
        latitude: 51.5,
        longitude: -0.12,
        radiusMeters: 160,
        priority: 5,
        autoStart: false
      },
      session
    );

    expect(result?.id).toBe(placeId());
    expect(client.query).toHaveBeenCalledWith("begin");
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("from learned_places"),
      ["40000000-0000-4000-8000-000000000001", session.workspaceId, session.userId]
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("set status = 'accepted'"),
      ["40000000-0000-4000-8000-000000000001", session.workspaceId, session.userId, placeId()]
    );
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("ignores learned candidates without touching saved places", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: "40000000-0000-4000-8000-000000000001" }] });

    const result = await updateLearnedPlaceStatus(
      "40000000-0000-4000-8000-000000000001",
      "ignored",
      session
    );

    expect(result?.id).toBe("40000000-0000-4000-8000-000000000001");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("set status = $4"),
      ["40000000-0000-4000-8000-000000000001", session.workspaceId, session.userId, "ignored"]
    );
  });

  it("updates only the supplied mobile place fields", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ id: placeId(), name: "Office", radiusMeters: 150, defaultActivityDescription: null }]
    });

    await updatePlace(
      placeId(),
      {
        name: "Office",
        radiusMeters: 150,
        defaultCategoryId: null,
        defaultActivityDescription: null
      },
      session
    );

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("where id = $1 and workspace_id = $2"),
      [
        placeId(),
        session.workspaceId,
        true,
        "Office",
        false,
        null,
        false,
        null,
        true,
        150,
        false,
        5,
        true,
        null,
        true,
        null,
        false,
        false
      ]
    );
  });

  it("deletes places within the active workspace", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ id: placeId() }] });

    await deletePlace(placeId(), session);

    expect(mocks.query).toHaveBeenCalledWith(
      "delete from places where id = $1 and workspace_id = $2 returning id",
      [placeId(), session.workspaceId]
    );
  });
});

describe("automation rule persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("persists natural-language activity descriptions on automation rules", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ placeOk: true, projectOk: true, categoryOk: true }] })
      .mockResolvedValueOnce({ rows: [{ id: "rule-1" }] });

    await createEntity(
      "automation_rule",
      {
        name: "Chelmsford Station pickup/drop-off",
        triggerSource: "geofence_specific",
        triggerType: "geofence_exit",
        placeId: placeId(),
        action: "create_review_item",
        categoryId: categoryId(),
        activityDescription: "Train station pickup/drop-off",
        confidenceThreshold: "medium_high"
      },
      session
    );

    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.stringContaining("activity_description"),
      [
        session.workspaceId,
        "Chelmsford Station pickup/drop-off",
        "geofence_specific",
        "geofence_exit",
        placeId(),
        "create_review_item",
        null,
        categoryId(),
        "Train station pickup/drop-off",
        "medium_high"
      ]
    );
  });

  it("rejects automation rules that reference entities outside the workspace", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ placeOk: false, projectOk: true, categoryOk: true }] });

    await expect(
      createEntity(
        "automation_rule",
        {
          name: "Foreign place",
          placeId: placeId(),
          categoryId: categoryId()
        },
        session
      )
    ).rejects.toThrow(/active workspace/);
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });
});

describe("health event persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getNormalizationContext.mockResolvedValue({
      projects: [],
      categories: [
        { id: healthCategoryId(), name: "Health", color: "moss", isPinned: false },
        { id: sleepCategoryId(), name: "Sleep", color: "lime", isPinned: false }
      ],
      places: [],
      automationRules: []
    });
  });

  it("stores health sleep imports with HealthKit payload fields and idempotent conflict handling", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(healthSleepEvent(), session);

    const healthInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into health_sleep_segments")
    );
    expect(String(healthInsert?.[0])).toContain("where external_sample_id is not null");
    expect(healthInsert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      "sleep-core-1",
      "healthkit",
      "Apple Watch",
      "asleep_core",
      "2026-06-06T23:55:00.000Z",
      "2026-06-07T02:15:00.000Z",
      JSON.stringify((healthSleepEvent().rawPayload.samples as Array<Record<string, unknown>>)[0])
    ]);
    expect(
      client.query.mock.calls.filter(([statement]) => String(statement).includes("insert into health_sleep_segments"))
    ).toHaveLength(3);
    const reviewInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into review_items")
    );
    expect(String(reviewInsert?.[0])).toContain("suggested_stopped_at");
    expect(reviewInsert?.[1]).toEqual([
      session.workspaceId,
      "event-1",
      "health_sleep_import_suggestion",
      "Sleep",
      null,
      sleepCategoryId(),
      null,
      "2026-06-06T23:55:00.000Z",
      "2026-06-07T06:27:00.000Z",
      "high",
      "Sleep imports are reviewed when the duration or confidence is uncertain."
    ]);
    expect(client.query).toHaveBeenCalledWith("commit");
    expect(client.release).toHaveBeenCalled();
  });

  it("auto-confirms high-confidence Health sleep as completed Sleep time", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("from time_entries")) return { rows: [] };
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(
      healthSleepEvent({ autoConfirm: true, durationSeconds: 23520 }),
      session
    );

    const entryInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(entryInsert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      null,
      sleepCategoryId(),
      null,
      "health_sleep",
      "high",
      "Sleep",
      "2026-06-06T23:55:00.000Z",
      "2026-06-07T06:27:00.000Z",
      "event-1"
    ]);
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into review_items"))
    ).toBeUndefined();
    expect(
      client.query.mock.calls.filter(([statement]) => String(statement).includes("insert into health_sleep_segments"))
    ).toHaveLength(3);
  });

  it("does not duplicate auto-confirmed Health sleep entries on clientEventId retry", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("client_event_id = $3")) return { rows: [{ id: "event-existing" }] };
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await processActivityEvent(
      {
        ...healthSleepEvent({ autoConfirm: true, durationSeconds: 23520 }),
        clientEventId: "healthkit-sleep:sleep-session-1"
      },
      session
    );

    expect(result).toEqual({
      eventId: "event-existing",
      candidate: expect.objectContaining({ action: "create_time_entry" }),
      duplicate: true
    });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("rounds fractional Health workout durations before inserting integer duration seconds", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(healthWorkoutEvent(), session);

    const healthInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into health_workouts")
    );
    expect(String(healthInsert?.[0])).toContain("duration_seconds");
    expect(healthInsert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      "workout-sample-1",
      "healthkit",
      "walking",
      "2026-06-07T06:39:00.000Z",
      "2026-06-07T07:43:18.000Z",
      3858,
      5123.75,
      284.5,
      JSON.stringify(healthWorkoutEvent().rawPayload)
    ]);
  });

  it("reuses the Health category for Health workout review suggestions", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(healthWorkoutEvent({ description: "Walk" }), session);

    const reviewInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into review_items")
    );
    expect(reviewInsert?.[1]).toEqual([
      session.workspaceId,
      "event-1",
      "health_workout_import_suggestion",
      "Walk",
      null,
      healthCategoryId(),
      null,
      "2026-06-07T06:39:00.000Z",
      "2026-06-07T07:43:18.000Z",
      "high",
      "Health workouts are reviewed when the type, duration, or confidence is uncertain."
    ]);
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into categories"))
    ).toBeUndefined();
  });

  it("creates the Health category when a Health import has no matching category", async () => {
    mocks.getNormalizationContext.mockResolvedValueOnce({
      projects: [],
      categories: [],
      places: [],
      automationRules: []
    });
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("from categories")) return { rows: [] };
        if (statement.includes("insert into categories")) return { rows: [{ id: healthCategoryId() }] };
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(healthWorkoutEvent({ description: "Walk" }), session);

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("from categories"),
      [session.workspaceId, "Health"]
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into categories"),
      [session.workspaceId, "Health", "moss"]
    );
    const activityInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into activity_events")
    );
    expect((activityInsert?.[1] as unknown[])[10]).toBe(healthCategoryId());
  });

  it("auto-confirms high-confidence normal Health workouts as completed entries", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("from time_entries")) return { rows: [] };
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(healthWorkoutEvent({ autoConfirm: true, description: "Walk" }), session);

    const entryInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(entryInsert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      null,
      healthCategoryId(),
      null,
      "health_workout",
      "high",
      "Walk",
      "2026-06-07T06:39:00.000Z",
      "2026-06-07T07:43:18.000Z",
      "event-1"
    ]);
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into review_items"))
    ).toBeUndefined();
  });

  it("sends short or unknown Health workouts to review", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(healthWorkoutEvent({
      autoConfirm: true,
      description: "Walk",
      durationSeconds: 120,
      stoppedAt: "2026-06-07T06:41:00.000Z"
    }), session);

    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into review_items"))
    ).toBeTruthy();
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
  });

  it("keeps overlapping auto-confirm Health workouts in review", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("from time_entries")) return { rows: [{ id: "entry-existing" }] };
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(healthWorkoutEvent({ autoConfirm: true, description: "Walk" }), session);

    const reviewInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into review_items")
    );
    expect(reviewInsert?.[1]).toContain("This Health activity overlaps existing time and needs review before becoming confirmed time.");
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
  });

  it("reprocesses existing high-confidence Walk review candidates using current preferences", async () => {
    const client = reprocessClient([
      healthWorkoutReviewRow({
        id: "review-walk-4",
        eventId: "event-walk-4",
        startedAt: "2026-07-06T06:33:00.000Z",
        stoppedAt: "2026-07-06T06:37:00.000Z",
        durationSeconds: 4 * 60
      }),
      healthWorkoutReviewRow({
        id: "review-walk-5",
        eventId: "event-walk-5",
        startedAt: "2026-07-04T18:19:00.000Z",
        stoppedAt: "2026-07-04T18:24:00.000Z",
        durationSeconds: 5 * 60
      }),
      healthWorkoutReviewRow({
        id: "review-walk-37",
        eventId: "event-walk-37",
        startedAt: "2026-07-04T19:09:00.000Z",
        stoppedAt: "2026-07-04T19:46:00.000Z",
        durationSeconds: 37 * 60,
        workoutType: null
      })
    ]);
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    const reviewSelect = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("from review_items ri") && String(statement).includes("for update of ri")
    );
    expect(reviewSelect?.[0]).toContain("skip locked");
    expect(result).toMatchObject({
      checkedCount: 3,
      confirmedCount: 2,
      remainingReviewCount: 1,
      updatedCategoryCount: 3
    });
    const entryInserts = client.query.mock.calls.filter(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(entryInserts).toHaveLength(2);
    expect(entryInserts.map(([, values]) => (values as unknown[])[10])).toEqual([
      "event-walk-5",
      "event-walk-37"
    ]);
    expect(entryInserts.every(([, values]) => (values as unknown[])[3] === healthCategoryId())).toBe(true);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("set suggested_category_id = $2"),
      ["review-walk-4", healthCategoryId()]
    );
    expect(
      client.query.mock.calls.filter(([statement]) =>
        String(statement).includes("set status = $2") &&
        ((statement as string).includes("update review_items"))
      ).map(([, values]) => (values as unknown[]).slice(0, 2))
    ).toEqual([
      ["review-walk-5", "accepted"],
      ["review-walk-37", "accepted"]
    ]);
  });

  it("reprocesses Health review candidates with custom auto-log mappings", async () => {
    const mappedCategoryId = "20000000-0000-4000-8000-000000000099";
    const client = reprocessClient([
      healthWorkoutReviewRow({
        id: "review-walk-mapped",
        eventId: "event-walk-mapped",
        durationSeconds: 37 * 60
      })
    ]);
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      },
      mappings: {
        walking: {
          categoryId: mappedCategoryId,
          description: "Morning walk"
        }
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 1,
      confirmedCount: 1,
      updatedCategoryCount: 1
    });
    const entryInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect((entryInsert?.[1] as unknown[])[3]).toBe(mappedCategoryId);
    expect((entryInsert?.[1] as unknown[])[7]).toBe("Morning walk");
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("set suggested_category_id = $2"),
      ["review-walk-mapped", mappedCategoryId]
    );
  });

  it("limits Health review reprocess batches and reports remaining production work", async () => {
    const client = reprocessClient([]);
    client.query.mockImplementation(async (statement: string) => {
      if (statement.includes("select count(*)::int")) return { rows: [{ count: 5 }] };
      if (statement.includes("from review_items ri") && statement.includes("for update of ri")) {
        return {
          rows: [
            healthWorkoutReviewRow({
              id: "review-walk-1",
              eventId: "event-walk-1",
              durationSeconds: 16 * 60
            }),
            healthWorkoutReviewRow({
              id: "review-walk-2",
              eventId: "event-walk-2",
              durationSeconds: 37 * 60
            })
          ]
        };
      }
      if (statement.includes("from categories")) return { rows: [{ id: healthCategoryId() }] };
      if (statement.includes("created_from_event_id = $3")) return { rows: [] };
      if (statement.includes("started_at < $4::timestamptz")) return { rows: [] };
      if (statement.includes("insert into time_entries")) return { rows: [{ id: "entry" }] };
      return { rows: [] };
    });
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      limit: 2,
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    const reviewSelect = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("from review_items ri") && String(statement).includes("for update of ri")
    );
    expect(reviewSelect?.[1]).toEqual([session.workspaceId, session.userId, 2, false]);
    expect(reviewSelect?.[0]).toContain("ri.notes is null or ri.notes not like 'Left in Review:%'");
    expect(reviewSelect?.[0]).toContain("ae.event_type = 'health_workout_import'");
    expect(result).toMatchObject({
      batchSize: 2,
      checkedCount: 2,
      confirmedCount: 2,
      remainingReviewCount: 5,
      partial: true,
      hasMore: true
    });
    expect(
      client.query.mock.calls.filter(([statement]) => String(statement).includes("insert into time_entries"))
    ).toHaveLength(2);
  });

  it("ignores existing Walk review candidates when Walking import is disabled", async () => {
    const client = reprocessClient([
      healthWorkoutReviewRow({
        id: "review-walk-disabled",
        eventId: "event-walk-disabled",
        durationSeconds: 37 * 60
      })
    ]);
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: false,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 1,
      confirmedCount: 0,
      ignoredCount: 1
    });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("set status = $2"),
      ["review-walk-disabled", "ignored"]
    );
  });

  it("leaves overlapping Health review candidates open with stale open timer blocker details", async () => {
    const client = reprocessClient([
      healthWorkoutReviewRow({
        id: "review-overlap",
        eventId: "event-overlap",
        durationSeconds: 16 * 60
      })
    ]);
    client.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from review_items ri") && statement.includes("for update of ri")) {
        return {
          rows: [
            healthWorkoutReviewRow({
              id: "review-overlap",
              eventId: "event-overlap",
              durationSeconds: 16 * 60
            })
          ]
        };
      }
      if (statement.includes("from categories")) return { rows: [{ id: healthCategoryId() }] };
      if (statement.includes("created_from_event_id = $3")) return { rows: [] };
      if (statement.includes("health_covering_entry")) return { rows: [] };
      if (statement.includes("from time_entries te")) {
        return {
          rows: [
            {
              id: "entry-open",
              description: "BAU",
              source: "manual_app",
              reviewStatus: "confirmed",
              startedAt: "2026-07-04T08:00:00.000Z",
              stoppedAt: null,
              categoryName: "Work",
              stoppedAtIsNull: true
            }
          ]
        };
      }
      return { rows: [] };
    });
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 1,
      confirmedCount: 0,
      leftInReviewCount: 1,
      remainingReviewCount: 1,
      reasons: [
        {
          reviewItemId: "review-overlap",
          code: "overlap",
          blockingEntry: {
            id: "entry-open",
            stoppedAtIsNull: true
          }
        }
      ]
    });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("set notes = $2"),
      ["review-overlap", "Left in Review: overlaps stale open timer \"BAU\" with no stop time."]
    );
  });

  it("accepts Health review candidates already covered by confirmed Health time", async () => {
    const client = reprocessClient([
      healthWorkoutReviewRow({
        id: "review-walk-covered",
        eventId: "event-walk-covered",
        durationSeconds: 37 * 60
      })
    ]);
    client.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from review_items ri") && statement.includes("for update of ri")) {
        return {
          rows: [
            healthWorkoutReviewRow({
              id: "review-walk-covered",
              eventId: "event-walk-covered",
              durationSeconds: 37 * 60
            })
          ]
        };
      }
      if (statement.includes("from categories")) return { rows: [{ id: healthCategoryId() }] };
      if (statement.includes("created_from_event_id = $3")) return { rows: [] };
      if (statement.includes("health_covering_entry")) {
        return {
          rows: [
            {
              id: "entry-covered",
              description: "Walk",
              source: "health_workout",
              reviewStatus: "confirmed",
              startedAt: "2026-07-04T19:09:00.000Z",
              stoppedAt: "2026-07-04T19:46:00.000Z",
              categoryName: "Health",
              stoppedAtIsNull: false
            }
          ]
        };
      }
      if (statement.includes("started_at < $4::timestamptz")) {
        throw new Error("Covered Health review items should not run generic overlap checks.");
      }
      return { rows: [] };
    });
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 1,
      confirmedCount: 1,
      remainingReviewCount: 0
    });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("set status = $2"),
      ["review-walk-covered", "accepted"]
    );
  });

  it("reprocesses existing eligible Sleep review candidates into confirmed Sleep entries", async () => {
    const client = reprocessClient([
      healthSleepReviewRow({
        id: "review-sleep",
        eventId: "event-sleep",
        startedAt: "2026-07-06T23:55:00.000Z",
        stoppedAt: "2026-07-07T06:27:00.000Z",
        durationSeconds: 23520
      })
    ]);
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result.confirmedCount).toBe(1);
    const entryInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(entryInsert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      null,
      sleepCategoryId(),
      null,
      "health_sleep",
      "high",
      "Sleep",
      "2026-07-06T23:55:00.000Z",
      "2026-07-07T06:27:00.000Z",
      "event-sleep"
    ]);
  });

  it("repairs old confirmed Health-category Sleep entries when Sleep import is enabled", async () => {
    const client = reprocessClient([]);
    client.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from review_items ri") && statement.includes("for update of ri")) return { rows: [] };
      if (statement.includes("from categories")) return { rows: [{ id: sleepCategoryId() }] };
      if (statement.includes("update time_entries te")) return { rowCount: 1, rows: [{ id: "entry-sleep-old" }] };
      if (statement.includes("select count(*)::int")) return { rows: [{ count: 0, unexplainedCount: 0 }] };
      return { rows: [] };
    });
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 0,
      repairedSleepEntryCount: 1,
      remainingReviewCount: 0
    });
    const repairCall = client.query.mock.calls.find(([statement]) => String(statement).includes("update time_entries te"));
    expect(repairCall?.[0]).toContain("lower(current_category.name) = 'health'");
    expect(repairCall?.[0]).toContain("te.review_status in ('confirmed', 'accepted')");
    expect(repairCall?.[0]).toContain("lower(coalesce(te.description, '')) = 'sleep'");
    expect(repairCall?.[0]).toContain("te.source = 'health_sleep'");
    expect(repairCall?.[0]).toContain("ae.event_type = 'health_sleep_import'");
    expect(repairCall?.[1]).toEqual([session.workspaceId, session.userId, sleepCategoryId()]);
  });

  it("does not run the legacy Sleep category repair when Sleep import is disabled", async () => {
    const client = reprocessClient([]);
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: false,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 0,
      repairedSleepEntryCount: 0
    });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("update time_entries te"))
    ).toBeUndefined();
  });

  it("keeps a failed Health review candidate open while processing valid candidates", async () => {
    const client = reprocessClient([
      healthWorkoutReviewRow({
        id: "review-bad",
        eventId: "event-bad",
        durationSeconds: 37 * 60
      }),
      healthWorkoutReviewRow({
        id: "review-good",
        eventId: "event-good",
        durationSeconds: 37 * 60
      })
    ]);
    client.query.mockImplementation(async (statement: string, values?: unknown[]) => {
      if (statement.includes("insert into time_entries") && (values as unknown[])?.[10] === "event-bad") {
        throw new Error("bad candidate");
      }
      if (statement.includes("from review_items ri") && statement.includes("for update of ri")) {
        return {
          rows: [
            healthWorkoutReviewRow({
              id: "review-bad",
              eventId: "event-bad",
              durationSeconds: 37 * 60
            }),
            healthWorkoutReviewRow({
              id: "review-good",
              eventId: "event-good",
              durationSeconds: 37 * 60
            })
          ]
        };
      }
      if (statement.includes("from categories")) return { rows: [{ id: healthCategoryId() }] };
      if (statement.includes("created_from_event_id = $3")) return { rows: [] };
      if (statement.includes("started_at < $4::timestamptz")) return { rows: [] };
      return { rows: [] };
    });
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 2,
      confirmedCount: 1,
      failedCount: 1,
      skippedCount: 1,
      remainingReviewCount: 1
    });
    expect(result.errorSummary[0]).toContain("review-bad");
    const entryInserts = client.query.mock.calls.filter(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(entryInserts.map(([, values]) => (values as unknown[])[10])).toEqual([
      "event-bad",
      "event-good"
    ]);
    expect(client.query).toHaveBeenCalledWith("rollback to savepoint reprocess_health_item");
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("consolidates legacy sleep stage review rows into one confirmed sleep entry", async () => {
    const client = reprocessClient([
      healthSleepReviewRow({
        id: "review-core",
        eventId: "event-core",
        startedAt: "2026-07-06T23:55:00.000Z",
        stoppedAt: "2026-07-07T02:15:00.000Z",
        durationSeconds: 140 * 60,
        suggestedCategoryId: healthCategoryId(),
        eventCategoryId: healthCategoryId()
      }),
      healthSleepReviewRow({
        id: "review-deep",
        eventId: "event-deep",
        startedAt: "2026-07-07T02:15:00.000Z",
        stoppedAt: "2026-07-07T03:10:00.000Z",
        durationSeconds: 55 * 60,
        suggestedCategoryId: healthCategoryId(),
        eventCategoryId: healthCategoryId()
      }),
      healthSleepReviewRow({
        id: "review-rem",
        eventId: "event-rem",
        startedAt: "2026-07-07T03:10:00.000Z",
        stoppedAt: "2026-07-07T06:27:00.000Z",
        durationSeconds: 197 * 60,
        suggestedCategoryId: healthCategoryId(),
        eventCategoryId: healthCategoryId()
      })
    ]);
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 3,
      confirmedCount: 1,
      remainingReviewCount: 0
    });
    const entryInserts = client.query.mock.calls.filter(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(entryInserts).toHaveLength(1);
    expect(entryInserts[0]?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      null,
      sleepCategoryId(),
      null,
      "health_sleep",
      "high",
      "Sleep",
      "2026-07-06T23:55:00.000Z",
      "2026-07-07T06:27:00.000Z",
      "event-core"
    ]);
    const acceptedUpdates = client.query.mock.calls.filter(([statement, values]) =>
      String(statement).includes("update review_items") &&
      String(statement).includes("set status = $2") &&
      (values as unknown[])?.[1] === "accepted"
    );
    expect(acceptedUpdates).toHaveLength(3);
    const coveringLookup = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("health_covering_entry")
    );
    expect(String(coveringLookup?.[0])).toContain("te.review_status in ('confirmed', 'accepted')");
  });

  it("accepts legacy sleep stage rows already covered by a confirmed Sleep entry", async () => {
    const rows = [
      healthSleepReviewRow({
        id: "review-core-covered",
        eventId: "event-core-covered",
        startedAt: "2026-07-06T23:55:00.000Z",
        stoppedAt: "2026-07-07T02:15:00.000Z",
        durationSeconds: 140 * 60,
        suggestedCategoryId: healthCategoryId(),
        eventCategoryId: healthCategoryId()
      }),
      healthSleepReviewRow({
        id: "review-deep-covered",
        eventId: "event-deep-covered",
        startedAt: "2026-07-07T02:15:00.000Z",
        stoppedAt: "2026-07-07T03:10:00.000Z",
        durationSeconds: 55 * 60,
        suggestedCategoryId: healthCategoryId(),
        eventCategoryId: healthCategoryId()
      }),
      healthSleepReviewRow({
        id: "review-rem-covered",
        eventId: "event-rem-covered",
        startedAt: "2026-07-07T03:10:00.000Z",
        stoppedAt: "2026-07-07T06:27:00.000Z",
        durationSeconds: 197 * 60,
        suggestedCategoryId: healthCategoryId(),
        eventCategoryId: healthCategoryId()
      })
    ];
    const client = reprocessClient(rows);
    client.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from review_items ri") && statement.includes("for update of ri")) {
        return { rows };
      }
      if (statement.includes("from categories")) return { rows: [{ id: healthCategoryId() }] };
      if (statement.includes("created_from_event_id = $3")) return { rows: [] };
      if (statement.includes("health_covering_entry")) {
        return {
          rows: [
            {
              id: "entry-sleep-covered",
              description: "Sleep",
              source: "health_sleep",
              reviewStatus: "confirmed",
              startedAt: "2026-07-06T23:55:00.000Z",
              stoppedAt: "2026-07-07T06:27:00.000Z",
              categoryName: "Health",
              stoppedAtIsNull: false
            }
          ]
        };
      }
      if (statement.includes("started_at < $4::timestamptz")) {
        throw new Error("Covered sleep stages should not run generic overlap checks.");
      }
      return { rows: [] };
    });
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 3,
      confirmedCount: 1,
      remainingReviewCount: 0
    });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
    const acceptedUpdates = client.query.mock.calls.filter(([statement, values]) =>
      String(statement).includes("update review_items") &&
      String(statement).includes("set status = $2") &&
      (values as unknown[])?.[1] === "accepted"
    );
    expect(acceptedUpdates).toHaveLength(3);
  });

  it("ignores legacy awake sleep stage review rows during consolidation", async () => {
    const awakeRow = {
      ...healthSleepReviewRow({
        id: "review-awake",
        eventId: "event-awake",
        startedAt: "2026-07-07T04:39:00.000Z",
        stoppedAt: "2026-07-07T04:41:00.000Z",
        durationSeconds: 2 * 60,
        suggestedCategoryId: healthCategoryId(),
        eventCategoryId: healthCategoryId()
      }),
      title: "Sleep awake",
      rawPayload: {
        provider: "healthkit",
        externalSampleId: "event-awake",
        sleepStage: "awake",
        startedAt: "2026-07-07T04:39:00.000Z",
        stoppedAt: "2026-07-07T04:41:00.000Z",
        durationSeconds: 2 * 60
      }
    };
    const client = reprocessClient([awakeRow]);
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 1,
      confirmedCount: 0,
      ignoredCount: 1,
      remainingReviewCount: 0
    });
    const ignoredUpdates = client.query.mock.calls.filter(([statement, values]) =>
      String(statement).includes("update review_items") &&
      String(statement).includes("set status = $2") &&
      (values as unknown[])?.[1] === "ignored"
    );
    expect(ignoredUpdates).toHaveLength(1);
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
  });

  it("accepts legacy sleep stage rows covered by a Health category Sleep entry", async () => {
    const row = {
      ...healthSleepReviewRow({
        id: "review-core-covered-by-manual-sleep",
        eventId: "event-core-covered-by-manual-sleep",
        startedAt: "2026-07-07T04:41:00.000Z",
        stoppedAt: "2026-07-07T04:46:00.000Z",
        durationSeconds: 5 * 60,
        suggestedCategoryId: healthCategoryId(),
        eventCategoryId: healthCategoryId()
      }),
      title: "Sleep asleep core",
      rawPayload: {
        provider: "healthkit",
        externalSampleId: "event-core-covered-by-manual-sleep",
        sleepStage: "asleep_core",
        startedAt: "2026-07-07T04:41:00.000Z",
        stoppedAt: "2026-07-07T04:46:00.000Z",
        durationSeconds: 5 * 60
      }
    };
    const client = reprocessClient([row]);
    client.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from review_items ri") && statement.includes("for update of ri")) {
        return { rows: [row] };
      }
      if (statement.includes("from categories")) return { rows: [{ id: healthCategoryId() }] };
      if (statement.includes("created_from_event_id = $3")) return { rows: [] };
      if (statement.includes("health_covering_entry")) {
        return {
          rows: [
            {
              id: "entry-sleep-covered",
              description: "Sleep",
              source: "manual_app",
              reviewStatus: "confirmed",
              startedAt: "2026-07-07T00:00:00.000Z",
              stoppedAt: "2026-07-07T07:00:00.000Z",
              categoryName: "Health",
              stoppedAtIsNull: false
            }
          ]
        };
      }
      if (statement.includes("started_at < $4::timestamptz")) {
        throw new Error("Covered sleep stage should not run generic overlap checks.");
      }
      return { rows: [] };
    });
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 1,
      confirmedCount: 1,
      remainingReviewCount: 0
    });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
    const coveringLookup = client.query.mock.calls.find(([statement, values]) =>
      String(statement).includes("health_covering_entry") && (values as unknown[])?.[4] === "Sleep"
    );
    expect(coveringLookup).toBeTruthy();
    expect(String(coveringLookup?.[0])).toContain("te.review_status in ('confirmed', 'accepted')");
  });

  it("returns a structured failure when the Health category cannot be ensured", async () => {
    const client = reprocessClient([
      healthWorkoutReviewRow({
        id: "review-walk",
        eventId: "event-walk",
        durationSeconds: 37 * 60
      })
    ]);
    client.query.mockImplementation(async (statement: string, values?: unknown[]) => {
      if (statement.includes("from review_items ri") && statement.includes("for update of ri")) {
        return { rows: [healthWorkoutReviewRow({ id: "review-walk", eventId: "event-walk" })] };
      }
      if (statement.includes("from categories") && values?.[1] === "Sleep") return { rows: [{ id: sleepCategoryId() }] };
      if (statement.includes("update time_entries te")) return { rowCount: 0, rows: [] };
      if (statement.includes("from categories")) throw new Error("categories unavailable");
      return { rows: [] };
    });
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await reprocessHealthReviewItems({
      preferences: {
        sleep: true,
        walking: true,
        running: true,
        cycling: true,
        strength_training: false,
        swimming: false,
        other: false
      }
    }, session);

    expect(result).toMatchObject({
      checkedCount: 1,
      confirmedCount: 0,
      failedCount: 1
    });
    expect(result.errorSummary[0]).toContain("Skipped review-walk");
    expect(client.query).toHaveBeenCalledWith("rollback to savepoint reprocess_health_item");
    expect(client.query).toHaveBeenCalledWith("commit");
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
  });

  it("stores queued Health sleep imports under the resolved session workspace when the payload has stale ids", async () => {
    const hostedSession = {
      ...session,
      userId: "00000000-0000-4000-8000-000000000002",
      workspaceId: "00000000-0000-4000-8000-000000000011"
    };
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await processActivityEvent(staleWorkspaceHealthSleepEvent(), hostedSession);

    const duplicateLookup = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("client_event_id = $3")
    );
    expect(duplicateLookup?.[1]).toEqual([
      hostedSession.workspaceId,
      hostedSession.userId,
      "local-health-sleep-1"
    ]);

    const activityInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into activity_events")
    );
    expect((activityInsert?.[1] as unknown[]).slice(0, 2)).toEqual([
      hostedSession.workspaceId,
      hostedSession.userId
    ]);

    const healthInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into health_sleep_segments")
    );
    expect((healthInsert?.[1] as unknown[]).slice(0, 2)).toEqual([
      hostedSession.workspaceId,
      hostedSession.userId
    ]);
  });

  it("checks clientEventId idempotency in the resolved session workspace when the payload has stale ids", async () => {
    const hostedSession = {
      ...session,
      userId: "00000000-0000-4000-8000-000000000002",
      workspaceId: "00000000-0000-4000-8000-000000000011"
    };
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("client_event_id = $3")) return { rows: [{ id: "event-existing" }] };
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await processActivityEvent(staleWorkspaceHealthSleepEvent(), hostedSession);

    const duplicateLookup = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("client_event_id = $3")
    );
    expect(duplicateLookup?.[1]).toEqual([
      hostedSession.workspaceId,
      hostedSession.userId,
      "local-health-sleep-1"
    ]);
    expect(result).toEqual({
      eventId: "event-existing",
      candidate: expect.objectContaining({ action: "create_review_item" }),
      duplicate: true
    });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into activity_events"))
    ).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("does not duplicate auto-confirmed Health workout entries on clientEventId retry", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("client_event_id = $3")) return { rows: [{ id: "event-existing" }] };
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await processActivityEvent(
      {
        ...healthWorkoutEvent({ autoConfirm: true, description: "Walk" }),
        clientEventId: "healthkit-workout:workout-sample-1"
      },
      session
    );

    expect(result).toEqual({
      eventId: "event-existing",
      candidate: expect.objectContaining({ action: "create_time_entry" }),
      duplicate: true
    });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("identifies a stale authenticated workspace foreign key failure", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("insert into activity_events")) {
          throw Object.assign(
            new Error(
              'insert or update on table "activity_events" violates foreign key constraint "activity_events_workspace_id_fkey"'
            ),
            { code: "23503", constraint: "activity_events_workspace_id_fkey" }
          );
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await expect(processActivityEvent(healthSleepEvent(), session)).rejects.toThrow(
      /Authenticated session workspace is missing from public\.workspaces/
    );
    expect(client.query).toHaveBeenCalledWith("rollback");
  });

  it("identifies a missing health sleep table instead of throwing a generic sync failure", async () => {
    const client = healthClientWithFailure(
      Object.assign(new Error('relation "health_sleep_segments" does not exist'), { code: "42P01" })
    );
    mocks.pool.connect.mockResolvedValueOnce(client);

    await expect(processActivityEvent(healthSleepEvent(), session)).rejects.toThrow(
      /public\.health_sleep_segments.*202607070001_health_sleep_segments\.sql/
    );
  });

  it("identifies a missing health sleep idempotency index", async () => {
    const client = healthClientWithFailure(
      Object.assign(
        new Error("there is no unique or exclusion constraint matching the ON CONFLICT specification"),
        { code: "42P10" }
      )
    );
    mocks.pool.connect.mockResolvedValueOnce(client);

    await expect(processActivityEvent(healthSleepEvent(), session)).rejects.toThrow(
      /idx_health_sleep_segments_external_sample/
    );
    expect(client.query).toHaveBeenCalledWith("rollback");
  });
});

describe("review item resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("accepts Health review candidates as completed entries with their suggested stop time", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("from review_items ri")) {
          return {
            rows: [
              {
                id: "review-1",
                eventId: "event-1",
                title: "Sleep",
                suggestedProjectId: null,
                suggestedCategoryId: healthCategoryId(),
                suggestedPlaceId: null,
                suggestedStartedAt: "2026-06-06T23:55:00.000Z",
                suggestedStoppedAt: "2026-06-07T06:27:00.000Z",
                confidence: "high",
                status: "open",
                eventSource: "health_sleep",
                eventType: "health_sleep_import"
              }
            ]
          };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await resolveReviewItem("review-1", "accept", session);

    const entryInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    const reviewSelect = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("from review_items ri")
    );
    expect(reviewSelect?.[0]).toContain("pl.default_activity_description");
    expect(reviewSelect?.[0]).toContain("geofence_exit");
    expect(entryInsert?.[0]).toContain("'confirmed'");
    expect(entryInsert?.[0]).not.toContain("'accepted'");
    expect(entryInsert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      null,
      healthCategoryId(),
      null,
      "health_sleep",
      "high",
      "Sleep",
      "2026-06-06T23:55:00.000Z",
      "2026-06-07T06:27:00.000Z",
      "event-1"
    ]);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("accepts commute reviews as category-only entries without descriptions", async () => {
    const client = {
      query: vi.fn(async (statement: string, values?: unknown[]) => {
        void values;
        if (statement.includes("from review_items ri")) {
          return {
            rows: [
              {
                id: "review-commute",
                eventId: "event-commute",
                title: "Commute from Home to Office",
                status: "open",
                suggestedProjectId: null,
                suggestedCategoryId: commuteCategoryId(),
                suggestedPlaceId: null,
                suggestedStartedAt: "2026-07-06T08:00:00.000Z",
                suggestedStoppedAt: "2026-07-06T08:42:00.000Z",
                confidence: "medium",
                eventSource: "location_learning",
                eventType: "commute_detected"
              }
            ]
          };
        }
        if (statement.includes("created_from_event_id = $3")) return { rows: [] };
        if (statement.includes("insert into time_entries")) return { rows: [{ id: "entry-commute" }] };
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await resolveReviewItem("review-commute", "accept", session);

    const entryInsert = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into time_entries")
    );
    expect(entryInsert?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      null,
      commuteCategoryId(),
      null,
      "location_learning",
      "medium",
      null,
      "2026-07-06T08:00:00.000Z",
      "2026-07-06T08:42:00.000Z",
      "event-commute"
    ]);
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("validates review-created automation rule references before saving", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("from review_items ri")) {
          return {
            rows: [
              {
                id: "review-rule",
                eventId: "event-rule",
                title: "Station pickup",
                status: "open",
                suggestedProjectId: null,
                suggestedCategoryId: categoryId(),
                suggestedPlaceId: placeId(),
                suggestedStartedAt: "2026-07-04T19:09:00.000Z",
                suggestedStoppedAt: "2026-07-04T19:46:00.000Z",
                confidence: "medium_high",
                eventSource: "geofence_specific",
                eventType: "geofence_exit"
              }
            ]
          };
        }
        if (statement.includes("select ($2::uuid is null or exists")) {
          return { rows: [{ placeOk: true, projectOk: true, categoryOk: true }] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await resolveReviewItem("review-rule", "create_rule", session);

    const reviewSelect = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("from review_items ri")
    );
    expect(reviewSelect?.[0]).toContain('p.id as "suggestedProjectId"');
    expect(reviewSelect?.[0]).toContain('c.id as "suggestedCategoryId"');
    expect(reviewSelect?.[0]).toContain('pl.id as "suggestedPlaceId"');
    expect(reviewSelect?.[0]).toContain("ae.workspace_id = ri.workspace_id");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("select ($2::uuid is null or exists"), [
      session.workspaceId,
      placeId(),
      null,
      categoryId()
    ]);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("insert into automation_rules"),
      [
        session.workspaceId,
        "Suggestion from Station pickup",
        "geofence_specific",
        "geofence_exit",
        placeId(),
        null,
        categoryId(),
        "Station pickup",
        "medium_high"
      ]
    );
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("marks duplicate event-created review candidates accepted without creating a second entry", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("from review_items ri")) {
          return {
            rows: [
              {
                id: "review-duplicate",
                eventId: "event-duplicate",
                title: "Walk",
                status: "open",
                suggestedProjectId: null,
                suggestedCategoryId: healthCategoryId(),
                suggestedPlaceId: null,
                suggestedStartedAt: "2026-07-04T19:09:00.000Z",
                suggestedStoppedAt: "2026-07-04T19:46:00.000Z",
                confidence: "high",
                eventSource: "health_workout",
                eventType: "health_workout_import"
              }
            ]
          };
        }
        if (statement.includes("created_from_event_id = $3")) {
          return { rows: [{ id: "entry-existing" }] };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    const result = await resolveReviewItem("review-duplicate", "accept", session);

    expect(result).toMatchObject({ ok: true, duplicate: true, entryId: "entry-existing" });
    expect(
      client.query.mock.calls.find(([statement]) => String(statement).includes("insert into time_entries"))
    ).toBeUndefined();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("set status = $3"),
      ["review-duplicate", session.workspaceId, "accepted", null]
    );
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("treats already-resolved review candidates as idempotent success", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("from review_items ri")) {
          return {
            rows: [
              {
                id: "review-accepted",
                eventId: "event-accepted",
                title: "Walk",
                status: "accepted",
                suggestedProjectId: null,
                suggestedCategoryId: healthCategoryId(),
                suggestedPlaceId: null,
                suggestedStartedAt: "2026-07-04T19:09:00.000Z",
                suggestedStoppedAt: "2026-07-04T19:46:00.000Z",
                confidence: "high",
                eventSource: "health_workout",
                eventType: "health_workout_import"
              }
            ]
          };
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await expect(resolveReviewItem("review-accepted", "accept", session)).resolves.toMatchObject({
      ok: true,
      alreadyResolved: true,
      status: "accepted"
    });
    expect(client.query).toHaveBeenCalledWith("commit");
  });

  it("returns a structured locked error when Health reprocess is holding the review row", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("from review_items ri")) {
          throw Object.assign(new Error("could not obtain lock on row in relation review_items"), {
            code: "55P03"
          });
        }
        return { rows: [] };
      }),
      release: vi.fn()
    };
    mocks.pool.connect.mockResolvedValueOnce(client);

    await expect(resolveReviewItem("review-locked", "accept", session)).rejects.toMatchObject({
      code: "review_item_locked",
      status: 409
    });
    const reviewSelect = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("from review_items ri")
    );
    expect(reviewSelect?.[0]).toContain("nowait");
    expect(client.query).toHaveBeenCalledWith("rollback");
  });
});

describe("time entry deletion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("hard-deletes active or completed entries in the current user workspace scope", async () => {
    mocks.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await expect(deleteTimeEntry("entry-1", session)).resolves.toEqual({
      id: "entry-1",
      deleted: true
    });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("delete from time_entries where id = $1 and workspace_id = $2 and user_id = $3"),
      ["entry-1", session.workspaceId, session.userId]
    );
    expect(mocks.query.mock.calls[0][0]).not.toContain("stopped_at");
  });

  it("does not delete entries outside the current user or workspace scope", async () => {
    mocks.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(deleteTimeEntry("other-entry", session)).rejects.toBeInstanceOf(TimeEntryNotFoundError);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.any(String),
      ["other-entry", session.workspaceId, session.userId]
    );
  });
});

function categoryId() {
  return "20000000-0000-4000-8000-000000000001";
}

function healthCategoryId() {
  return "20000000-0000-4000-8000-000000000004";
}

function sleepCategoryId() {
  return "20000000-0000-4000-8000-000000000008";
}

function commuteCategoryId() {
  return "20000000-0000-4000-8000-000000000009";
}

function placeId() {
  return "30000000-0000-4000-8000-000000000001";
}

function reprocessClient(reviewRows: Array<Record<string, unknown>>) {
  return {
    query: vi.fn(async (statement: string, values?: unknown[]) => {
      if (statement.includes("from review_items ri") && statement.includes("for update of ri")) {
        return { rows: reviewRows };
      }
      if (statement.includes("from categories")) {
        return { rows: [{ id: values?.[1] === "Sleep" ? sleepCategoryId() : healthCategoryId() }] };
      }
      if (statement.includes("created_from_event_id = $3")) return { rows: [] };
      if (statement.includes("health_covering_entry")) return { rows: [] };
      if (statement.includes("started_at < $4::timestamptz")) return { rows: [] };
      return { rows: [] };
    }),
    release: vi.fn()
  };
}

function healthWorkoutReviewRow(overrides: {
  id?: string;
  eventId?: string;
  startedAt?: string;
  stoppedAt?: string;
  durationSeconds?: number;
  suggestedCategoryId?: string | null;
  eventCategoryId?: string | null;
  workoutType?: string | null;
} = {}) {
  const startedAt = overrides.startedAt ?? "2026-07-04T19:09:00.000Z";
  const stoppedAt = overrides.stoppedAt ?? "2026-07-04T19:46:00.000Z";
  const rawPayload: Record<string, unknown> = {
    provider: "healthkit",
    externalSampleId: overrides.eventId ?? "event-walk",
    startedAt,
    stoppedAt,
    durationSeconds: overrides.durationSeconds ?? 37 * 60
  };
  if (overrides.workoutType !== null) {
    rawPayload.workoutType = overrides.workoutType ?? "walking";
  }
  return {
    id: overrides.id ?? "review-walk",
    eventId: overrides.eventId ?? "event-walk",
    title: "Walk",
    suggestedProjectId: null,
    suggestedCategoryId: overrides.suggestedCategoryId ?? null,
    suggestedPlaceId: null,
    suggestedStartedAt: startedAt,
    suggestedStoppedAt: stoppedAt,
    confidence: "high",
    eventSource: "health_workout",
    eventType: "health_workout_import",
    eventCategoryId: overrides.eventCategoryId ?? null,
    rawPayload
  };
}

function healthSleepReviewRow(overrides: {
  id?: string;
  eventId?: string;
  startedAt?: string;
  stoppedAt?: string;
  durationSeconds?: number;
  suggestedCategoryId?: string | null;
  eventCategoryId?: string | null;
} = {}) {
  const startedAt = overrides.startedAt ?? "2026-07-06T23:55:00.000Z";
  const stoppedAt = overrides.stoppedAt ?? "2026-07-07T06:27:00.000Z";
  return {
    id: overrides.id ?? "review-sleep",
    eventId: overrides.eventId ?? "event-sleep",
    title: "Sleep",
    suggestedProjectId: null,
    suggestedCategoryId: overrides.suggestedCategoryId ?? null,
    suggestedPlaceId: null,
    suggestedStartedAt: startedAt,
    suggestedStoppedAt: stoppedAt,
    confidence: "high",
    eventSource: "health_sleep",
    eventType: "health_sleep_import",
    eventCategoryId: overrides.eventCategoryId ?? null,
    rawPayload: {
      provider: "healthkit",
      externalSampleId: overrides.eventId ?? "event-sleep",
      startedAt,
      stoppedAt,
      durationSeconds: overrides.durationSeconds ?? 23520
    }
  };
}

function healthClientWithFailure(error: Error & { code?: string }) {
  return {
    query: vi.fn(async (statement: string, values?: unknown[]) => {
      void values;
      if (statement.includes("health_sleep_segments")) throw error;
      return statement.includes("returning id") ? { rows: [{ id: "event-1" }] } : { rows: [] };
    }),
    release: vi.fn()
  };
}

function healthSleepEvent(overrides: {
  autoConfirm?: boolean;
  durationSeconds?: number;
} = {}) {
  const rawPayload: Record<string, unknown> = {
    provider: "healthkit",
    externalSampleId: "sleep-session-1",
    sleepStage: "asleep_unspecified",
    startedAt: "2026-06-06T23:55:00.000Z",
    stoppedAt: "2026-06-07T06:27:00.000Z",
    sourceName: "Apple Watch",
    samples: [
      {
        externalSampleId: "sleep-core-1",
        sleepStage: "asleep_core",
        startedAt: "2026-06-06T23:55:00.000Z",
        stoppedAt: "2026-06-07T02:15:00.000Z",
        sourceName: "Apple Watch",
        sample: { uuid: "sleep-core-1" }
      },
      {
        externalSampleId: "sleep-deep-1",
        sleepStage: "asleep_deep",
        startedAt: "2026-06-07T02:15:00.000Z",
        stoppedAt: "2026-06-07T03:10:00.000Z",
        sourceName: "Apple Watch",
        sample: { uuid: "sleep-deep-1" }
      },
      {
        externalSampleId: "sleep-rem-1",
        sleepStage: "asleep_rem",
        startedAt: "2026-06-07T03:10:00.000Z",
        stoppedAt: "2026-06-07T06:27:00.000Z",
        sourceName: "Apple Watch",
        sample: { uuid: "sleep-rem-1" }
      }
    ]
  };
  if (typeof overrides.autoConfirm === "boolean") rawPayload.autoConfirm = overrides.autoConfirm;
  if (typeof overrides.durationSeconds === "number") rawPayload.durationSeconds = overrides.durationSeconds;

  return {
    source: "health_sleep",
    type: "health_sleep_import",
    occurredAt: new Date("2026-06-06T23:55:00.000Z"),
    description: "Sleep",
    rawPayload
  };
}

function healthWorkoutEvent(overrides: {
  autoConfirm?: boolean;
  description?: string;
  durationSeconds?: number;
  stoppedAt?: string;
  workoutType?: string;
} = {}) {
  const durationSeconds = overrides.durationSeconds ?? 3858.122684240341;
  const stoppedAt = overrides.stoppedAt ?? "2026-06-07T07:43:18.000Z";
  const workoutType = overrides.workoutType ?? "walking";
  return {
    source: "health_workout",
    type: "health_workout_import",
    occurredAt: new Date("2026-06-07T06:39:00.000Z"),
    description: overrides.description ?? "Workout walking",
    rawPayload: {
      provider: "healthkit",
      externalSampleId: "workout-sample-1",
      workoutType,
      startedAt: "2026-06-07T06:39:00.000Z",
      stoppedAt,
      durationSeconds,
      distanceMeters: 5123.75,
      energyKcal: 284.5,
      autoConfirm: overrides.autoConfirm ?? false,
      sourceName: "Apple Watch",
      sample: {
        uuid: "workout-sample-1"
      }
    }
  };
}

function staleWorkspaceHealthSleepEvent() {
  return {
    ...healthSleepEvent(),
    workspaceId: "00000000-0000-4000-8000-000000000010",
    userId: "00000000-0000-4000-8000-000000000001",
    clientEventId: "local-health-sleep-1",
    rawPayload: {
      ...healthSleepEvent().rawPayload,
      workspaceId: "00000000-0000-4000-8000-000000000010"
    }
  };
}
