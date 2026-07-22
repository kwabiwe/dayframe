import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseReportQueryInput } from "./report-filters";
import {
  buildReportDataQuery,
  buildReportExportQuery,
  getReports,
  sanitizeReportFilters,
  type ReportFilterOptions
} from "./report-service";
import type { RequestSession } from "./session";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("./db", () => ({ query: mocks.query }));

const workspaceId = "10000000-0000-4000-8000-000000000001";
const userAId = "10000000-0000-4000-8000-000000000002";
const userBId = "10000000-0000-4000-8000-000000000003";
const categoryId = "20000000-0000-4000-8000-000000000001";
const foreignCategoryId = "20000000-0000-4000-8000-000000000099";
const tagAId = "30000000-0000-4000-8000-000000000001";
const tagBId = "30000000-0000-4000-8000-000000000002";
const foreignTagId = "30000000-0000-4000-8000-000000000099";
const placeId = "40000000-0000-4000-8000-000000000001";
const foreignPlaceId = "40000000-0000-4000-8000-000000000099";
const session: RequestSession = {
  workspaceId,
  userId: userAId,
  authMode: "dev",
  scopes: ["app:read", "exports:read"]
};
const input = parseReportQueryInput({ range: "custom", from: "2026-07-20", to: "2026-07-22" }, {
  now: new Date(2026, 6, 22, 12)
});

