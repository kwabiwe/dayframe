import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getLocationReviewEvidence: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/location/location-query-service", () => ({
  LocationEvidenceNotFoundError: class LocationEvidenceNotFoundError extends Error { status = 404; },
  getLocationReviewEvidence: mocks.getLocationReviewEvidence
}));

const { GET } = await import("./route");

describe("GET /api/review/[id]/location-evidence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.getLocationReviewEvidence.mockResolvedValue({ reviewItemId: "review-1" });
  });

  it("scopes the request and marks exact evidence private and non-cacheable", async () => {
    const response = await GET(
      new Request("https://dayframe.test/api/review/review-1/location-evidence"),
      { params: Promise.resolve({ id: "review-1" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
    expect(mocks.getLocationReviewEvidence).toHaveBeenCalledWith("review-1", session);
  });
});
