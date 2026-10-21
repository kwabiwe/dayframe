import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Archive place (location v3 PR 15, PRD D19 A10): places.archived_at in the hosted, local and base schemas.
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const localMigrations = readdirSync(`${repositoryRoot}packages/db/migrations`).filter((file) => file.endsWith(".sql")).sort();
const hostedMigrations = readdirSync(`${repositoryRoot}supabase/migrations`).filter((file) => file.endsWith(".sql")).sort();
const read = (path: string) => readFileSync(`${repositoryRoot}${path}`, "utf8");

describe("Archive place database contract", () => {
  it("orders the local migration after 015 and the hosted one after the 17 Oct RLS migrations", () => {
    expect(localMigrations.indexOf("016_place_archive.sql")).toBe(localMigrations.indexOf("015_log_trips_automatically.sql") + 1);
    expect(hostedMigrations.indexOf("202610210001_place_archive.sql"))
      .toBeGreaterThan(hostedMigrations.indexOf("202610170004_time_entry_tags_owner_writes.sql"));
  });

  it("adds one nullable timestamp, re-runnable, with no backfill", () => {
    const hosted = read("supabase/migrations/202610210001_place_archive.sql");
    for (const sql of [hosted, read("packages/db/migrations/016_place_archive.sql"), read("packages/db/migrations/001_init.sql")]) {
      expect(sql).toMatch(/add column if not exists archived_at timestamptz;/);
    }
    expect(hosted).toContain("alter table public.places");
    expect(hosted).not.toMatch(/\bupdate\b/i);
  });
});