describe("report query architecture", () => {
  it("uses one workspace/user-scoped candidate set and exact clipped overlap semantics", () => {
    const statement = buildReportDataQuery(session, input, input.filters, "2026-07-22T12:00:00.000Z");

    expect(statement.text).toContain("with candidate_entries as");
    expect(statement.text.match(/candidate_entries as/g)).toHaveLength(1);
    expect(statement.text).toMatch(/te\.workspace_id = \$\d+/);
    expect(statement.text).toMatch(/te\.user_id = \$\d+/);
    expect(statement.text).toMatch(/te\.started_at < \$\d+::timestamptz/);
    expect(statement.text).toMatch(/coalesce\(te\.stopped_at, \$\d+::timestamptz\) > \$\d+::timestamptz/);
    expect(statement.text).toMatch(/least\(ce\.effective_stopped_at, \$\d+::timestamptz\)[\s\S]*greatest\(ce\.started_at, \$\d+::timestamptz\)/);
    expect(statement.text).toContain("cat.workspace_id = te.workspace_id");
    expect(statement.text).toContain("pl.workspace_id = te.workspace_id");
    expect(statement.text).not.toContain("from projects");
    expect(statement.text).not.toContain("join clients");
    expect(statement.text).not.toContain("now()");
    expect(statement.values).toContain(workspaceId);
    expect(statement.values).toContain(userAId);
    expect(statement.values).toContain("2026-07-22T12:00:00.000Z");
  });

  it("combines category, Uncategorized, tag ANY, place, source and literal description filters", () => {
    const filtered = parseReportQueryInput({
      range: "custom",
      from: "2026-07-20",
      to: "2026-07-22",
      categories: `${categoryId},uncategorized`,
      tags: `${tagAId},${tagBId}`,
      places: `${placeId},no-place`,
      sources: "manual_app,mobile_app",
      description: "%school_"
    }, { now: new Date(2026, 6, 22, 12) });
    const statement = buildReportDataQuery(session, filtered, filtered.filters, "2026-07-22T12:00:00.000Z");

    expect(statement.text).toContain("te.category_id = any(");
    expect(statement.text).toContain("te.category_id is null");
    expect(statement.text).toContain("exists (");
    expect(statement.text).toContain("filter_tag.id = any(");
    expect(statement.text).toContain("te.place_id = any(");
    expect(statement.text).toContain("te.place_id is null");
    expect(statement.text).toContain("te.source = any(");
    expect(statement.text).toContain("position(lower(");
    expect(statement.text).not.toMatch(/ilike/i);
    expect(statement.values).toContainEqual([tagAId, tagBId]);
    expect(statement.values).toContain("%school_");
  });

  it("does not join tag filters into the matching entry set or multiply durations", () => {
    const filtered = parseReportQueryInput({
      range: "custom",
      from: "2026-07-20",
      to: "2026-07-22",
      tags: `${tagAId},${tagBId}`
    }, { now: new Date(2026, 6, 22, 12) });
    const statement = buildReportDataQuery(session, filtered, filtered.filters, "2026-07-22T12:00:00.000Z");
    const candidateBlock = statement.text.slice(0, statement.text.indexOf("filtered_entries as"));

    expect(candidateBlock).toContain("exists (");
    expect(candidateBlock).not.toMatch(/join time_entry_tags tet\b/);
    expect(statement.text).toContain("count(distinct fe.id)::int as entry_count");
    expect(statement.text).toContain("(select count(*) from filtered_entries)");
  });

  it("zero-fills daily totals without turning missing left-join rows into 24-hour days", () => {
    const statement = buildReportDataQuery(session, input, input.filters, "2026-07-22T12:00:00.000Z");
    expect(statement.text).toContain("filter (where fe.id is not null)");
    expect(statement.text).toContain("left join filtered_entries fe");
    expect(statement.text).toContain("coalesce(");
  });

  it("keeps detail sorting and pagination bounded", () => {
    const durationInput = parseReportQueryInput({
      range: "custom",
      from: "2026-07-20",
      to: "2026-07-22",
      sort: "duration",
      page: "2"
    }, { now: new Date(2026, 6, 22, 12), pageSize: 25 });
    const statement = buildReportDataQuery(session, durationInput, durationInput.filters, "2026-07-22T12:00:00.000Z");
    expect(statement.text).toContain("order by clipped_seconds desc, started_at desc, id desc");
    expect(statement.text).toMatch(/limit \$\d+[\s\S]*offset \$\d+/);
    expect(statement.values.slice(0, 2)).toEqual([25, 25]);
  });

  it("uses the identical scoped matching CTE for CSV export", () => {
    const statement = buildReportExportQuery(session, input, input.filters, "2026-07-22T12:00:00.000Z");
    expect(statement.text).toContain("with candidate_entries as");
    expect(statement.text).toMatch(/te\.workspace_id = \$\d+/);
    expect(statement.text).toMatch(/te\.user_id = \$\d+/);
    expect(statement.text).toContain("from filtered_entries fe");
    expect(statement.text).not.toContain('as "confidence"');
    expect(statement.text).not.toContain("raw_payload");
    expect(statement.values).toContain(workspaceId);
    expect(statement.values).toContain(userAId);
  });
});

describe("report scope and response", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps two users in the same workspace isolated across every aggregate", async () => {
    mockOptionsAndReportData();
    const [reportA, reportB] = await Promise.all([
      getReports(session, input),
      getReports({ ...session, userId: userBId }, input)
    ]);

    expect(reportA.totalSeconds).toBe(600);
    expect(reportA.byCategory[0].seconds).toBe(600);
    expect(reportA.byTag[0].seconds).toBe(600);
    expect(reportA.byPlace[0].seconds).toBe(600);
    expect(reportA.bySource[0].seconds).toBe(600);
    expect(reportA.entries).toHaveLength(1);
    expect(reportB.totalSeconds).toBe(1_200);
    expect(reportB.byCategory[0].seconds).toBe(1_200);
    expect(reportB.entries).toHaveLength(1);
  });

  it("computes daily average, active days, pagination and running details without NaN", async () => {
    mockOptionsAndReportData();
    const report = await getReports(session, input);
    expect(report.dailyAverageSeconds).toBe(200);
    expect(report.activeDayCount).toBe(1);
    expect(report.entries[0]).toEqual(expect.objectContaining({
      isRunning: true,
      durationSeconds: 600,
      tagNames: ["Focus"],
      tags: [expect.objectContaining({ id: tagAId })]
    }));
    expect(report.pagination).toEqual(expect.objectContaining({
      totalEntries: 1,
      totalPages: 1,
      hasNext: false
    }));
    expect(Number.isFinite(report.comparison.absoluteDeltaSeconds)).toBe(true);
  });

  it("drops category, tag and place IDs that are outside the current workspace options", () => {
    const filters = parseReportQueryInput({
      categories: `${categoryId},${foreignCategoryId},uncategorized`,
      tags: `${tagAId},${foreignTagId}`,
      places: `${placeId},${foreignPlaceId},no-place`,
      sources: "manual_app"
    }, { now: new Date(2026, 6, 22, 12) }).filters;
    expect(sanitizeReportFilters(filters, options)).toEqual(expect.objectContaining({
      categories: [categoryId, "uncategorized"],
      tags: [tagAId],
      places: [placeId, "no-place"],
      sources: ["manual_app"]
    }));
  });
});

