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
  getIntegrationDrives: vi.fn(),
  getIntegrationRoutes: vi.fn(),
  getIntegrationVisits: vi.fn(),
  getIntegrationCurrentPlace: vi.fn(),
  getIntegrationTimeSummary: vi.fn(),
  getIntegrationReviewSummary: vi.fn(),
  getIntegrationTimeCurrentSnapshot: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/integration-location", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integration-location")>()),
  getIntegrationDrives: mocks.getIntegrationDrives,
  getIntegrationRoutes: mocks.getIntegrationRoutes,
  getIntegrationVisits: mocks.getIntegrationVisits,
  getIntegrationCurrentPlace: mocks.getIntegrationCurrentPlace
}));
vi.mock("@/lib/integration-summary", () => ({
  getIntegrationTimeSummary: mocks.getIntegrationTimeSummary,
  getIntegrationReviewSummary: mocks.getIntegrationReviewSummary
}));
vi.mock("@/lib/integration-time", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integration-time")>()),
  getIntegrationTimeCurrentSnapshot: mocks.getIntegrationTimeCurrentSnapshot
}));

const drives = await import("./location/drives/route");
const routes = await import("./location/routes/route");
const visits = await import("./location/visits/route");
const timeSummary = await import("./time/summary/route");
const reviewSummary = await import("./review/summary/route");
const context = await import("./context/route");

const get = (path: string) => new Request(`https://dayframe.test/api/integrations/v1/${path}`, {
  headers: { Authorization: "Bearer integration-token" }
});
const expectScopes = (scopes: string[]) => expect(mocks.resolveRequestSession).toHaveBeenCalledWith(expect.any(Request), {
  allowIngestToken: true, allowBearerIntegrationToken: true, requiredScopes: scopes
});

describe("integration v1 read routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue({ ...session, scopes: ["time:read", "location:read", "review:read"] });
    mocks.getIntegrationDrives.mockResolvedValue({ ok: true, samples: [] });
    mocks.getIntegrationRoutes.mockResolvedValue({ ok: true, routes: [] });
    mocks.getIntegrationVisits.mockResolvedValue({ ok: true, visits: [] });
    mocks.getIntegrationTimeSummary.mockResolvedValue({ ok: true });
    mocks.getIntegrationReviewSummary.mockResolvedValue({ ok: true, openCards: 2, byKind: { place: 1, trip: 1, health: 0, other: 0 },
      oldestOpenAt: "2026-10-20T08:00:00.000Z", newestOpenAt: "2026-10-22T08:00:00.000Z" });
    mocks.getIntegrationCurrentPlace.mockResolvedValue({ place: null, since: null, travelling: false, observedAt: null, stale: true });
    mocks.getIntegrationTimeCurrentSnapshot.mockResolvedValue({ ok: true, serverNow: "2026-10-25T12:00:00.000Z", activeEntry: null, todaySeconds: 60 });
  });

  it("serves driving evidence with location:read and the preheat defaults when called without a query", async () => {
    const response = await drives.GET(get("location/drives"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expectScopes(["location:read"]);
    expect(mocks.getIntegrationDrives).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: session.workspaceId }), { days: 180, limit: 1000 });
  });

  it("bounds driving evidence parameters", async () => {
    await drives.GET(get("location/drives?days=365&limit=5000"));
    expect(mocks.getIntegrationDrives).toHaveBeenLastCalledWith(expect.anything(), { days: 365, limit: 5000 });
    for (const query of ["days=0", "days=366", "limit=5001", "limit=-1", "limit=1.5", "days=abc"]) {
      const response = await drives.GET(get(`location/drives?${query}`));
      expect(response.status, query).toBe(400);
    }
    expect(mocks.getIntegrationDrives).toHaveBeenCalledTimes(1);
  });

  it("refuses a token without location:read and an invalid token, never reaching the data", async () => {
    mocks.resolveRequestSession.mockRejectedValueOnce(new AuthError("Session is missing the required scope.", 403, "insufficient_scope"));
    const forbidden = await drives.GET(get("location/drives"));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: "insufficient_scope" });
    mocks.resolveRequestSession.mockRejectedValueOnce(new AuthError("Invalid integration token.", 401, "integration_token_invalid"));
    expect((await visits.GET(get("location/visits?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z"))).status).toBe(401);
    expect(mocks.getIntegrationDrives).not.toHaveBeenCalled();
    expect(mocks.getIntegrationVisits).not.toHaveBeenCalled();
  });

  it("hides failure details", async () => {
    mocks.getIntegrationDrives.mockRejectedValueOnce(new Error("select secret from somewhere"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await drives.GET(get("location/drives"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to load driving evidence." });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
    error.mockRestore();
  });

  it("serves route estimates with at least three samples", async () => {
    await routes.GET(get("location/routes"));
    expectScopes(["location:read"]);
    expect(mocks.getIntegrationRoutes).toHaveBeenCalledWith(expect.anything(), { days: 180, minSamples: 3 });
    expect((await routes.GET(get("location/routes?minSamples=2"))).status).toBe(400);
  });

  it("requires a bounded range and a valid cursor for visits", async () => {
    expect((await visits.GET(get("location/visits"))).status).toBe(400);
    expect((await visits.GET(get("location/visits?from=2026-10-01T00:00:00Z&to=2026-11-02T00:00:00Z"))).status).toBe(400);
    expect((await visits.GET(get("location/visits?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z"))).status).toBe(400);
    expect((await visits.GET(get("location/visits?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z&cursor=nope"))).status).toBe(400);
    const ok = await visits.GET(get("location/visits?from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z&limit=10"));
    expect(ok.status).toBe(200);
    expect(mocks.getIntegrationVisits).toHaveBeenCalledWith(expect.anything(), {
      from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z", cursor: null, limit: 10 });
  });

  it("serves time summaries with time:read and validates period and date", async () => {
    await timeSummary.GET(get("time/summary?period=week&date=2026-10-21"));
    expectScopes(["time:read"]);
    expect(mocks.getIntegrationTimeSummary).toHaveBeenCalledWith(expect.anything(), { period: "week", date: "2026-10-21" });
    for (const query of ["period=month", "date=2026-02-30", "date=21-10-2026"]) {
      expect((await timeSummary.GET(get(`time/summary?${query}`))).status, query).toBe(400);
    }
  });

  it("serves the Review summary with review:read", async () => {
    expect((await reviewSummary.GET(get("review/summary"))).status).toBe(200);
    expectScopes(["review:read"]);
  });

  it("gives one context poll and leaves out what the token cannot read", async () => {
    const full = await (await context.GET(get("context"))).json();
    expectScopes(["time:read"]);
    expect(full).toMatchObject({ ok: true, todaySeconds: 60, location: { stale: true }, review: { openCards: 2 }, omitted: [] });
    expect(full.review).not.toHaveProperty("newestOpenAt");

    mocks.resolveRequestSession.mockResolvedValue(session);
    vi.clearAllMocks();
    const timeOnly = await (await context.GET(get("context"))).json();
    expect(timeOnly).toMatchObject({ location: null, review: null, omitted: ["location", "review"] });
    expect(mocks.getIntegrationCurrentPlace).not.toHaveBeenCalled();
    expect(mocks.getIntegrationReviewSummary).not.toHaveBeenCalled();
  });
});
