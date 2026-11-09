import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000010",
  authMode: "provider" as const,
  scopes: ["app:read", "app:write", "events:write"]
};

const reviewCountMock = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  ingestLocationEvidence: vi.fn(),
  query: vi.fn(),
  withSyncTransaction: vi.fn(),
  after: vi.fn()
}));

vi.mock("next/server", async importOriginal => ({
  ...await importOriginal<typeof import("next/server")>(),
  after: mocks.after
}));
vi.mock("@/lib/sync-transaction", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/sync-transaction")>(),
  withSyncTransaction: mocks.withSyncTransaction
}));
vi.mock("@/lib/review-count", () => ({
  openReviewCountFor: reviewCountMock,
  withReviewCount: (body: object, reviewCount?: number) => reviewCount === undefined ? body : { ...body, reviewCount }
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
    mocks.withSyncTransaction.mockImplementation((_operation, work) => work({ client: { query: mocks.query } }));
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

  it("adds the open Review count for the phone's evening reminder", async () => {
    reviewCountMock.mockResolvedValueOnce(2);
    const response = await POST(new Request("https://dayframe.test/api/location/evidence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientBatchId: "batch-1", evidence: [{ clientEvidenceId: "evidence-1" }] })
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, reviewCount: 2 });
    expect(reviewCountMock).toHaveBeenCalledWith(session, { cards: false });
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
    expect(await response.json()).toEqual({ ok: true, deletedEvidenceCount: 3 });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("workspace_id = $1 and user_id = $2"),
      [session.workspaceId, session.userId]
    );
  });

  it("keeps the same confirmed deletion alive after a client disconnects", async () => {
    const controller = new AbortController();
    let finishDeletion!: (result: { rowCount: number; rows: [] }) => void;
    const deletion = new Promise<{ rowCount: number; rows: [] }>(resolve => { finishDeletion = resolve; });
    mocks.query.mockReturnValueOnce(deletion);

    const response = DELETE(new Request("https://dayframe.test/api/location/evidence", {
      method: "DELETE", signal: controller.signal
    }));
    await vi.waitFor(() => expect(mocks.query).toHaveBeenCalledTimes(1));
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.after.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[0]);
    expect(mocks.withSyncTransaction).toHaveBeenCalledWith("location_evidence_delete", expect.any(Function));

    controller.abort();
    const completion = mocks.after.mock.calls[0]![0]();
    let finished = false;
    void completion.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);

    finishDeletion({ rowCount: 1, rows: [] });
    expect(await (await response).json()).toEqual({ ok: true, deletedEvidenceCount: 1 });
    await completion;
    expect(finished).toBe(true);
    expect(mocks.query).toHaveBeenCalledTimes(1);
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
