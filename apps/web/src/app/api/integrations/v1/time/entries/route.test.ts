import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "token" as const,
  scopes: ["time:read"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getIntegrationTimeEntries: vi.fn(),
  decodeIntegrationTimeCursor: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession
}));

vi.mock("@/lib/integration-time", () => ({
  getIntegrationTimeEntries: mocks.getIntegrationTimeEntries,
  decodeIntegrationTimeCursor: mocks.decodeIntegrationTimeCursor,
  INTEGRATION_TIME_ENTRIES_DEFAULT_LIMIT: 50,
  INTEGRATION_TIME_ENTRIES_MAX_LIMIT: 100,
  INTEGRATION_TIME_ENTRIES_MAX_RANGE_DAYS: 90
}));

const { GET } = await import("./route");

describe("/api/integrations/v1/time/entries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.decodeIntegrationTimeCursor.mockReturnValue(null);
    mocks.getIntegrationTimeEntries.mockResolvedValue({
      ok: true,
      serverNow: "2026-07-24T22:00:00.000Z",
      workspaceId: session.workspaceId,
      range: {
        from: "2026-07-20T00:00:00.000Z",
        to: "2026-07-25T00:00:00.000Z"
      },
      entries: [],
      nextCursor: null,
      hasMore: false
    });
  });

  it("returns a bounded token-scoped page of logged entries", async () => {
    const request = new Request(
      "https://dayframe.test/api/integrations/v1/time/entries?from=2026-07-20T00%3A00%3A00Z&to=2026-07-25T00%3A00%3A00Z&limit=25",
      { headers: { Authorization: "Bearer integration-token" } }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mocks.resolveRequestSession).toHaveBeenCalledWith(request, {
      allowIngestToken: true,
      allowBearerIntegrationToken: true,
      requiredScopes: ["time:read"]
    });
    expect(mocks.getIntegrationTimeEntries).toHaveBeenCalledWith(session, {
      from: "2026-07-20T00:00:00.000Z",
      to: "2026-07-25T00:00:00.000Z",
      limit: 25,
      cursor: null
    });
  });

  it.each([
    ["missing range", "https://dayframe.test/api/integrations/v1/time/entries"],
    [
      "reversed range",
      "https://dayframe.test/api/integrations/v1/time/entries?from=2026-07-25T00%3A00%3A00Z&to=2026-07-20T00%3A00%3A00Z"
    ],
    [
      "overlong range",
      "https://dayframe.test/api/integrations/v1/time/entries?from=2026-01-01T00%3A00%3A00Z&to=2026-07-25T00%3A00%3A00Z"
    ],
    [
      "invalid limit",
      "https://dayframe.test/api/integrations/v1/time/entries?from=2026-07-20T00%3A00%3A00Z&to=2026-07-25T00%3A00%3A00Z&limit=101"
    ]
  ])("rejects %s", async (_label, url) => {
    const response = await GET(new Request(url));
    expect(response.status).toBe(400);
    expect(mocks.getIntegrationTimeEntries).not.toHaveBeenCalled();
  });

  it("rejects malformed cursors", async () => {
    const response = await GET(
      new Request(
        "https://dayframe.test/api/integrations/v1/time/entries?from=2026-07-20T00%3A00%3A00Z&to=2026-07-25T00%3A00%3A00Z&cursor=bad"
      )
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Use a valid pagination cursor." });
  });

  it("rejects tokens without time read scope", async () => {
    mocks.resolveRequestSession.mockRejectedValue(
      new AuthError("Session is missing the required scope.", 403, "insufficient_scope")
    );
    const response = await GET(
      new Request(
        "https://dayframe.test/api/integrations/v1/time/entries?from=2026-07-20T00%3A00%3A00Z&to=2026-07-25T00%3A00%3A00Z"
      )
    );
    expect(response.status).toBe(403);
    expect(mocks.getIntegrationTimeEntries).not.toHaveBeenCalled();
  });
});
