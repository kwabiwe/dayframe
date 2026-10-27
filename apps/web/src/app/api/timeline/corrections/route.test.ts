import { beforeEach, describe, expect, it, vi } from "vitest";
import { SyncOperationError } from "@/lib/sync-transaction";

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  correctLocationTimeline: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/location/location-timeline-corrections", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/location/location-timeline-corrections")>();
  return { ...original, correctLocationTimeline: mocks.correctLocationTimeline };
});

const { POST } = await import("./route");
const { TimelineCorrectionError } = await import("@/lib/location/location-timeline-corrections");

const post = () => POST(new Request("http://localhost/api/timeline/corrections", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ kind: "delete", subject: "trip", itemId: "trip-1", clientCorrectionId: "8b0d8c8e-5d0f-4c5e-9f0e-3b1c2d3e4f50" })
}));

describe("POST /api/timeline/corrections", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue({ userId: "user-1", workspaceId: "workspace-1" });
  });

  it("answers busy with 503 and a retry hint, so the iPhone's queue tries again (step 12)", async () => {
    mocks.correctLocationTimeline.mockRejectedValue(new SyncOperationError("operation_deadline", "effect", "timeline_correction"));
    const response = await post();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.json()).toMatchObject({ code: "timeline_busy", retryAfterMs: 5_000 });
  });

  it("keeps a refusal's own status, which the app does not retry", async () => {
    mocks.correctLocationTimeline.mockRejectedValue(new TimelineCorrectionError("This trip is already in a block. Edit the block instead.", 409));
    const response = await post();
    expect(response.status).toBe(409);
  });
});
