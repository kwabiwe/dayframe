import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DAYFRAME_STARTER_ACTIVITIES } from "@dayframe/shared";

vi.mock("../db", () => ({ pool: { connect: vi.fn() }, query: vi.fn(), hasTableColumn: vi.fn(async () => true) }));

const { seedDefaultWorkspaceData } = await import("./local");

describe("new workspace seeding", () => {
  it("creates the 16 starter activities instead of a single General category", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        statements.push({ sql, params });
        if (sql.includes("insert into clients")) return { rows: [{ id: "client-1" }] };
        if (sql.includes("insert into categories")) {
          return { rows: DAYFRAME_STARTER_ACTIVITIES.map((starter) => ({ id: `cat-${starter.starterKey}`, name: starter.name, starterKey: starter.starterKey })) };
        }
        return { rows: [] };
      })
    };

    await seedDefaultWorkspaceData(client as never, "workspace-1");

    const categoryInserts = statements.filter((statement) => statement.sql.includes("insert into categories"));
    expect(categoryInserts).toHaveLength(1);
    expect(categoryInserts[0].sql).toContain("icon, starter_key");
    expect(categoryInserts[0].params).toContain("Errands");
    expect(categoryInserts[0].params).not.toContain("General");
    const project = statements.find((statement) => statement.sql.includes("insert into projects"));
    expect(project?.params).toEqual(["workspace-1", "client-1", null, "lime"]);
    expect(statements.some((statement) => statement.sql.includes("insert into event_sources"))).toBe(true);
  });

  it("is the one seeding path for workspaces created from the app", () => {
    const route = readFileSync(`${process.cwd()}/src/app/api/workspaces/route.ts`, "utf8");
    expect(route).toContain("await seedDefaultWorkspaceData(client, workspaceId);");
    expect(route).not.toContain("insert into categories");
  });
});
