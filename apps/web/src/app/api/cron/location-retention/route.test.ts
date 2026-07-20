import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ deleteExpiredLocationEvidence: vi.fn() }));

vi.mock("@/lib/location/location-retention-service", () => ({
  deleteExpiredLocationEvidence: mocks.deleteExpiredLocationEvidence
}));

const { GET } = await import("./route");

describe("GET /api/cron/location-retention", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    mocks.deleteExpiredLocationEvidence.mockResolvedValue({
      acquiredLock: true,
      deletedEvidenceCount: 8,
      batches: 1,
      backlogPossible: false
    });
  });

  it("fails closed when the secret is missing or wrong", async () => {
    expect((await GET(new Request("https://dayframe.test/api/cron/location-retention"))).status).toBe(401);
    expect(mocks.deleteExpiredLocationEvidence).not.toHaveBeenCalled();
  });

  it("runs bounded retention with Vercel's bearer secret", async () => {
    const response = await GET(new Request("https://dayframe.test/api/cron/location-retention", {
      headers: { authorization: "Bearer test-cron-secret" }
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({ ok: true, deletedEvidenceCount: 8 });
  });
});