const options = {
  categories: [{ id: categoryId, name: "Work", color: "blue", isPinned: true }],
  tags: [{ id: tagAId, name: "Focus", normalizedName: "focus", usageCount: 1 }],
  places: [{
    id: placeId,
    name: "Office",
    latitude: null,
    longitude: null,
    radiusMeters: 100,
    priority: 0,
    defaultProjectId: null,
    defaultProjectName: null,
    defaultCategoryId: null,
    defaultCategoryName: null,
    defaultActivityDescription: null,
    autoStart: false,
    loggingEnabled: true
  }],
  sources: [{ id: "manual_app", name: "Web timer" }]
} satisfies ReportFilterOptions;

function mockOptionsAndReportData() {
  mocks.query.mockImplementation(async (statement: string, values: unknown[]) => {
    if (statement.includes("from categories")) return { rows: options.categories };
    if (statement.includes("from tags tag")) return { rows: options.tags };
    if (statement.includes("from places pl")) return { rows: options.places };
    if (!statement.includes("with candidate_entries as")) throw new Error(`Unexpected query: ${statement}`);

    const userPlaceholder = Number(statement.match(/te\.user_id = \$(\d+)/)?.[1]);
    const userId = values[userPlaceholder - 1];
    const seconds = userId === userAId ? 600 : 1_200;
    return { rows: [reportData(seconds)] };
  });
}

function reportData(seconds: number) {
  const breakdown = [{ id: categoryId, name: "Work", color: "blue", seconds, entryCount: 1 }];
  return {
    totalSeconds: seconds,
    previousPeriodSeconds: 0,
    byCategory: breakdown,
    byTag: [{ id: tagAId, name: "Focus", color: "steel", seconds, entryCount: 1 }],
    byPlace: [{ id: placeId, name: "Office", color: null, seconds, entryCount: 1 }],
    bySource: [{ id: "manual_app", name: "manual_app", color: null, seconds, entryCount: 1 }],
    dailySeries: [
      { key: "2026-07-20", label: "Mon 20 Jul", seconds },
      { key: "2026-07-21", label: "Tue 21 Jul", seconds: 0 },
      { key: "2026-07-22", label: "Wed 22 Jul", seconds: 0 }
    ],
    entries: [{
      id: `entry-${seconds}`,
      projectId: null,
      projectName: null,
      projectColor: null,
      clientName: null,
      categoryId,
      categoryName: "Work",
      categoryColor: "blue",
      placeId,
      placeName: "Office",
      source: "manual_app",
      confidence: "high",
      reviewStatus: "confirmed",
      description: "Focus",
      startedAt: "2026-07-20T09:00:00.000Z",
      stoppedAt: null,
      durationSeconds: seconds,
      isRunning: true,
      tagNames: ["Focus"],
      tags: [{ id: tagAId, name: "Focus", normalizedName: "focus" }]
    }],
    totalEntries: 1
  };
}
