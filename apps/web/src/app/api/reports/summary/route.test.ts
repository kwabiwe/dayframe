import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@/lib/session";
const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getMobileReportSummary: vi.fn(),
}));
vi.mock("@/lib/ingest-auth", () => ({
  resolveRequestSession: mocks.resolveRequestSession,
}));
vi.mock("@/lib/mobile-report-summary", () => ({
  getMobileReportSummary: mocks.getMobileReportSummary,
}));
const { POST } = await import("./route");
const start = "2026-09-09T00:00:00.000Z";
const end = "2026-09-10T00:00:00.000Z";
const body = { start, end, buckets: [{ key: "day", start, end }] };
const request = (value: unknown) =>
  new Request("https://dayframe.test/api/reports/summary", {
    method: "POST",
    body: JSON.stringify(value),
  });
describe("POST report summary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue({
      userId: "u",
      workspaceId: "w",
    });
    mocks.getMobileReportSummary.mockResolvedValue({ totalSeconds: 0 });
  });
  it("authenticates before parsing invalid input or querying", async () => {
    mocks.resolveRequestSession.mockRejectedValue(
      new AuthError("Sign in", 401),
    );
    const result = await POST(request(null));
    expect(result.status).toBe(401);
    expect(mocks.getMobileReportSummary).not.toHaveBeenCalled();
  });
  it("passes only authenticated scope and validated buckets, never caches publicly", async () => {
    const result = await POST(request(body));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getMobileReportSummary).toHaveBeenCalledWith(
      { userId: "u", workspaceId: "w" },
      body,
    );
  });
  it.each([
    null,
    { ...body, buckets: [] },
    { ...body, workspaceId: "foreign" },
  ])("rejects invalid body %#", async (value) => {
    expect((await POST(request(value))).status).toBe(400);
    expect(mocks.getMobileReportSummary).not.toHaveBeenCalled();
  });
  it("bounds raw bytes", async () => {
    expect((await POST(request("x".repeat(100001)))).status).toBe(413);
  });
  it("sanitizes database failure", async () => {
    mocks.getMobileReportSummary.mockRejectedValue(new Error("secret"));
    const result = await POST(request(body));
    expect(result.status).toBe(500);
    expect(JSON.stringify(await result.json())).not.toContain("secret");
  });
});
