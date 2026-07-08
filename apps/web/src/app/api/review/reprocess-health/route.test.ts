import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  reprocessHealthReviewItems: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/event-service", () => ({
  reprocessHealthReviewItems: mocks.reprocessHealthReviewItems
}));

const { POST } = await import("./route");

describe("POST /api/review/reprocess-health", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.reprocessHealthReviewItems.mockResolvedValue({
      checkedCount: 1,
      confirmedCount: 1,
      ignoredCount: 0,
      leftInReviewCount: 0,
      skippedCount: 0,
      failedCount: 0,
      updatedCategoryCount: 1,
      remainingReviewCount: 0,
      errorSummary: []
    });
  });

  it("returns a structured success result", async () => {
    const response = await POST(jsonRequest({ preferences: { walking: true } }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      confirmedCount: 1,
      failedCount: 0
    });
    expect(mocks.reprocessHealthReviewItems).toHaveBeenCalledWith(
      { preferences: { walking: true } },
      session
    );
  });

  it("returns a non-500 structured result when candidate processing had failures", async () => {
    mocks.reprocessHealthReviewItems.mockResolvedValueOnce({
      checkedCount: 2,
      confirmedCount: 1,
      ignoredCount: 0,
      leftInReviewCount: 1,
      skippedCount: 1,
      failedCount: 1,
      updatedCategoryCount: 1,
      remainingReviewCount: 1,
      errorSummary: ["Skipped review-bad: bad candidate"]
    });

    const response = await POST(jsonRequest({ preferences: { walking: true } }));
    const payload = await response.json();

    expect(response.status).toBe(207);
    expect(payload).toMatchObject({
      ok: true,
      confirmedCount: 1,
      failedCount: 1,
      errorSummary: ["Skipped review-bad: bad candidate"]
    });
  });

  it("returns structured JSON when review rows are temporarily locked", async () => {
    mocks.reprocessHealthReviewItems.mockRejectedValueOnce(
      Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })
    );

    const response = await POST(jsonRequest({ preferences: { walking: true } }));
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      ok: false,
      code: "review_reprocess_busy"
    });
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://dayframe.test/api/review/reprocess-health", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
