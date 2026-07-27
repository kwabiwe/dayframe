import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  resolveReviewItem: vi.fn(),
  resolveLocationReviewAction: vi.fn(),
  resolveIdempotentReviewMutation: vi.fn()
}));

vi.mock("@/lib/location/location-review-service", () => ({
  resolveLocationReviewAction: mocks.resolveLocationReviewAction
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/review-mutation-service", () => ({
  resolveIdempotentReviewMutation: mocks.resolveIdempotentReviewMutation
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
    mocks.resolveIdempotentReviewMutation.mockResolvedValue({
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

  it("dispatches rich location actions through the atomic resolver", async () => {
    const action = {
      action: "edit_and_confirm" as const,
      edit: {
        description: "Sports practice",
        startedAt: "2026-07-20T12:00:00.000Z",
        stoppedAt: "2026-07-20T13:00:00.000Z"
      }
    };
    mocks.resolveLocationReviewAction.mockResolvedValueOnce({
      ok: true,
      action: action.action,
      status: "accepted",
      entryId: "entry-location-1"
    });

    const response = await POST(jsonRequest(action), params("review-1"));

    expect(response.status).toBe(200);
    expect(mocks.resolveLocationReviewAction).toHaveBeenCalledWith("review-1", action, session);
    expect(mocks.resolveReviewItem).not.toHaveBeenCalled();
  });

  it("dispatches strict idempotent mobile mutations through one transaction owner", async () => {
    const envelope = {
      clientMutationId: "d87c35ce-2a63-4e44-a8fc-4370f2a5cda4",
      mutation: { action: "accept" as const }
    };
    const response = await POST(jsonRequest(envelope), params("review-1"));

    expect(response.status).toBe(200);
    expect(mocks.resolveIdempotentReviewMutation).toHaveBeenCalledWith(
      "review-1",
      envelope,
      session
    );
    expect(mocks.resolveReviewItem).not.toHaveBeenCalled();
    expect(mocks.resolveLocationReviewAction).not.toHaveBeenCalled();
  });

  it("rejects malformed idempotent envelopes instead of falling through to legacy resolution", async () => {
    const response = await POST(
      jsonRequest({
        clientMutationId: "not-a-uuid",
        mutation: { action: "accept", unexpected: true }
      }),
      params("review-1")
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "invalid_action",
      message: "Invalid Review mutation envelope."
    });
    expect(mocks.resolveIdempotentReviewMutation).not.toHaveBeenCalled();
    expect(mocks.resolveReviewItem).not.toHaveBeenCalled();
    expect(mocks.resolveLocationReviewAction).not.toHaveBeenCalled();
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
