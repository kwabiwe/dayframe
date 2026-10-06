import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(async (...args: unknown[]) => ({ rows: [] as unknown[], args })) }));
vi.mock("./db", () => ({ query: mocks.query, pool: { connect: vi.fn() } }));

const { getReportFilterOptions } = await import("./report-service");

describe("report filter options", () => {
  it("returns each activity's icon and starter key with its name and colour", async () => {
    await getReportFilterOptions({ userId: "user-1", workspaceId: "workspace-1", authMode: "dev", scopes: [] });

    const categorySql = mocks.query.mock.calls.map(([sql]) => String(sql)).find((sql) => sql.includes("from categories"));
    expect(categorySql).toContain('icon, starter_key as "starterKey"');
  });
});
