import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  updateTimeEntryDescriptions: vi.fn(),
  TimeEntryNotFoundError: class TimeEntryNotFoundError extends Error {},
  TimeEntryValidationError: class TimeEntryValidationError extends Error {}
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  updateTimeEntryDescriptions: mocks.updateTimeEntryDescriptions,
  TimeEntryNotFoundError: mocks.TimeEntryNotFoundError,
  TimeEntryValidationError: mocks.TimeEntryValidationError
}));

const { PATCH } = await import("./route");

describe("PATCH /api/time-entries/batch-description", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.updateTimeEntryDescriptions.mockResolvedValue({ ids: ids(), updatedCount: 2 });
  });

  it("trims and updates one grouped description atomically", async () => {
    const response = await PATCH(request({ ids: ids(), description: "  Planning  " }));

    expect(response.status).toBe(200);
    expect(mocks.updateTimeEntryDescriptions).toHaveBeenCalledWith(ids(), "Planning", session);
    await expect(response.json()).resolves.toEqual({ ok: true, ids: ids(), updatedCount: 2 });
  });

  it("stores an empty grouped description as null", async () => {
    const response = await PATCH(request({ ids: ids(), description: "   " }));

    expect(response.status).toBe(200);
    expect(mocks.updateTimeEntryDescriptions).toHaveBeenCalledWith(ids(), null, session);
  });

  it("rejects malformed or single-entry batches", async () => {
    const response = await PATCH(request({ ids: [ids()[0]], description: "Planning" }));

    expect(response.status).toBe(400);
    expect(mocks.updateTimeEntryDescriptions).not.toHaveBeenCalled();
  });

  it("returns scoped not-found and completed-entry validation failures", async () => {
    mocks.updateTimeEntryDescriptions.mockRejectedValueOnce(new mocks.TimeEntryNotFoundError());
    const missing = await PATCH(request({ ids: ids(), description: "Planning" }));
    expect(missing.status).toBe(404);

    mocks.updateTimeEntryDescriptions.mockRejectedValueOnce(
      new mocks.TimeEntryValidationError("Grouped descriptions can only update completed entries.")
    );
    const running = await PATCH(request({ ids: ids(), description: "Planning" }));
    expect(running.status).toBe(400);
    await expect(running.json()).resolves.toEqual({
      error: "Grouped descriptions can only update completed entries."
    });
  });

  it("returns the session authentication error", async () => {
    mocks.resolveRequestSession.mockRejectedValueOnce(new AuthError("Login required."));
    const response = await PATCH(request({ ids: ids(), description: "Planning" }));

    expect(response.status).toBe(401);
    expect(mocks.updateTimeEntryDescriptions).not.toHaveBeenCalled();
  });
});

function request(body: unknown) {
  return new Request("https://dayframe.test/api/time-entries/batch-description", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function ids() {
  return [
    "80000000-0000-4000-8000-000000000001",
    "80000000-0000-4000-8000-000000000002"
  ];
}
