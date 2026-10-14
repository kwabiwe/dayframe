import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRecentActivitySuggestions } from "@dayframe/shared";
import { placeDisplayNameSql } from "./place-display";
import {
  buildTimeEntriesQuery,
  confirmedInReviewSql,
  ownerAuthoredInReviewSql,
  getBootstrapData,
  getCategoryUsageRanks,
  getNormalizationContext,
  getTaskSuggestions,
  getTaskSuggestionSets,
  getUser,
  TASK_SUGGESTION_CANDIDATE_LIMIT,
  TASK_SUGGESTION_CANDIDATE_WINDOW_DAYS
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

  it("ships a bounded, session-scoped candidate pool beside the unchanged contextual top 6", async () => {
    const now = new Date("2026-10-12T07:30:00.000Z");
    const day = 86_400_000;
    // pg returns timestamptz columns as Date objects.
    const row = (id: string, description: string, stoppedAtMs: number, overrides: Record<string, unknown> = {}) => ({
      id,
      categoryId: "work",
      categoryName: "Work",
      categoryColor: "blue",
      description,
      durationSeconds: 1800,
      eventType: "timer_start",
      reviewStatus: "confirmed",
      source: "manual_app",
      startedAt: new Date(stoppedAtMs - 1_800_000),
      stoppedAt: new Date(stoppedAtMs),
      userConfirmed: false,
      confirmedInReview: false,
      ownerAuthoredInReview: false,
      tagNames: [],
      ...overrides
    });
    const rows = [
      row("app-testing", "App testing", now.getTime() - 15 * 3_600_000),
      ...Array.from({ length: 200 }, (_, index) =>
        row(`bau-${index}`, "BAU", now.getTime() - (1 + index * 0.5) * day)),
      ...Array.from({ length: 180 }, (_, index) =>
        row(`task-${index}`, `Task ${index}`, now.getTime() - (2 + index * 0.25) * day)),
      row("too-old", "Ancient project", now.getTime() - (TASK_SUGGESTION_CANDIDATE_WINDOW_DAYS + 1) * day),
      row("short", "Blip", now.getTime() - 3_600_000, { durationSeconds: 30 }),
      row("visit-suggested-title", "Visit Example Clinic", now.getTime() - day, {
        source: "location_learning",
        eventType: "learned_place_visit",
        userConfirmed: true,
        confirmedInReview: true
      })
    ];
    const seen: unknown[][] = [];
    mocks.query.mockImplementation(async (statement: string, values: unknown[]) => {
      expect(statement).toContain("where te.workspace_id = $1");
      expect(statement).toContain("and te.user_id = $2");
      expect(statement).toContain("te.review_status = 'confirmed'");
      expect(statement).toContain(confirmedInReviewSql);
      expect(statement).toContain(ownerAuthoredInReviewSql);
      seen.push(values);
      return { rows };
    });

    const sets = await getTaskSuggestionSets(session, now);
    const other: RequestSession = { ...session, workspaceId: "workspace-2", userId: "user-2" };
    await getTaskSuggestionSets(other, now);
    expect(seen).toEqual([
      [session.workspaceId, session.userId],
      [other.workspaceId, other.userId]
    ]);

    // The contextual list keeps its size and meaning (older clients read it).
    expect(sets.taskSuggestions).toHaveLength(6);
    expect(sets.taskSuggestions).toEqual(buildRecentActivitySuggestions(rows as never, {
      contextDate: now,
      limit: 6,
      minDurationSeconds: 60
    }));

    const descriptions = sets.taskSuggestionCandidates.map((candidate) => candidate.description);
    expect(sets.taskSuggestionCandidates).toHaveLength(TASK_SUGGESTION_CANDIDATE_LIMIT);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(descriptions[0]).toBe("App testing");
    expect(descriptions).toContain("BAU");
    expect(descriptions).not.toContain("Ancient project");
    expect(descriptions).not.toContain("Blip");
    // #363: a visit confirmed under Dayframe's suggested title never feeds typed search.
    expect(descriptions).not.toContain("Visit Example Clinic");
    expect(sets.taskSuggestionCandidates.find((candidate) => candidate.description === "BAU"))
      .toEqual(expect.objectContaining({ useCount: 200, learningTier: 1 }));
    expect(sets.taskSuggestionCandidates[0]?.lastSeenAt).toBe(new Date(now.getTime() - 15 * 3_600_000).toISOString());
    // Payload stays small: one compact object per distinct variant, no per-block rows.
    expect(JSON.stringify(sets.taskSuggestionCandidates).length).toBeLessThan(TASK_SUGGESTION_CANDIDATE_LIMIT * 400);
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

describe("latest finished block for \"start at the previous end\" (PRD D16)", () => {
  it("orders finished blocks by their end, over ends in the last 72 h however old the start", () => {
    const statement = buildTimeEntriesQuery(session, { latestFinished: true, limit: 1, capturedNow: "2026-10-14T11:00:00.000Z" });
    expect(statement.text).toContain("te.stopped_at is not null");
    // A timer started four days ago and stopped today still counts (Codex r2 on #418).
    expect(statement.text).toContain("te.stopped_at >= $3::timestamptz - interval '72 hours'");
    expect(statement.text).not.toContain("te.started_at >= $3::timestamptz - interval");
    expect(statement.text).toContain("order by te.stopped_at desc, te.id desc");
    expect(statement.values).toEqual([session.workspaceId, session.userId, "2026-10-14T11:00:00.000Z", 1]);
    // Every other list keeps its latest-started order.
    expect(buildTimeEntriesQuery(session, { limit: 100 }).text).toContain("order by te.started_at desc, te.id desc");
  });

  it("sends the latest-ending block with bootstrap even when entries miss it", async () => {
    const long = { id: "long", startedAt: "2026-10-14T06:00:00.000Z", stoppedAt: "2026-10-14T10:45:00.000Z" };
    mocks.query.mockImplementation(async (statement: string) => {
      if (statement.includes("order by te.stopped_at desc")) return { rows: [long] };
      return { rows: [] };
    });
    const data = await getBootstrapData(session);
    expect(data.latestFinishedEntry).toMatchObject(long);
    mocks.query.mockImplementation(async () => ({ rows: [] }));
    expect((await getBootstrapData(session)).latestFinishedEntry).toBeNull();
  });
});

describe("confirmed-in-Review flag on history entries (E1)", () => {
  it("marks blocks created by an accepted Review item or a Review correction, scoped to the session", () => {
    const statement = buildTimeEntriesQuery(session, { limit: 2000 });

    expect(statement.text).toContain(confirmedInReviewSql);
    expect(confirmedInReviewSql).toContain('as "confirmedInReview"');
    // Accepted Review items of this workspace and user only: auto-logged blocks have none, and
    // open or skipped suggestions are never `accepted`.
    expect(confirmedInReviewSql).toContain("te.created_from_event_id in (");
    expect(confirmedInReviewSql).toContain("accepted_review.workspace_id = $1");
    expect(confirmedInReviewSql).toContain("accepted_review.user_id = $2");
    expect(confirmedInReviewSql).toContain("accepted_review.status = 'accepted'");
    // Split/merge-and-confirm children come from correction events created only by Review.
    expect(confirmedInReviewSql).toContain("te.source = 'location_learning'");
    expect(confirmedInReviewSql).toContain("correction_event.client_event_id like 'location-correction:%'");
    expect(confirmedInReviewSql).toContain("correction_event.user_id = te.user_id");
    expect(statement.values.slice(0, 2)).toEqual([session.workspaceId, session.userId]);
  });

  it("reads the owner-authored Review signal from the block's own location event (Codex r2)", () => {
    const statement = buildTimeEntriesQuery(session, { limit: 2000 });

    expect(statement.text).toContain(ownerAuthoredInReviewSql);
    expect(ownerAuthoredInReviewSql).toContain('as "ownerAuthoredInReview"');
    expect(ownerAuthoredInReviewSql).toContain("raw_payload -> 'dayframeReviewDecision' ->> 'ownerAuthoredDescription'");
    expect(ownerAuthoredInReviewSql).toContain("owner_event.id = te.created_from_event_id");
    expect(ownerAuthoredInReviewSql).toContain("owner_event.workspace_id = te.workspace_id");
    expect(ownerAuthoredInReviewSql).toContain("owner_event.user_id = te.user_id");
    expect(ownerAuthoredInReviewSql).toContain("owner_event.source = 'location_learning'");
  });
});

describe("getUser goals revision (UIA-309)", () => {
  beforeEach(async () => {
    mocks.query.mockReset();
    const db = await import("./db");
    vi.mocked(db.isUndefinedColumnError).mockReset().mockReturnValue(false);
  });

  it("returns the goals with the server's revision as a number", async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: "user-1", email: "a@b.c", name: "A", dailyGoalMinutes: 480, weeklyGoalMinutes: 2400, goalsRevision: "12" }] });
    await expect(getUser(session)).resolves.toMatchObject({ goalsRevision: 12 });
    expect(String(mocks.query.mock.calls[0][0])).toContain('goals_revision as "goalsRevision"');
  });

  it("names the migration when goals_revision is missing", async () => {
    const db = await import("./db");
    vi.mocked(db.isUndefinedColumnError).mockImplementation((_error, column) => column === "goals_revision");
    mocks.query.mockRejectedValue(Object.assign(new Error('column "goals_revision" does not exist'), { code: "42703" }));
    await expect(getUser(session)).rejects.toThrow("users.goals_revision missing");
    expect(db.missingRequiredColumnError).toHaveBeenCalledWith(
      "users",
      "goals_revision",
      "supabase/migrations/202610120002_user_goals_revision.sql",
      expect.any(Error)
    );
  });
});
