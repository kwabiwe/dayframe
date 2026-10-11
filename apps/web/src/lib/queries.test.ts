import { beforeEach, describe, expect, it, vi } from "vitest";
import { placeDisplayNameSql } from "./place-display";
import {
  buildTimeEntriesQuery,
  getBootstrapData,
  getCategoryUsageRanks,
  getNormalizationContext,
  getTaskSuggestions
} from "./queries";
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

  it("reads category icons and starter keys into the normalization context", async () => {
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from categories")) {
        expect(statement).toContain("icon");
        expect(statement).toContain('starter_key as "starterKey"');
        return { rows: [{ id: "category-1", name: "Bedtime", color: "blue-bold", isPinned: false, icon: "sleep", starterKey: "sleep" }] };
      }
      return { rows: [] };
    });

    const context = await getNormalizationContext(session);

    expect(context.categories).toEqual([
      { id: "category-1", name: "Bedtime", color: "blue-bold", isPinned: false, starterKey: "sleep" }
    ]);
  });

  it("reads Counts toward goal and names its migration when the column is missing (UIA-043)", async () => {
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from categories")) {
        expect(statement).toContain('counts_toward_goal as "countsTowardGoal"');
        return { rows: [{ id: "category-1", name: "Sleep", color: "blue-bold", isPinned: false, starterKey: "sleep", countsTowardGoal: false }] };
      }
      return { rows: [] };
    });
    const context = await getNormalizationContext(session);
    expect(context.categories[0]).toMatchObject({ id: "category-1", countsTowardGoal: false });

    const db = await import("./db");
    vi.mocked(db.isUndefinedColumnError).mockImplementation((_error, column) => column === "counts_toward_goal");
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes("from categories")) throw Object.assign(new Error('column "counts_toward_goal" does not exist'), { code: "42703" });
      return { rows: [] };
    });
    await expect(getNormalizationContext(session)).rejects.toThrow("categories.counts_toward_goal missing");
    expect(db.missingRequiredColumnError).toHaveBeenCalledWith(
      "categories",
      "counts_toward_goal",
      "supabase/migrations/202610110001_category_counts_toward_goal.sql",
      expect.any(Error)
    );
  });

  it("sends every activity that doesn't count, archived ones included, with bootstrap (UIA-043)", async () => {
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes("counts_toward_goal = false")) {
        // No is_archived filter: an archived Sleep must keep its history out of the goal.
        expect(statement).not.toContain("is_archived");
        return { rows: [{ id: "archived-sleep" }, { id: "nap" }] };
      }
      return { rows: [] };
    });
    const data = await getBootstrapData(session);
    expect(data.goalExcludedCategoryIds).toEqual(["archived-sleep", "nap"]);
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

describe("time-entry range query", () => {
  it("selects entries overlapping a bounded range through one captured current time", () => {
    const statement = buildTimeEntriesQuery(session, {
      overlappingFrom: "2026-07-20T00:00:00.000Z",
      startedBefore: "2026-07-27T00:00:00.000Z",
      capturedNow: "2026-07-23T12:00:00.000Z",
      limit: 300
    });

    expect(statement.text).toContain("te.started_at < $5::timestamptz");
    expect(statement.text).toContain("coalesce(te.stopped_at, $3::timestamptz) > $4::timestamptz");
    expect(statement.text).toContain("coalesce(te.stopped_at, $3::timestamptz) - te.started_at");
    expect(statement.text).toContain('te.updated_at as "updatedAt"');
    expect(statement.text).toContain(`coalesce(${placeDisplayNameSql("pl")}, te.place_label) as "placeName"`);
    expect(statement.text).toContain('end as "placeKind"');
    expect(statement.text).toContain("order by te.started_at desc, te.id desc");
    expect(statement.values).toEqual([
      session.workspaceId,
      session.userId,
      "2026-07-23T12:00:00.000Z",
      "2026-07-20T00:00:00.000Z",
      "2026-07-27T00:00:00.000Z",
      300
    ]);
  });
});
