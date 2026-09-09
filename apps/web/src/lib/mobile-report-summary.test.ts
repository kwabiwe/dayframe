import { describe, expect, it } from "vitest";
import pg from "pg";
import { ReportSummarySchema, type ReportSummary } from "@dayframe/shared";
import { buildMobileReportSummaryQuery } from "./mobile-report-summary";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const session = {
  workspaceId,
  userId,
  authMode: "dev" as const,
  scopes: ["app:read"],
};
const start = "2026-09-09T00:00:00.000Z";
const end = "2026-09-11T00:00:00.000Z";
const middle = "2026-09-10T00:00:00.000Z";
const input = {
  start,
  end,
  buckets: [
    { key: "one", start, end: middle },
    { key: "two", start: middle, end },
  ],
};
describe("mobile aggregate SQL", () => {
  it("scopes one bounded aggregate query with one captured now and no sensitive payload", () => {
    const sql = buildMobileReportSummaryQuery(session, input, middle);
    expect(sql.values.slice(0, 5)).toEqual([
      workspaceId,
      userId,
      middle,
      start,
      end,
    ]);
    expect(sql.text).toContain("te.user_id = $2::uuid");
    expect(sql.text).toContain("te.workspace_id = $1::uuid");
    expect(sql.text).toContain("c.workspace_id = te.workspace_id");
    expect(sql.text).not.toMatch(
      /raw_payload|description|latitude|longitude|join projects|now\(\)/,
    );
  });
  it.skipIf(!process.env.DAYFRAME_REPORT_TEST_DATABASE_URL)(
    "executes clipping, overlap, active and same-workspace user isolation in disposable Postgres",
    async () => {
      const url = process.env.DAYFRAME_REPORT_TEST_DATABASE_URL!;
      if (!/^postgres(?:ql)?:\/\/[^/]*@(?:localhost|127\.0\.0\.1):/.test(url))
        throw new Error("Disposable localhost database only");
      const client = new pg.Client({ connectionString: url });
      await client.connect();
      try {
        await client.query("begin");
        await client.query(
          "create temporary table categories (id uuid, workspace_id uuid, name text, color text); create temporary table time_entries (id uuid, workspace_id uuid, user_id uuid, category_id uuid, started_at timestamptz, stopped_at timestamptz, review_status text)",
        );
        const category = "20000000-0000-4000-8000-000000000001";
        await client.query(
          "insert into categories values ($1,$2,'Work','blue')",
          [category, workspaceId],
        );
        const insert = async (
          n: number,
          from: string,
          to: string | null,
          owner = userId,
          status = "confirmed",
          cat: string | null = category,
          workspace = workspaceId,
        ) =>
          client.query(
            "insert into time_entries values ($1,$2,$3,$4,$5,$6,$7)",
            [
              `30000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
              workspace,
              owner,
              cat,
              from,
              to,
              status,
            ],
          );
        await insert(1, "2026-09-08T23:00:00Z", "2026-09-09T01:00:00Z");
        await insert(2, "2026-09-09T00:30:00Z", "2026-09-09T01:30:00Z");
        await insert(
          3,
          "2026-09-09T23:30:00Z",
          null,
          userId,
          "confirmed",
          null,
        );
        await insert(4, start, end, "10000000-0000-4000-8000-000000000003");
        await insert(5, start, end, userId, "needs_review");
        await insert(
          6,
          start,
          end,
          userId,
          "confirmed",
          category,
          "10000000-0000-4000-8000-000000000099",
        );
        const captured = "2026-09-10T00:30:00.500Z";
        const sql = buildMobileReportSummaryQuery(session, input, captured);
        const response = await client.query<{ summary: ReportSummary }>(
          sql.text,
          sql.values,
        );
        const result = ReportSummarySchema.parse(response.rows[0].summary);
        expect(result.totalSeconds).toBe(10800.5);
        expect(result.buckets.map((b) => b.seconds)).toEqual([9000, 1800.5]);
        expect(result.categories.reduce((sum, c) => sum + c.seconds, 0)).toBe(
          result.totalSeconds,
        );
        expect(result.buckets.reduce((sum, b) => sum + b.seconds, 0)).toBe(
          result.totalSeconds,
        );
        expect(result.active?.buckets.map((b) => b.seconds)).toEqual([
          1800, 1800.5,
        ]);
        expect(
          result.categories.find((c) => c.key === "uncategorized")?.seconds,
        ).toBe(3600.5);
      } finally {
        await client.query("rollback");
        await client.end();
      }
    },
  );
});
