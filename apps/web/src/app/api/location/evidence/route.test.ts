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
vi.mock("@/lib/db", () => ({
  query: mocks.query,
  isLockNotAvailableError: (error: { code?: string }) => error?.code === "55P03",
  isStatementTimeoutError: (error: { code?: string }) => error?.code === "57014"
}));
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
    expect(mocks.ingestLocationEvidence).toHaveBeenCalledWith(body, session, undefined, expect.objectContaining({ signal: expect.any(AbortSignal), deadlineAt: expect.any(Number) }));
  });

  it("returns a retryable busy response when owner processing is locked", async () => {
    mocks.ingestLocationEvidence.mockRejectedValueOnce({ code: "55P03" });
    const response = await POST(new Request("https://dayframe.test/api/location/evidence", {
      method: "POST",
      body: JSON.stringify({ clientBatchId: "batch-1", evidence: [{ clientEvidenceId: "evidence-1" }] })
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "location_processing_busy" });
  });

  it("correlates a private failure without trusting inbound IDs or database text", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.ingestLocationEvidence.mockImplementationOnce(async (_body, _session, _at, options) => {
      options.onLocationStage?.("bulk_evidence_write");
      throw { code: "55P03", syncPhase: "owner_lock", message: "private coordinates", detail: "private SQL" };
    });
    const response = await POST(new Request("https://dayframe.test/api/location/evidence", {
      method: "POST", body: "{}", headers: { "X-Dayframe-Request-Id": "private-client-value" }
    }));
    const body = await response.json();
    expect(response.headers.get("X-Dayframe-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({ code: "location_processing_busy", phase: "owner_lock", sqlState: "55P03" });
    expect(body.locationStage).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-client-value|private coordinates|private SQL/);
    log.mockRestore();
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

describe("Location private early response correlation",()=>{
 it("adds private correlation headers to rejected authentication",async()=>{
  const {AuthError}=await import("@/lib/session");
  const log=vi.spyOn(console,"info").mockImplementation(()=>{});
  mocks.resolveRequestSession.mockRejectedValueOnce(new AuthError("Login required",401,"session_expired"));
  const response=await POST(new Request("https://dayframe.test/api/location/evidence",{method:"POST",body:"{}"}));
  expect(response.status).toBe(401);expect(response.headers.get("X-Dayframe-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.headers.get("Cache-Control")).toContain("private, no-store");
  expect(log).toHaveBeenCalledWith("location_sync",expect.any(String));
  expect(JSON.parse(log.mock.calls[0]![1] as string)).toMatchObject({outcome:"authentication_rejected"});log.mockRestore();
 });
});
