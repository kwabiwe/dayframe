import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCategoryUsageRanks, getNormalizationContext, getReports, getTaskSuggestions } from "./queries";
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

describe("task suggestions query", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("builds task suggestions from full manual and explicitly accepted history", async () => {
    mocks.query.mockImplementation(async (statement: string, values: unknown[]) => {
      expect(statement).toContain("te.user_id = $2");
      expect(statement).toContain("te.source in ('manual_app', 'mobile_app')");
      expect(statement).toContain("accepted_review.status = 'accepted'");
      expect(statement).toContain("not in ('health_sleep_import', 'health_workout_import')");
      expect(statement).not.toContain("interval '120 days'");
      expect(statement).toContain("limit 5000");
      expect(values).toEqual([session.workspaceId, session.userId]);
      return {
        rows: [
          {
            id: "manual-1",
            categoryId: "category-1",
            categoryName: "Focus",
            categoryColor: "blue",
            description: "Architecture review",
            durationSeconds: 1800,
            eventType: "timer_start",
            reviewStatus: "confirmed",
            source: "manual_app",
            startedAt: "2026-07-14T09:00:00.000Z",
            stoppedAt: "2026-07-14T09:30:00.000Z"
          },
          {
            id: "sleep-1",
            categoryId: "health",
            categoryName: "Health",
            categoryColor: "red",
            description: "Sleep",
            durationSeconds: 8 * 3600,
            eventType: "health_sleep_import",
            reviewStatus: "confirmed",
            source: "health_sleep",
            startedAt: "2026-07-14T00:00:00.000Z",
            stoppedAt: "2026-07-14T08:00:00.000Z",
            userConfirmed: false
          },
          {
            id: "school-1",
            categoryId: "family",
            categoryName: "Family",
            categoryColor: "coral",
            description: "School pickup",
            durationSeconds: 1200,
            eventType: "geofence_exit",
            reviewStatus: "confirmed",
            source: "geofence_specific",
            startedAt: "2026-07-14T15:00:00.000Z",
            stoppedAt: "2026-07-14T15:20:00.000Z",
            userConfirmed: true
          }
        ]
      };
    });

    await expect(getTaskSuggestions(session)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ categoryId: "category-1", description: "Architecture review" }),
      expect.objectContaining({ categoryId: "family", description: "School pickup" })
    ]));
  });

  it("builds category usage ranks from manual category history", async () => {
    mocks.query.mockImplementation(async (statement: string, values: unknown[]) => {
      expect(statement).toContain("te.category_id is not null");
      expect(statement).toContain("te.source in ('manual_app', 'mobile_app')");
      expect(values).toEqual([session.workspaceId, session.userId]);
      return {
        rows: [
          {
            id: "manual-1",
            categoryId: "coding",
            description: null,
            durationSeconds: 1800,
            eventType: "timer_start",
            reviewStatus: "confirmed",
            source: "manual_app",
            startedAt: "2026-07-14T09:00:00.000Z",
            stoppedAt: "2026-07-14T09:30:00.000Z"
          },
          {
            id: "manual-2",
            categoryId: "coding",
            description: "Implementation",
            durationSeconds: 1800,
            eventType: "timer_start",
            reviewStatus: "confirmed",
            source: "mobile_app",
            startedAt: "2026-07-13T09:00:00.000Z",
            stoppedAt: "2026-07-13T09:30:00.000Z"
          }
        ]
      };
    });

    await expect(getCategoryUsageRanks(session)).resolves.toEqual([
      expect.objectContaining({
        categoryId: "coding",
        useCount: 2
      })
    ]);
  });
});

describe("personal report isolation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps two users in one workspace isolated across every report aggregate", async () => {
    const range = {
      start: new Date("2026-07-20T00:00:00.000Z"),
      end: new Date("2026-07-21T00:00:00.000Z")
    };
    const userA = { ...session, userId: "user-a" };
    const userB = { ...session, userId: "user-b" };

    mocks.query.mockImplementation(async (statement: string, values: unknown[]) => {
      expect(statement).toMatch(/(?:te\.)?user_id = \$2/);
      expect(values[0]).toBe(session.workspaceId);
      expect(values[2]).toBe(range.start.toISOString());
      expect(values[3]).toBe(range.end.toISOString());

      const seconds = values[1] === userA.userId ? 600 : 1200;
      if (statement.includes("with days as")) return { rows: [{ index: 0, seconds }] };
      return { rows: [{ id: "personal", name: "Personal", color: "blue", seconds }] };
    });

    const [reportsA, reportsB] = await Promise.all([
      getReports(userA, range),
      getReports(userB, range)
    ]);

    expect(reportsA.byCategory[0].seconds).toBe(600);
    expect(reportsA.bySource[0].seconds).toBe(600);
    expect(reportsA.byPlace[0].seconds).toBe(600);
    expect(reportsA.weekSeries[0].seconds).toBe(600);
    expect(reportsB.byCategory[0].seconds).toBe(1200);
    expect(reportsB.bySource[0].seconds).toBe(1200);
    expect(reportsB.byPlace[0].seconds).toBe(1200);
    expect(reportsB.weekSeries[0].seconds).toBe(1200);

    const categoryQuery = mocks.query.mock.calls.find(([statement]) =>
      String(statement).includes("left join categories")
    );
    const placeQuery = mocks.query.mock.calls.find(([statement]) =>
      String(statement).includes("left join places")
    );
    expect(categoryQuery?.[0]).toContain("c.workspace_id = te.workspace_id");
    expect(placeQuery?.[0]).toContain("pl.workspace_id = te.workspace_id");
  });
});
