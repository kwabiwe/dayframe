import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  ingestLocationEvidence: vi.fn(),
  query: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/db", () => ({ query: mocks.query }));
vi.mock("@/lib/location/location-ingest-service", () => ({
  LOCATION_EVIDENCE_BODY_LIMIT_BYTES: 512 * 1024,
  LocationIngestError: class LocationIngestError extends Error {},
  ingestLocationEvidence: mocks.ingestLocationEvidence
}));

const { DELETE, POST } = await import("./route");

describe("POST /api/location/evidence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.ingestLocationEvidence.mockResolvedValue({
      ok: true,
      duplicateBatch: false,
      acknowledgedEvidenceIds: ["evidence-1"],
      segmentIds: [],
      warnings: []
    });
  });

  it("rejects an oversized request before parsing or authentication", async () => {
    const response = await POST(new Request("https://dayframe.test/api/location/evidence", {
      method: "POST",
      headers: { "content-length": String(512 * 1024 + 1) },
      body: "{}"
    }));

    expect(response.status).toBe(413);
    expect(mocks.resolveRequestSession).not.toHaveBeenCalled();
    expect(mocks.ingestLocationEvidence).not.toHaveBeenCalled();
  });

  it("returns 201 for a newly ingested private batch", async () => {
    const body = { clientBatchId: "batch-1", evidence: [{ clientEvidenceId: "evidence-1" }] };
    const response = await POST(new Request("https://dayframe.test/api/location/evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Authorization, Cookie");
    expect(mocks.ingestLocationEvidence).toHaveBeenCalledWith(body, session);
  });

  it("deletes only the authenticated owner's evidence with private response headers", async () => {
    mocks.query.mockResolvedValue({ rowCount: 3, rows: [] });
    const response = await DELETE(new Request("https://dayframe.test/api/location/evidence", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("workspace_id = $1 and user_id = $2"),
      [session.workspaceId, session.userId]
    );
  });
});
