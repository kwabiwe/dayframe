import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getLocationTimeline: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/location/location-timeline-service", () => ({ getLocationTimeline: mocks.getLocationTimeline }));

const { GET } = await import("./route");

describe("/api/timeline", () => {
  beforeEach(() => {
    mocks.resolveRequestSession.mockReset().mockResolvedValue(session);
    mocks.getLocationTimeline.mockReset().mockResolvedValue({ date: "2026-02-28", items: [] });
  });

  it("reads a real calendar date in the requested zone", async () => {
    const response = await GET(new Request("https://dayframe.test/api/timeline?date=2026-02-28&tz=Europe/London"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.getLocationTimeline).toHaveBeenCalledWith(session, expect.objectContaining({ date: "2026-02-28", timeZone: "Europe/London" }));
  });

  it("refuses a date that doesn't exist or isn't YYYY-MM-DD (Codex r1 on #564)", async () => {
    for (const date of ["2026-02-30", "2026-13-45", "2026-2-1", ""]) {
      const response = await GET(new Request(`https://dayframe.test/api/timeline?date=${date}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.getLocationTimeline).not.toHaveBeenCalled();
  });
});
