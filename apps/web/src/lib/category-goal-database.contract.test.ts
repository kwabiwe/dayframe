import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// UIA-043: categories.counts_toward_goal, off for Sleep by default.
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const localMigrations = readdirSync(`${repositoryRoot}packages/db/migrations`).filter((file) => file.endsWith(".sql")).sort();
const hostedMigrations = readdirSync(`${repositoryRoot}supabase/migrations`).filter((file) => file.endsWith(".sql")).sort();
const read = (path: string) => readFileSync(`${repositoryRoot}${path}`, "utf8");
const localBase = read("packages/db/migrations/001_init.sql");
const local = read("packages/db/migrations/010_category_counts_toward_goal.sql");
const hosted = read("supabase/migrations/202610110001_category_counts_toward_goal.sql");

describe("Counts toward goal database contract", () => {
  it("adds the local migration after place roles and the hosted one last", () => {
    expect(localMigrations.indexOf("010_category_counts_toward_goal.sql")).toBe(localMigrations.indexOf("009_place_role.sql") + 1);
    expect(hostedMigrations.indexOf("202610110001_category_counts_toward_goal.sql"))
      .toBeGreaterThan(hostedMigrations.indexOf("202610070001_place_role.sql"));
  });

  it("adds a non-null column that counts by default and switches Sleep off once", () => {
    for (const sql of [local, hosted, localBase]) {
      expect(sql).toContain("add column counts_toward_goal boolean not null default true");
      expect(sql).toContain("where starter_key = 'sleep' or lower(btrim(name)) = 'sleep'");
      // The backfill sits inside the run that adds the column, so a rerun never undoes a person's choice.
      expect(sql).toMatch(/if not exists \([\s\S]*column_name = 'counts_toward_goal'[\s\S]*\) then[\s\S]*update[\s\S]*end if;/);
    }
    expect(hosted).toContain("alter table public.categories");
    expect(hosted).toContain("table_schema = 'public'");
  });
});
