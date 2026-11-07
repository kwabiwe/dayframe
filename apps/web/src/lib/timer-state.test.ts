import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  query: mocks.query
}));

const { getTimerState } = await import("./timer-state");

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

describe("getTimerState", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("uses one bounded workspace/user-scoped query", async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        activeEntryId: "entry-1",
        updatedAt: new Date("2026-07-30T15:00:00.000Z"),
        completedEntryRevision: "19"
      }]
    });

    const result = await getTimerState(session);

    expect(result).toEqual(expect.objectContaining({
      activeEntryId: "entry-1",
      updatedAt: "2026-07-30T15:00:00.000Z",
      completedEntryRevision: "19"
    }));
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls[0][0]).toContain("workspace_id = $1");
    expect(mocks.query.mock.calls[0][0]).toContain("user_id = $2");
    expect(mocks.query.mock.calls[0][0]).toContain("limit 1");
    expect(mocks.query.mock.calls[0][1]).toEqual([
      session.workspaceId,
      session.userId
    ]);
  });

  it("returns the completed-entry revision even when no timer is active", async () => {
    mocks.query.mockResolvedValue({ rows: [{ activeEntryId: null, updatedAt: null, completedEntryRevision: "27" }] });
    await expect(getTimerState(session)).resolves.toEqual(expect.objectContaining({
      activeEntryId: null,
      updatedAt: null,
      completedEntryRevision: "27"
    }));
  });
});
