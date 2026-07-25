import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeIntegrationTimeCursor,
  encodeIntegrationTimeCursor,
  getIntegrationTimeCurrentSnapshot,
  getIntegrationTimeEntries
} from "./integration-time";

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
      1,
      expect.stringContaining("p.id as \"projectId\""),
      [session.workspaceId, session.userId, "2026-07-12T11:00:00.000Z"]
    );
    const activeTimerQuery = String(mocks.query.mock.calls[0]?.[0]);
    expect(activeTimerQuery).toContain("p.workspace_id = te.workspace_id");
    expect(activeTimerQuery).toContain("cl.workspace_id = te.workspace_id");
    expect(activeTimerQuery).toContain("cat.workspace_id = te.workspace_id");
    expect(activeTimerQuery).toContain("pl.workspace_id = te.workspace_id");
    expect(activeTimerQuery).toContain("t.workspace_id = te.workspace_id");
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("least(coalesce(te.stopped_at, $3::timestamptz), bounds.day_end)"),
      [
        session.workspaceId,
        session.userId,
        "2026-07-12T11:00:00.000Z",
        "Europe/London"
      ]
    );
  });

  it("returns isolated cursor-paginated logged entries with complete metadata", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "10000000-0000-4000-8000-000000000002",
          projectId: null,
          projectName: null,
          projectColor: null,
          clientName: null,
          categoryId: "20000000-0000-4000-8000-000000000001",
          categoryName: "Family",
          categoryColor: "#ff453a",
          placeId: null,
          placeName: null,
          source: "manual_app",
          confidence: "high",
          reviewStatus: "confirmed",
          description: "School pickup",
          startedAt: "2026-07-12T10:00:00.000Z",
          stoppedAt: "2026-07-12T10:30:00.000Z",
          updatedAt: "2026-07-12T10:30:00.000Z",
          tagNames: ["family"],
          elapsedSeconds: 1800
        },
        {
          id: "10000000-0000-4000-8000-000000000001",
          projectId: null,
          projectName: null,
          projectColor: null,
          clientName: null,
          categoryId: null,
          categoryName: null,
          categoryColor: null,
          placeId: null,
          placeName: null,
          source: "manual_app",
          confidence: "high",
          reviewStatus: "confirmed",
          description: "Older entry",
          startedAt: "2026-07-12T09:00:00.000Z",
          stoppedAt: "2026-07-12T09:15:00.000Z",
          updatedAt: "2026-07-12T09:15:00.000Z",
          tagNames: [],
          elapsedSeconds: 900
        }
      ]
    });
    const page = await getIntegrationTimeEntries(session, {
      from: "2026-07-12T00:00:00.000Z",
      to: "2026-07-13T00:00:00.000Z",
      limit: 1
    });

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({
      description: "School pickup",
      stoppedAt: "2026-07-12T10:30:00.000Z",
      elapsedSeconds: 1800,
      tags: ["family"]
    });
    expect(page.hasMore).toBe(true);
    expect(decodeIntegrationTimeCursor(page.nextCursor)).toEqual({
      startedAt: "2026-07-12T10:00:00.000Z",
      id: "10000000-0000-4000-8000-000000000002"
    });
    const sql = String(mocks.query.mock.calls[0]?.[0]);
    expect(sql).toContain("te.workspace_id = $1");
    expect(sql).toContain("te.user_id = $2");
    expect(sql).toContain("coalesce(te.stopped_at, $5::timestamptz) > $3::timestamptz");
    expect(sql).toContain("order by te.started_at desc, te.id desc");
    expect(mocks.query).toHaveBeenCalledWith(expect.any(String), [
      session.workspaceId,
      session.userId,
      "2026-07-12T00:00:00.000Z",
      "2026-07-13T00:00:00.000Z",
      "2026-07-12T11:00:00.000Z",
      null,
      null,
      2
    ]);
  });

  it("round-trips only valid opaque cursors", () => {
    const encoded = encodeIntegrationTimeCursor(
      "2026-07-12T10:00:00.000Z",
      "10000000-0000-4000-8000-000000000002"
    );
    expect(decodeIntegrationTimeCursor(encoded)).toEqual({
      startedAt: "2026-07-12T10:00:00.000Z",
      id: "10000000-0000-4000-8000-000000000002"
    });
    expect(decodeIntegrationTimeCursor("not-a-cursor")).toBeNull();
  });
});
