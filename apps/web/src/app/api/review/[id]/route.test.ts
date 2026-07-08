import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  resolveReviewItem: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/event-service")>("@/lib/event-service");
  return {
    ReviewResolutionError: actual.ReviewResolutionError,
    resolveReviewItem: mocks.resolveReviewItem
  };
});

const { ReviewResolutionError } = await import("@/lib/event-service");
const { POST } = await import("./route");

describe("POST /api/review/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.resolveReviewItem.mockResolvedValue({
      ok: true,
      action: "accept",
      status: "accepted",
      entryId: "entry-1"
    });
  });

  it("returns the structured review resolution result", async () => {
    const response = await POST(jsonRequest({ action: "accept" }), params("review-1"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ ok: true, entryId: "entry-1" });
    expect(mocks.resolveReviewItem).toHaveBeenCalledWith("review-1", "accept", session);
  });

  it("returns JSON for expected review resolution failures", async () => {
    mocks.resolveReviewItem.mockRejectedValueOnce(
      new ReviewResolutionError(
        "database_constraint",
        "This review item could not be confirmed because its stored data violates a database constraint.",
        {
          status: 422,
          details: {
            constraint: "time_entries_review_status_check"
          }
        }
      )
    );

    const response = await POST(jsonRequest({ action: "accept" }), params("review-1"));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({
      ok: false,
      code: "database_constraint",
      constraint: "time_entries_review_status_check"
    });
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/review/review-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}
