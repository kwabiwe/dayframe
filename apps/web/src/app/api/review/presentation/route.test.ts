import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getReviewPresentation: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/review-presentation-service", () => ({
  getReviewPresentation: mocks.getReviewPresentation,
  ReviewPresentationError: class ReviewPresentationError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = code === "snapshot_changed" ? 409 : 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
}));
vi.mock("@/lib/api-errors", () => ({ authErrorResponse: vi.fn(() => null), databaseReadinessResponse: vi.fn(() => null) }));

const { POST } = await import("./route");

const session = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "provider" as const,
  scopes: ["app:read"]
};

describe("POST /api/review/presentation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.getReviewPresentation.mockResolvedValue({ ok: true, records: [] });
  });

  it("requires the app-read session and returns a private, no-store response", async () => {
    const response = await POST(request({
      version: 1,
      mode: "lookup",
      timeZone: "Europe/London",
      reviewItemIds: ["30000000-0000-4000-8000-000000000001"]
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.resolveRequestSession).toHaveBeenCalledWith(expect.any(Request), { requiredScopes: ["app:read"] });
    expect(mocks.getReviewPresentation).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ mode: "lookup", limit: 100 }),
      expect.objectContaining({ signal: expect.any(AbortSignal), deadlineAt: expect.any(Number) })
    );
  });

  it("rejects a chunked body larger than the fixed 64 KiB bound", async () => {
    const response = await POST(new Request("https://dayframe.test/api/review/presentation", {
      method: "POST",
      body: "x".repeat(65 * 1024)
    }));
    expect(response.status).toBe(413);
    expect(mocks.resolveRequestSession).toHaveBeenCalledWith(expect.any(Request), { requiredScopes: ["app:read"] });
  });
});

function request(body: unknown) {
  return new Request("https://dayframe.test/api/review/presentation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
