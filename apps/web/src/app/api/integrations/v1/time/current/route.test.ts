import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "token" as const,
  scopes: ["time:read"]
};

const snapshot = {
  ok: true,
  serverNow: "2026-07-12T11:00:00.000Z",
  workspaceId: session.workspaceId,
  activeEntry: {
    id: "10000000-0000-4000-8000-000000000001",
    description: "Review network design",
    startedAt: "2026-07-12T10:30:00.000Z",
    stoppedAt: null,
    elapsedSeconds: 1800,
    source: "mobile_timer",
    confidence: "high",
    reviewStatus: "confirmed",
    project: null,
    category: {
      id: "20000000-0000-4000-8000-000000000001",
      name: "A24",
      color: "#ff453a"
    },
    place: null,
    tags: [],
    updatedAt: "2026-07-12T10:30:00.000Z"
  },
  todaySeconds: 5400,
  updatedAt: "2026-07-12T10:30:00.000Z"
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getIntegrationTimeCurrentSnapshot: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/integration-time", () => ({
  getIntegrationTimeCurrentSnapshot: mocks.getIntegrationTimeCurrentSnapshot
}));

const { GET } = await import("./route");

describe("/api/integrations/v1/time/current", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.getIntegrationTimeCurrentSnapshot.mockResolvedValue(snapshot);
  });

  it("returns the token-scoped current timer snapshot", async () => {
    const request = new Request("https://dayframe.test/api/integrations/v1/time/current", {
      headers: { Authorization: "Bearer integration-token" }
    });
    const response = await GET(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual(snapshot);
    expect(mocks.resolveRequestSession).toHaveBeenCalledWith(request, {
      allowIngestToken: true,
      requiredScopes: ["time:read"]
    });
    expect(mocks.getIntegrationTimeCurrentSnapshot).toHaveBeenCalledWith(session);
  });

  it("rejects tokens without read scope before loading timer data", async () => {
    mocks.resolveRequestSession.mockRejectedValue(new AuthError("Session is missing the required scope.", 401));

    const response = await GET(new Request("https://dayframe.test/api/integrations/v1/time/current"));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Session is missing the required scope.");
    expect(mocks.getIntegrationTimeCurrentSnapshot).not.toHaveBeenCalled();
  });
});
