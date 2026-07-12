import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNormalizationContext } from "./queries";
import type { RequestSession } from "./session";

const mocks = vi.hoisted(() => ({
  query: vi.fn()
}));

vi.mock("./db", () => ({
  query: mocks.query,
  isUndefinedColumnError: vi.fn(() => false),
  missingRequiredColumnError: vi.fn((tableName: string, columnName: string) => {
    throw new Error(`${tableName}.${columnName} missing`);
  })
}));

const session: RequestSession = {
  userId: "user-1",
  workspaceId: "workspace-1",
  authMode: "dev",
  scopes: ["app:read"]
};

describe("query normalization context", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("reads automation rule references from workspace-joined rows", async () => {
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from projects p")) return { rows: [] };
      if (statement.includes("from categories")) return { rows: [] };
      if (statement.includes("from places pl")) return { rows: [] };
      if (statement.includes("from automation_rules ar")) {
        expect(statement).toContain('pl.id as "placeId"');
        expect(statement).toContain('p.id as "projectId"');
        expect(statement).toContain('c.id as "categoryId"');
        expect(statement).toContain("p.workspace_id = ar.workspace_id");
        expect(statement).toContain("c.workspace_id = ar.workspace_id");
        return {
          rows: [
            {
              id: "rule-1",
              name: "Station pickup",
              triggerSource: "geofence_specific",
              triggerType: "geofence_exit",
              placeId: null,
              action: "create_review_item",
              projectId: null,
              categoryId: "category-1",
              activityDescription: "Train station pickup/drop-off",
              enabled: true
            }
          ]
        };
      }
      throw new Error(`Unexpected query: ${statement}`);
    });

    const context = await getNormalizationContext(session);

    expect(context.automationRules).toEqual([
      {
        id: "rule-1",
        name: "Station pickup",
        triggerSource: "geofence_specific",
        triggerType: "geofence_exit",
        placeId: null,
        action: "create_review_item",
        projectId: null,
        categoryId: "category-1",
        activityDescription: "Train station pickup/drop-off",
        enabled: true
      }
    ]);
  });
});
