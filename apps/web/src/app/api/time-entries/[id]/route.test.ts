import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  updateTimeEntry: mocks.updateTimeEntry,
  deleteTimeEntry: mocks.deleteTimeEntry
}));

const { PATCH } = await import("./route");

describe("PATCH /api/time-entries/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.updateTimeEntry.mockResolvedValue(undefined);
  });

  it("updates a running timer start time without stopping it", async () => {
    const startedAt = new Date(Date.now() - 30 * 60_000).toISOString();
    const response = await PATCH(
      jsonRequest({
        categoryId: categoryId(),
        placeId: null,
        description: "Draft PR notes",
        startedAt,
        stoppedAt: null
      }),
      routeContext()
    );

    expect(response.status).toBe(200);
    expect(mocks.updateTimeEntry).toHaveBeenCalledWith(
      "entry-1",
      {
        categoryId: categoryId(),
        placeId: null,
        description: "Draft PR notes",
        startedAt,
        stoppedAt: null
      },
      session
    );
  });

  it("rejects a running timer start time in the future", async () => {
    const response = await PATCH(
      jsonRequest({
        startedAt: new Date(Date.now() + 60_000).toISOString(),
        stoppedAt: null
      }),
      routeContext()
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Start time cannot be in the future." });
    expect(mocks.updateTimeEntry).not.toHaveBeenCalled();
  });

  it("rejects a start time after a completed entry finish time", async () => {
    const response = await PATCH(
      jsonRequest({
        startedAt: "2026-07-01T18:00:00.000Z",
        stoppedAt: "2026-07-01T17:00:00.000Z"
      }),
      routeContext()
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Start time must be before the finish time." });
    expect(mocks.updateTimeEntry).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/time-entries/entry-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: "entry-1" }) };
}

function categoryId() {
  return "20000000-0000-4000-8000-000000000001";
}
