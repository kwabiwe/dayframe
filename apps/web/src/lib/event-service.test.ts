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

const { deleteTimeEntry, processActivityEvent, TimeEntryNotFoundError, updateCategory } = await import("./event-service");

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
      String(statement).includes("where workspace_id = $2 and user_id = $3 and stopped_at is null")
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
});

describe("health event persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getNormalizationContext.mockResolvedValue({
      projects: [],
      categories: [],
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
      "sleep-sample-1",
      "healthkit",
      "Apple Watch",
      "asleep_core",
      "2026-06-06T22:24:00.000Z",
      "2026-06-07T05:55:00.000Z",
      JSON.stringify(healthSleepEvent().rawPayload)
    ]);
    expect(client.query).toHaveBeenCalledWith("commit");
    expect(client.release).toHaveBeenCalled();
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

function healthSleepEvent() {
  return {
    source: "health_sleep",
    type: "health_sleep_import",
    occurredAt: new Date("2026-06-06T22:24:00.000Z"),
    description: "Sleep asleep core",
    rawPayload: {
      provider: "healthkit",
      externalSampleId: "sleep-sample-1",
      sleepStage: "asleep_core",
      startedAt: "2026-06-06T22:24:00.000Z",
      stoppedAt: "2026-06-07T05:55:00.000Z",
      sourceName: "Apple Watch",
      sample: {
        uuid: "sleep-sample-1"
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
