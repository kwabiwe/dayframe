import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
  resolveLocation: vi.fn()
}));

vi.mock("./db", () => ({
  pool: { connect: mocks.connect, query: mocks.poolQuery },
  isLockNotAvailableError: vi.fn(() => false),
  isStatementTimeoutError: vi.fn(() => false),
  isQueryCancelledError: vi.fn(() => false),
  query: vi.fn()
}));

vi.mock("./location/location-review-service", () => ({
  resolveLocationReviewActionWithClient: mocks.resolveLocation
}));

vi.mock("./tag-service", () => ({
  syncTimeEntryTags: vi.fn()
}));

const { resolveIdempotentReviewMutation } = await import(
  "./review-mutation-service"
);

const session = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "provider" as const,
  scopes: ["app:write"]
};

const envelope = {
  clientMutationId: "d87c35ce-2a63-4e44-a8fc-4370f2a5cda4",
  mutation: { action: "confirm" as const }
};

describe("idempotent Review mutations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.poolQuery.mockResolvedValue({ rows: [] });
    mocks.connect.mockResolvedValue(clientForNewLocation());
  });

  it("returns the stored result after a lost response without applying twice", async () => {
    const stored = {
      ok: true,
      action: "confirm",
      status: "accepted",
      entryId: "entry-1"
    };
    const receipt = {
      reviewItemId: "30000000-0000-4000-8000-000000000001",
      actionKey: "confirm",
      requestHash:
        "129dbf398adfb18a4046d2368a27529739dd522d07b3b2c65bd4dee800b8aeee",
      resultJson: stored
    };
    mocks.connect.mockResolvedValue(clientForReceipt(receipt));

    await expect(
      resolveIdempotentReviewMutation(
        "30000000-0000-4000-8000-000000000001",
        envelope,
        session
      )
    ).resolves.toEqual(stored);
    expect(mocks.resolveLocation).not.toHaveBeenCalled();
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it("rejects reuse of one mutation ID with different data", async () => {
    const receipt = {
      reviewItemId: "30000000-0000-4000-8000-000000000001",
      actionKey: "ignore_once_location",
      requestHash: "0".repeat(64),
      resultJson: { ok: true }
    };
    mocks.connect.mockResolvedValue(clientForReceipt(receipt));

    await expect(
      resolveIdempotentReviewMutation(
        "30000000-0000-4000-8000-000000000001",
        envelope,
        session
      )
    ).rejects.toMatchObject({
      code: "mutation_id_conflict",
      status: 409
    });
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it("stores a new location result and receipt in the same transaction", async () => {
    const result = {
      ok: true,
      action: "confirm",
      status: "accepted",
      entryId: "entry-1"
    };
    const client = clientForNewLocation();
    mocks.connect.mockResolvedValue(client);
    mocks.resolveLocation.mockResolvedValue(result);

    await expect(
      resolveIdempotentReviewMutation(
        "30000000-0000-4000-8000-000000000001",
        envelope,
        session
      )
    ).resolves.toEqual(result);

    expect(mocks.resolveLocation).toHaveBeenCalledOnce();
    const receiptCall = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("insert into review_mutation_receipts")
    );
    expect(receiptCall).toBeTruthy();
    expect(client.query).toHaveBeenCalledWith("commit");
    const receiptIndex = receiptCall
      ? client.query.mock.calls.indexOf(receiptCall)
      : -1;
    const commitIndex = client.query.mock.calls.findIndex(
      ([statement]) => statement === "commit"
    );
    expect(receiptIndex).toBeGreaterThan(-1);
    expect(commitIndex).toBeGreaterThan(receiptIndex);
  });

  it("returns typed retryable contention without waiting for the advisory lock", async () => {
    const query = vi.fn(async (statement: string) => {
      if (statement.includes("pg_try_advisory_xact_lock")) {
        return { rows: [{ acquired: false }] };
      }
      return { rows: [] };
    });
    const client = {
      query,
      release: vi.fn()
    } as unknown as import("pg").PoolClient;
    mocks.connect.mockResolvedValue(client);

    await expect(resolveIdempotentReviewMutation(
      "30000000-0000-4000-8000-000000000001",
      envelope,
      session
    )).rejects.toMatchObject({
      code: "review_item_locked",
      status: 409
    });
    expect(query).toHaveBeenCalledWith("rollback");
    expect(query.mock.calls.some(([statement]) =>
      String(statement).includes("set local statement_timeout = '3000ms'")
    )).toBe(true);
    expect(query.mock.calls.some(([statement]) =>
      String(statement).includes("set local lock_timeout = '1500ms'")
    )).toBe(true);
  });

  it("scopes receipt lookup by workspace and user", async () => {
    const client = clientForReceipt(null);
    mocks.connect.mockResolvedValue(client);
    mocks.resolveLocation.mockResolvedValue({
      ok: true,
      action: "confirm",
      status: "accepted"
    });

    await resolveIdempotentReviewMutation(
      "30000000-0000-4000-8000-000000000001",
      envelope,
      session
    );

    const receiptLookup = client.query.mock.calls.find(([statement]) =>
      String(statement).includes("from review_mutation_receipts")
    );
    expect(receiptLookup?.[1]).toEqual([
      session.workspaceId,
      session.userId,
      envelope.clientMutationId
    ]);
  });

  it("persists an overlapping generic edit-and-confirm while keeping mutation receipts", async () => {
    const reviewItemId = "30000000-0000-4000-8000-000000000002";
    const client = clientForOverlappingGenericEdit(reviewItemId);
    mocks.connect.mockResolvedValue(client);

    await expect(resolveIdempotentReviewMutation(
      reviewItemId,
      {
        clientMutationId: "d87c35ce-2a63-4e44-a8fc-4370f2a5cda5",
        mutation: {
          action: "edit_and_confirm",
          edit: {
            categoryId: null,
            placeId: null,
            description: "Walk and call",
            startedAt: "2026-07-27T10:00:00.000Z",
            stoppedAt: "2026-07-27T11:00:00.000Z",
            tags: []
          }
        }
      },
      session
    )).resolves.toMatchObject({
      action: "edit_and_confirm",
      entryId: "overlapping-entry",
      status: "accepted"
    });

    const statements = client.query.mock.calls.map(([statement]) => String(statement));
    expect(statements.some((statement) => statement.includes("insert into time_entries"))).toBe(true);
    expect(statements.some((statement) => statement.includes("insert into review_mutation_receipts"))).toBe(true);
    expect(statements.some((statement) => (
      statement.includes("started_at <") && statement.includes("coalesce(stopped_at")
    ))).toBe(false);
  });

  it("accepts an extended Health sleep review by updating one stable entry and receipt", async () => {
    const reviewItemId = "30000000-0000-4000-8000-000000000003";
    const client = clientForExtendedHealthSleep(reviewItemId);
    mocks.connect.mockResolvedValue(client);

    await expect(resolveIdempotentReviewMutation(
      reviewItemId,
      {
        clientMutationId: "d87c35ce-2a63-4e44-a8fc-4370f2a5cda6",
        mutation: { action: "accept" }
      },
      session
    )).resolves.toMatchObject({
      action: "accept",
      entryId: "health-entry-stable",
      status: "accepted",
      duplicate: true
    });

    const statements = client.query.mock.calls.map(([statement]) => String(statement));
    expect(statements.some((statement) => statement.includes("insert into time_entries"))).toBe(false);
    expect(statements.some((statement) => statement.includes("insert into review_mutation_receipts"))).toBe(true);
    const lockIndex = statements.findIndex((statement) => statement.includes("pg_try_advisory_xact_lock"));
    const matchIndex = statements.findIndex((statement) => statement.includes("matching_health_sleep_session"));
    const updateIndex = statements.findIndex((statement) => statement.startsWith("update time_entries"));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(matchIndex).toBeGreaterThan(lockIndex);
    expect(updateIndex).toBeGreaterThan(matchIndex);
  });
});

function clientForReceipt(receipt: {
  reviewItemId: string;
  actionKey: string;
  requestHash: string;
  resultJson: unknown;
} | null) {
  const query = vi.fn(async (statement: string, values?: unknown[]) => {
    void values;
    if (statement.includes("pg_try_advisory_xact_lock")) {
      return { rows: [{ acquired: true }] };
    }
    if (statement.includes("from review_mutation_receipts")) {
      return { rows: receipt ? [receipt] : [] };
    }
    if (statement.includes("location_segment_id")) {
      return {
        rows: [{ locationSegmentId: "40000000-0000-4000-8000-000000000001" }]
      };
    }
    return { rows: [] };
  });
  return {
    query,
    release: vi.fn()
  } as unknown as import("pg").PoolClient & { query: typeof query };
}

function clientForNewLocation() {
  return clientForReceipt(null);
}

function clientForOverlappingGenericEdit(reviewItemId: string) {
  const query = vi.fn(async (statement: string) => {
    if (statement.includes("pg_try_advisory_xact_lock")) {
      return { rows: [{ acquired: true }] };
    }
    if (statement.includes("from review_mutation_receipts")) return { rows: [] };
    if (statement.includes("for update of ri nowait")) {
      return {
        rows: [{
          id: reviewItemId,
          eventId: "40000000-0000-4000-8000-000000000002",
          title: "Walk",
          status: "open",
          suggestedCategoryId: null,
          suggestedPlaceId: null,
          suggestedStartedAt: "2026-07-27T10:00:00.000Z",
          suggestedStoppedAt: "2026-07-27T11:00:00.000Z",
          confidence: "medium",
          eventSource: "health_workout",
          locationSegmentId: null
        }]
      };
    }
    if (statement.includes("location_segment_id") && statement.includes("from review_items")) {
      return { rows: [{ locationSegmentId: null }] };
    }
    if (statement.includes("from time_entries") && statement.includes("created_from_event_id")) {
      return { rows: [] };
    }
    if (statement.includes("insert into time_entries")) {
      return { rows: [{ id: "overlapping-entry" }] };
    }
    return { rows: [] };
  });
  return {
    query,
    release: vi.fn()
  } as unknown as import("pg").PoolClient & { query: typeof query };
}

function clientForExtendedHealthSleep(reviewItemId: string) {
  const query = vi.fn(async (statement: string, values?: unknown[]) => {
    if (statement.includes("pg_try_advisory_xact_lock")) {
      return { rows: [{ acquired: true }] };
    }
    if (statement.includes("from review_mutation_receipts")) return { rows: [] };
    if (statement.includes("select location_segment_id")) {
      return { rows: [{ locationSegmentId: null }] };
    }
    if (statement.includes("for update of ri nowait")) {
      return {
        rows: [{
          id: reviewItemId,
          eventId: "health-event-extended",
          title: "Sleep",
          status: "open",
          suggestedCategoryId: "sleep-category",
          suggestedPlaceId: null,
          suggestedStartedAt: "2026-07-31T21:53:00.000Z",
          suggestedStoppedAt: "2026-08-01T04:51:00.000Z",
          confidence: "high",
          eventSource: "health_sleep",
          eventType: "health_sleep_import",
          rawPayload: { provider: "healthkit", sourceName: "Apple Watch" },
          locationSegmentId: null
        }]
      };
    }
    if (statement.includes("created_from_event_id = $3")) return { rows: [] };
    if (statement.includes("matching_health_sleep_session")) {
      return {
        rows: [{
          id: "health-entry-stable",
          startedAt: "2026-07-31T21:53:00.000Z",
          stoppedAt: "2026-08-01T03:24:00.000Z",
          rawPayload: { provider: "healthkit", sourceName: "Apple Watch" }
        }]
      };
    }
    if (statement.startsWith("update time_entries")) {
      return {
        rows: [{
          id: "health-entry-stable",
          startedAt: values?.[3],
          stoppedAt: values?.[4]
        }]
      };
    }
    return { rows: [] };
  });
  return {
    query,
    release: vi.fn()
  } as unknown as import("pg").PoolClient & { query: typeof query };
}
