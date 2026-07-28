import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("./db", () => ({ query: mocks.query }));

import { searchDayframe } from "./global-search";

const session = {
  authMode: "provider" as const,
  userId: "user-1",
  workspaceId: "workspace-1",
  scopes: []
};

describe("historical global search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it("does not touch the database for an incomplete query", async () => {
    await expect(searchDayframe(" a ", session)).resolves.toEqual([]);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("scopes every candidate to the active workspace and user", async () => {
    await searchDayframe("  Lakeside   visit  ", session, 200);
    const [sql, values] = mocks.query.mock.calls[0];
    expect(sql).toContain("te.workspace_id = $1");
    expect(sql).toContain("te.user_id = $2");
    expect(sql).toContain("r.workspace_id = $1");
    expect(sql).toContain("r.user_id = $2");
    expect(sql).toContain("r.status = 'open'");
    expect(sql).toContain("order by rank desc");
    expect(values).toEqual(["workspace-1", "user-1", "Lakeside visit", 40]);
  });

  it("removes the internal ranking value from the API result", async () => {
    mocks.query.mockResolvedValue({
      rows: [{
        id: "category:1",
        kind: "category",
        label: "Commute",
        detail: "Category",
        occurredAt: null,
        entryId: null,
        categoryId: "category-1",
        categoryName: "Commute",
        categoryColor: "blue",
        placeId: null,
        description: null,
        tagNames: [],
        startedAt: null,
        stoppedAt: null,
        durationSeconds: null,
        rank: 110
      }]
    });
    await expect(searchDayframe("commute", session)).resolves.toEqual([
      expect.not.objectContaining({ rank: expect.anything() })
    ]);
  });
});
