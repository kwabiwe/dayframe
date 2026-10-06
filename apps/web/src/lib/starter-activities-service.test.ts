import { beforeEach, describe, expect, it, vi } from "vitest";
import { DAYFRAME_STARTER_ACTIVITIES } from "@dayframe/shared";
import type { RequestSession } from "./session";

type Row = { id: string; name: string; starterKey: string | null };

const db = vi.hoisted(() => ({
  existing: [] as Array<{ id: string; name: string; starterKey: string | null }>,
  statements: [] as Array<{ sql: string; params: unknown[] }>
}));

function fakeClient() {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      db.statements.push({ sql, params });
      if (sql.startsWith("select id, name, starter_key")) return { rows: db.existing };
      if (sql.includes("insert into categories")) {
        const rows: Row[] = [];
        for (let index = 1; index < params.length; index += 5) {
          rows.push({ id: `new-${params[index + 4]}`, name: String(params[index]), starterKey: String(params[index + 4]) });
        }
        return { rows };
      }
      return { rows: [] };
    }),
    release: vi.fn()
  };
}

const client = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeClient> | null }));

vi.mock("./db", () => ({
  pool: { connect: vi.fn(async () => client.current) },
  query: vi.fn()
}));

const { addMissingStarterActivities, insertStarterActivities } = await import("./starter-activities-service");

const session: RequestSession = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "dev",
  scopes: []
};

beforeEach(() => {
  db.existing = [];
  db.statements = [];
  client.current = fakeClient();
});

describe("starter activities service", () => {
  it("inserts all 16 starters with their colour, pin, icon and starter key for a new workspace", async () => {
    const created = await insertStarterActivities(client.current as never, session.workspaceId);

    const insert = db.statements.find((statement) => statement.sql.includes("insert into categories"));
    expect(insert?.sql).toContain("(workspace_id, name, color, is_pinned, icon, starter_key)");
    expect(insert?.params[0]).toBe(session.workspaceId);
    expect(insert?.params.slice(1, 6)).toEqual(["Work", "blue", true, "work", "work"]);
    expect(insert?.params).toHaveLength(1 + 16 * 5);
    expect(created.map((row) => row.starterKey)).toEqual(DAYFRAME_STARTER_ACTIVITIES.map((starter) => starter.starterKey));
  });

  it("adds only missing starters to an existing workspace, links same-named activities and never renames", async () => {
    db.existing = [
      { id: "work", name: "Work", starterKey: "work" },
      { id: "my-sleep", name: "  sleep ", starterKey: null },
      { id: "renamed-commute", name: "Getting there", starterKey: "commute" },
      { id: "general", name: "General", starterKey: null }
    ];

    const result = await addMissingStarterActivities(session);

    expect(result.linked).toEqual([{ id: "my-sleep", starterKey: "sleep" }]);
    expect(result.added.map((row) => row.starterKey)).toEqual(
      DAYFRAME_STARTER_ACTIVITIES.map((starter) => starter.starterKey).filter((key) => !["work", "sleep", "commute"].includes(key))
    );
    // An existing workspace keeps its own pins: added starters arrive unpinned.
    const insert = db.statements.find((statement) => statement.sql.includes("insert into categories"));
    const pins = (insert?.params ?? []).filter((_, index) => index > 0 && (index - 1) % 5 === 2);
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every((pinned) => pinned === false)).toBe(true);
    const link = db.statements.find((statement) => statement.sql.startsWith("update categories set starter_key"));
    expect(link?.params).toEqual(["sleep", "my-sleep", session.workspaceId]);
    expect(link?.sql).toContain("starter_key is null");
    expect(db.statements.some((statement) => /set (name|color|icon|is_pinned)/.test(statement.sql))).toBe(false);
    expect(db.statements.map((statement) => statement.sql)).toEqual(expect.arrayContaining(["begin", "commit"]));
  });

  it("never adds a starter whose name an active activity already uses under another key", async () => {
    // Exercise was archived, then Walk was renamed to "Exercise": the starter must not come back as a duplicate name.
    db.existing = DAYFRAME_STARTER_ACTIVITIES
      .filter((starter) => starter.starterKey !== "exercise")
      .map((starter) => ({ id: starter.starterKey, name: starter.starterKey === "walk" ? "Exercise" : starter.name, starterKey: starter.starterKey }));

    const result = await addMissingStarterActivities(session);

    expect(result).toEqual({ added: [], linked: [] });
    expect(db.statements.some((statement) => statement.sql.includes("insert into categories"))).toBe(false);
  });

  it("links the oldest of two same-named activities and reads them oldest first", async () => {
    db.existing = [
      { id: "older-sleep", name: "Sleep", starterKey: null },
      { id: "newer-sleep", name: "sleep", starterKey: null }
    ];

    const result = await addMissingStarterActivities(session);

    expect(result.linked).toEqual([{ id: "older-sleep", starterKey: "sleep" }]);
    const read = db.statements.find((statement) => statement.sql.startsWith("select id, name, starter_key"));
    expect(read?.sql).toContain("order by created_at asc");
  });

  it("takes the automatic Sleep and Commute locks before reading, like automatic category creation", async () => {
    await addMissingStarterActivities(session);

    const locks = db.statements.filter((statement) => statement.sql.includes("pg_advisory_xact_lock")).map((statement) => statement.params[0]);
    expect(locks).toEqual([
      `dayframe:auto-category:${session.workspaceId}:commute`,
      `dayframe:auto-category:${session.workspaceId}:sleep`
    ]);
    const firstRead = db.statements.findIndex((statement) => statement.sql.startsWith("select id, name, starter_key"));
    const lastLock = db.statements.map((statement) => statement.sql).lastIndexOf("select pg_advisory_xact_lock(hashtextextended($1, 0))");
    expect(lastLock).toBeLessThan(firstRead);
  });

  it("does nothing when every starter is already present", async () => {
    db.existing = DAYFRAME_STARTER_ACTIVITIES.map((starter) => ({ id: starter.starterKey, name: starter.name, starterKey: starter.starterKey }));

    const result = await addMissingStarterActivities(session);

    expect(result).toEqual({ added: [], linked: [] });
    expect(db.statements.some((statement) => statement.sql.includes("insert into categories"))).toBe(false);
  });
});
