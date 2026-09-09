import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportSummary } from "@dayframe/shared";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  current: vi.fn(),
  request: vi.fn(),
}));
vi.mock("./config", () => ({
  DAYFRAME_API_BASE: "https://dayframe-staging.vercel.app",
}));
vi.mock("./secure-session", () => ({
  readOwnedAuthenticatedSessionSnapshot: mocks.read,
  isAuthenticatedSessionSnapshotCurrent: mocks.current,
}));
vi.mock("./mobile-network", () => ({
  mobileJsonRequest: mocks.request,
  StaleMobileSessionResponseError: class extends Error {},
}));
import { fetchReportSummary, ReportRangeCache } from "./reportsClient";
const start = "2026-09-09T00:00:00.000Z";
const end = "2026-09-10T00:00:00.000Z";
const input = { start, end, buckets: [{ key: "day", start, end }] };
const result: ReportSummary = {
  capturedNow: start,
  range: { start, end },
  totalSeconds: 0,
  categories: [],
  buckets: [{ key: "day", seconds: 0, byCategory: [] }],
  active: null,
};
describe("Reports request boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.read.mockResolvedValue({
      status: "authenticated",
      snapshot: { token: "test-token" },
    });
    mocks.current.mockReturnValue(true);
    mocks.request.mockImplementation(async (_url, _init, options) => ({
      body: options.validate(result, { ok: true }),
    }));
  });
  it("captures an owned session, abort signal and finite deadline without a sync mutation", async () => {
    const signal = new AbortController().signal;
    expect(
      await fetchReportSummary(
        input,
        { workspaceId: "w", userId: "u" },
        signal,
      ),
    ).toEqual(result);
    expect(mocks.read).toHaveBeenCalledWith({ workspaceId: "w", userId: "u" });
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      signal,
      method: "POST",
    });
    const options = mocks.request.mock.calls[0][2];
    expect(options.timeoutMilliseconds).toBe(15000);
    expect(options.isCurrent()).toBe(true);
    mocks.current.mockReturnValue(false);
    expect(options.isCurrent()).toBe(false);
  });
  it.each(["signed_out", "changed", "owner_mismatch"])(
    "does not fetch for %s",
    async (status) => {
      mocks.read.mockResolvedValue({ status });
      await expect(
        fetchReportSummary(
          input,
          { workspaceId: "w", userId: "u" },
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it("rejects mismatched range/bucket and unsuccessful responses", async () => {
    await fetchReportSummary(
      input,
      { workspaceId: "w", userId: "u" },
      new AbortController().signal,
    );
    const validate = mocks.request.mock.calls[0][2].validate;
    expect(() =>
      validate({ ...result, range: { start: end, end } }, { ok: true }),
    ).toThrow();
    expect(() => validate({ ...result, buckets: [] }, { ok: true })).toThrow();
    expect(() => validate(result, { ok: false })).toThrow();
  });
  it("bounds each mounted cache to eight exact keys and clears on teardown", () => {
    const cache = new ReportRangeCache();
    for (let i = 0; i < 10; i++) cache.put(String(i), result);
    expect(cache.get("0")).toBeUndefined();
    expect(cache.get("9")).toEqual(result);
    expect(new ReportRangeCache().get("9")).toBeUndefined();
    cache.clear();
    expect(cache.get("9")).toBeUndefined();
  });
});
