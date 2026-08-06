import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ drainLiveActivityOutbox: vi.fn() }));

vi.mock("@/lib/live-activity-push", () => ({
  drainLiveActivityOutbox: mocks.drainLiveActivityOutbox
}));

const { GET } = await import("./route");

describe("GET /api/cron/live-activity-retry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CRON_SECRET = "test-cron-secret";
    mocks.drainLiveActivityOutbox.mockResolvedValue({
      claimed: 1,
      delivered: 1,
      retryScheduled: 0,
      permanentFailures: 0,
      invalidatedTokens: 0,
      missingConfiguration: []
    });
  });

  it("fails closed without Vercel's bearer secret", async () => {
    const response = await GET(new Request("https://dayframe.test/api/cron/live-activity-retry"));
    expect(response.status).toBe(401);
    expect(mocks.drainLiveActivityOutbox).not.toHaveBeenCalled();
  });

  it("runs one bounded global reconciliation batch", async () => {
    const response = await GET(new Request("https://dayframe.test/api/cron/live-activity-retry", {
      headers: { authorization: "Bearer test-cron-secret" }
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    await expect(response.json()).resolves.toMatchObject({ ok: true, claimed: 1, delivered: 1 });
    expect(mocks.drainLiveActivityOutbox).toHaveBeenCalledOnce();
  });
});
