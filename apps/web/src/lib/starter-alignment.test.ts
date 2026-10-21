import { describe, expect, it, vi } from "vitest";
import { DAYFRAME_STARTER_ACTIVITIES } from "@dayframe/shared";
import { applyStarterAlignment, describeAlignment, planStarterAlignment, type AlignmentRow } from "./starter-alignment";

const row = (name: string, starterKey: string | null = null, isArchived = false): AlignmentRow =>
  ({ id: `id-${name}-${starterKey ?? "own"}`, name, starterKey, isArchived });
const everyStarter = () => DAYFRAME_STARTER_ACTIVITIES.map((starter) => row(starter.starterKey === "travel" ? "Travel" : starter.name, starter.starterKey));

describe("aligning a workspace with a new account's activities (owner, 20 Oct 2026)", () => {
  it("renames the Travel starter to Getting around in place and adds nothing when the rest is there", () => {
    const plan = planStarterAlignment(everyStarter());
    expect(plan.rename).toEqual({ id: "id-Travel-travel", from: "Travel", to: "Getting around", icon: "journey" });
    expect(plan.add).toEqual([]);
    expect(describeAlignment(plan)[0]).toBe('rename "Travel" → "Getting around" (icon journey; same id, colour and history)');
  });

  it("adds missing starters unpinned, and leaves same-named or archived ones alone", () => {
    const rows = [row("Work", "work"), row("travel"), row("Sleep"), row("Meals", "meals", true)];
    const plan = planStarterAlignment(rows);
    expect(plan.rename).toMatchObject({ id: "id-travel-own", to: "Getting around" });
    expect(plan.add.map((starter) => starter.name)).not.toContain("Sleep");
    expect(plan.add.map((starter) => starter.name)).not.toContain("Meals");
    expect(plan.add.map((starter) => starter.name)).not.toContain("Getting around");
    expect(plan.add.map((starter) => starter.name)).toContain("Admin");
    expect(plan.leftAlone).toEqual([
      { name: "Sleep", reason: "kept: already has this starter's name" },
      { name: "Meals", reason: "kept archived: not added again" }
    ]);
  });

  it("never renames an activity the person renamed, nor a Travel beside an existing Getting around", () => {
    const renamed = planStarterAlignment([row("Trips", "travel")]);
    expect(renamed.rename).toBeNull();
    expect(renamed.add.map((starter) => starter.name)).not.toContain("Getting around");
    expect(renamed.leftAlone).toContainEqual({ name: "Trips", reason: "kept: the Travel starter was renamed by you" });
    const both = planStarterAlignment([row("Getting around", "travel"), row("Travel")]);
    expect(both.rename).toBeNull();
    expect(both.leftAlone).toContainEqual({ name: "Travel", reason: 'kept: a "Getting around" activity already exists' });
  });

  it("never takes another starter renamed Travel, and reports it (Codex r1 on #502)", () => {
    const plan = planStarterAlignment([row("Travel", "work")]);
    expect(plan.rename).toBeNull();
    expect(plan.add.map((starter) => starter.name)).toContain("Getting around");
    expect(plan.leftAlone).toContainEqual({ name: "Travel", reason: "kept: another activity with this name" });
  });

  it("does not add Getting around again when an archived Travel is there (Codex r1 on #502)", () => {
    const plan = planStarterAlignment([row("Travel", null, true)]);
    expect(plan.add.map((starter) => starter.name)).not.toContain("Getting around");
    expect(plan.leftAlone).toContainEqual({ name: "Travel", reason: "kept archived: not added again" });
  });

  it("reports an unlinked Getting around, and never renames Travel beside it into a duplicate (Codex r1 on #502)", () => {
    const plan = planStarterAlignment([row("Travel", "travel"), row("Getting around")]);
    expect(plan.rename).toBeNull();
    expect(plan.leftAlone).toEqual(expect.arrayContaining([
      { name: "Getting around", reason: "kept: already has this starter's name" },
      { name: "Travel", reason: 'kept: a "Getting around" activity already exists' }
    ]));
  });

  it("is a no-op once aligned", () => {
    const aligned = DAYFRAME_STARTER_ACTIVITIES.map((starter) => row(starter.name, starter.starterKey));
    expect(planStarterAlignment(aligned)).toEqual({ rename: null, add: [], leftAlone: [] });
  });

  it("applies under the activity-name and workspace locks, renaming in place and inserting unpinned", async () => {
    const statements: { sql: string; params: unknown[] }[] = [];
    const client = { query: vi.fn(async (sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      if (sql.startsWith("select id, name, starter_key")) return { rows: [row("Travel", "travel"), row("Work", "work")], rowCount: 2 };
      if (sql.startsWith("update categories")) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) };
    const plan = await applyStarterAlignment(client as never, "ws-1");
    const locks = statements.filter((statement) => statement.sql.includes("pg_advisory_xact_lock")).map((statement) => statement.params[0]);
    expect(locks).toEqual(["commute", "getting around", "sleep", "travel"].map((name) => `dayframe:auto-category:ws-1:${name}`));
    expect(statements.findIndex((statement) => statement.sql.includes("for no key update")))
      .toBeLessThan(statements.findIndex((statement) => statement.sql.startsWith("select id, name, starter_key")));
    const update = statements.find((statement) => statement.sql.startsWith("update categories"))!;
    expect(update.params).toEqual(["id-Travel-travel", "ws-1", "Getting around", "journey", "travel"]);
    // A Travel archived after the plan was read is not renamed (Codex r1 on #502).
    expect(update.sql).toContain("coalesce(is_archived, false) = false");
    const inserts = statements.filter((statement) => statement.sql.includes("insert into categories"));
    expect(inserts).toHaveLength(plan.add.length);
    expect(inserts.every((statement) => statement.sql.includes("false"))).toBe(true);
  });

  it("changes nothing if the Travel activity changed meanwhile", async () => {
    const client = { query: vi.fn(async (sql: string) => {
      if (sql.startsWith("select id, name, starter_key")) return { rows: [row("Travel", "travel")], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) };
    await expect(applyStarterAlignment(client as never, "ws-1")).rejects.toThrow("changed while aligning");
  });
});

describe("Getting around's old lock name (Codex r1 on #502)", () => {
  it("is taken with the new one, in sorted order, by every writer that locks the name", async () => {
    const { lockActivityNames } = await import("./automatic-category-service");
    const params: unknown[] = [];
    const client = { query: vi.fn(async (_sql: string, values: unknown[] = []) => { params.push(values[0]); return { rows: [] }; }) };
    await lockActivityNames(client as never, "ws-1", ["Trips", "Getting around"]);
    expect(params).toEqual(["getting around", "travel", "trips"].map((name) => `dayframe:auto-category:ws-1:${name}`));
  });
});
