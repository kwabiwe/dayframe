import { describe, expect, it, vi } from "vitest";
import {
  confirmedLocationCategoryId,
  confirmedLocationDescription,
  resolveLocationReviewActionWithClient
} from "./location-review-service";
import type { RequestSession } from "../session";

vi.mock("../db", () => ({
  pool: { connect: vi.fn() },
  isLockNotAvailableError: vi.fn(() => false)
}));
vi.mock("../tag-service", () => ({
  syncTimeEntryTags: vi.fn()
}));

const session: RequestSession = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "dev",
  scopes: []
};

function categoryClient() {
  return {
    query: vi.fn(async (statement: string) => {
      if (statement.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (statement.includes("from categories")) return { rows: [] };
      if (statement.includes("insert into categories")) {
        return { rows: [{ id: "created-commute" }] };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    })
  } as unknown as import("pg").PoolClient;
}

describe("location review confirmation semantics", () => {
  it("keeps generated commute titles out of confirmed descriptions", () => {
    expect(confirmedLocationDescription("commute", "Commute", undefined)).toBeNull();
    expect(
      confirmedLocationDescription("commute", "Commute", { description: "  Train home  " })
    ).toBe("Train home");
    expect(
      confirmedLocationDescription("commute", "Commute", { description: "   " })
    ).toBeNull();
  });

  it("keeps current visit-title fallback semantics", () => {
    expect(confirmedLocationDescription("stay", "Visit the library", undefined)).toBe(
      "Visit the library"
    );
    expect(
      confirmedLocationDescription("stay", "Visit the library", { description: "   " })
    ).toBe("Visit the library");
  });

  it("self-heals a legacy null-category commute", async () => {
    await expect(
      confirmedLocationCategoryId(categoryClient(), session, "commute", null, undefined)
    ).resolves.toBe("created-commute");
  });

  it("preserves stored and explicitly edited categories", async () => {
    const client = categoryClient();

    await expect(
      confirmedLocationCategoryId(client, session, "commute", "stored-category", undefined)
    ).resolves.toBe("stored-category");
    await expect(
      confirmedLocationCategoryId(client, session, "commute", null, {
        categoryId: "30000000-0000-4000-8000-000000000001"
      })
    ).resolves.toBe("30000000-0000-4000-8000-000000000001");
    await expect(
      confirmedLocationCategoryId(client, session, "commute", null, { categoryId: null })
    ).resolves.toBeNull();
    expect(vi.mocked(client.query)).not.toHaveBeenCalled();
  });

  it("confirms a location Review item without querying for an overlap conflict", async () => {
    const client = {
      query: vi.fn(async (statement: string) => {
        if (statement.includes("for update of ri, ae nowait")) {
          return {
            rows: [{
              id: "review-1",
              eventId: "event-1",
              status: "open",
              title: "Visit library",
              confidence: "high",
              suggestedCategoryId: null,
              suggestedPlaceId: null,
              suggestedStartedAt: "2026-07-27T10:00:00.000Z",
              suggestedStoppedAt: "2026-07-27T11:00:00.000Z",
              segmentId: "segment-1",
              segmentKind: "stay",
              segmentStatus: "review",
              deviceId: "device-1",
              algorithmVersion: "location-v2.0",
              learnedPlaceId: null,
              placeMatchKind: null,
              centreLatitude: null,
              centreLongitude: null
            }]
          };
        }
        if (statement.includes("insert into time_entries")) {
          return { rows: [{ id: "overlapping-location-entry" }] };
        }
        return { rows: [] };
      })
    } as unknown as import("pg").PoolClient & { query: ReturnType<typeof vi.fn> };

    await expect(resolveLocationReviewActionWithClient(
      client,
      "review-1",
      { action: "confirm" },
      session
    )).resolves.toMatchObject({
      entryId: "overlapping-location-entry",
      status: "accepted"
    });

    const statements = client.query.mock.calls.map(([statement]) => String(statement));
    expect(statements.some((statement) => statement.includes("insert into time_entries"))).toBe(true);
    expect(statements.some((statement) => (
      statement.includes("started_at <") && statement.includes("coalesce(stopped_at")
    ))).toBe(false);
  });
});
