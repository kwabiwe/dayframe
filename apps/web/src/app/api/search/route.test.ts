import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveRequestSession: vi.fn(),
  searchDayframe: vi.fn()
}));

vi.mock("@/lib/ingest-auth", () => ({ resolveRequestSession: mocks.resolveRequestSession }));
vi.mock("@/lib/global-search", () => ({ searchDayframe: mocks.searchDayframe }));

import { GET } from "./route";

describe("/api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveRequestSession.mockResolvedValue({ workspaceId: "workspace-1", userId: "user-1" });
    mocks.searchDayframe.mockResolvedValue([]);
  });

  it("does not query history until two useful characters are present", async () => {
    const response = await GET(new Request("https://dayframe.test/api/search?q=a"));
    expect(response.status).toBe(200);
    expect(mocks.searchDayframe).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ results: [] });
  });

  it("searches within the resolved user and workspace session", async () => {
    const session = { workspaceId: "workspace-1", userId: "user-1" };
    mocks.resolveRequestSession.mockResolvedValue(session);
    mocks.searchDayframe.mockResolvedValue([{ id: "entry:1", kind: "entry" }]);
    const response = await GET(new Request("https://dayframe.test/api/search?q=Lakeside"));
    expect(mocks.searchDayframe).toHaveBeenCalledWith("Lakeside", session);
    await expect(response.json()).resolves.toEqual({
      results: [{ id: "entry:1", kind: "entry" }]
    });
  });
});
