import { beforeEach, describe, expect, it, vi } from "vitest";

const session = {
  userId: "10000000-0000-4000-8000-000000000002",
  workspaceId: "10000000-0000-4000-8000-000000000001",
  authMode: "provider" as const,
  scopes: ["exports:read"]
};
const categoryId = "20000000-0000-4000-8000-000000000001";
const tagId = "30000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  getReportExportRows: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/report-service", () => ({ getReportExportRows: mocks.getReportExportRows }));

const { GET } = await import("./route");

describe("GET /api/reports/export", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.getReportExportRows.mockImplementation(async (_session, input) => ({
      filters: input.filters,
      range: input.range,
      capturedNow: "2026-07-22T12:00:00.000Z",
      rows: [{
        startedAt: "2026-07-20T09:00:00.000Z",
        stoppedAt: "2026-07-20T10:00:00.000Z",
        durationSeconds: 3_600,
        description: 'School, notes "final"\nCafé 日本語',
        tagNames: ["Family", "School"],
        categoryName: "Family",
        placeName: null,
        source: "mobile_app"
      }]
    }));
  });

  it("authenticates, preserves active filters and returns a safely named CSV attachment", async () => {
    const response = await GET(new Request(
      `https://dayframe.test/api/reports/export?range=custom&from=2026-07-20&to=2026-07-22&categories=${categoryId}&tags=${tagId}&description=school`
    ));
    const body = await response.text();

    expect(mocks.resolveRequestSession).toHaveBeenCalledWith(expect.any(Request), { requiredScopes: ["exports:read"] });
    expect(mocks.getReportExportRows).toHaveBeenCalledWith(session, expect.objectContaining({
      filters: expect.objectContaining({
        categories: [categoryId],
        tags: [tagId],
        description: "school"
      })
    }));
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="dayframe-report-2026-07-20-to-2026-07-22.csv"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toContain('"School, notes ""final""\nCafé 日本語"');
    expect(body).not.toMatch(/workspaceId|userId|confidence|rawPayload|reviewStatus/);
  });
});
