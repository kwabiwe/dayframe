import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
const getGettingAround = vi.hoisted(() => vi.fn());
const getNotLoggedSeconds = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ query }));
vi.mock("./report-service", () => ({ getGettingAround, getNotLoggedSeconds }));

const { getMobileReportSummary } = await import("./mobile-report-summary");
const session = { workspaceId: "w", userId: "u" } as never;
const input = { start: "2026-10-19T00:00:00.000Z", end: "2026-10-26T00:00:00.000Z",
  buckets: [{ key: "week", start: "2026-10-19T00:00:00.000Z", end: "2026-10-26T00:00:00.000Z" }] };

describe("the iPhone report summary's location lines (location v4 step 18)", () => {
  beforeEach(() => {
    query.mockReset();
    getGettingAround.mockReset();
    getNotLoggedSeconds.mockReset();
  });

  it("adds Getting around from the range's logged blocks and the not-logged time, times only", async () => {
    query.mockResolvedValue({ rows: [{
      summary: { totalSeconds: 3_600, categories: [], buckets: [], active: null },
      entryRefs: [{ id: "e1", categoryId: "c-travel" }, { id: "e2", categoryId: "c-work" }],
    }] });
    getNotLoggedSeconds.mockResolvedValue(3_720);
    getGettingAround.mockResolvedValue({ tripCount: 1, totalSeconds: 1_800, stopsSeconds: 0, byMode: [{ mode: "train", seconds: 1_800 }] });
    const summary = await getMobileReportSummary(session, input);
    expect(summary).toMatchObject({ totalSeconds: 3_600, notLoggedSeconds: 3_720, gettingAround: { tripCount: 1, totalSeconds: 1_800 } });
    expect(getGettingAround).toHaveBeenCalledWith(session, [{ id: "e1", categoryId: "c-travel" }, { id: "e2", categoryId: "c-work" }],
      { start: input.start, end: input.end }, expect.any(String));
    // All contributing block IDs come from the same scoped aggregate.
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1].slice(0, 2)).toEqual(["w", "u"]);
  });
});
