import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIntegrationTimeCurrentSnapshot } from "./integration-time";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "token" as const,
  scopes: ["time:read"]
};

const mocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("./db", () => ({
  query: mocks.query
}));

describe("getIntegrationTimeCurrentSnapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T11:00:00.000Z"));
    mocks.query.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a compact active timer contract and uses serverNow for running totals", async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "10000000-0000-4000-8000-000000000001",
            projectId: null,
            projectName: null,
            projectColor: null,
            clientName: null,
            categoryId: "20000000-0000-4000-8000-000000000001",
            categoryName: "Family",
            categoryColor: "#ff453a",
            placeId: "30000000-0000-4000-8000-000000000001",
            placeName: "Home",
            source: "mobile_timer",
            confidence: "high",
            reviewStatus: "confirmed",
            description: "School pickup",
            startedAt: "2026-07-12T10:30:00.000Z",
            stoppedAt: null,
            updatedAt: "2026-07-12T10:30:00.000Z",
            tagNames: ["family"],
            elapsedSeconds: 1800
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [{ todaySeconds: 5400 }] });

    const snapshot = await getIntegrationTimeCurrentSnapshot(session);

    expect(snapshot).toEqual({
      ok: true,
      serverNow: "2026-07-12T11:00:00.000Z",
      workspaceId: session.workspaceId,
      activeEntry: {
        id: "10000000-0000-4000-8000-000000000001",
        description: "School pickup",
        startedAt: "2026-07-12T10:30:00.000Z",
        stoppedAt: null,
        elapsedSeconds: 1800,
        source: "mobile_timer",
        confidence: "high",
        reviewStatus: "confirmed",
        project: null,
        category: {
          id: "20000000-0000-4000-8000-000000000001",
          name: "Family",
          color: "#ff453a"
        },
        place: {
          id: "30000000-0000-4000-8000-000000000001",
          name: "Home"
        },
        tags: ["family"],
        updatedAt: "2026-07-12T10:30:00.000Z"
      },
      todaySeconds: 5400,
      updatedAt: "2026-07-12T10:30:00.000Z"
    });
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("coalesce(te.stopped_at, $5::timestamptz)"),
      expect.arrayContaining(["2026-07-12T11:00:00.000Z"])
    );
  });
});
