import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const localBaseMigration = readFileSync(`${repositoryRoot}packages/db/migrations/001_init.sql`, "utf8");
const localUpgradeMigration = readFileSync(
  `${repositoryRoot}packages/db/migrations/002_tags.sql`,
  "utf8"
);
const localSetup = readFileSync(`${repositoryRoot}packages/db/scripts/setup.ts`, "utf8");
const hostedMigration = readFileSync(
  `${repositoryRoot}supabase/migrations/202607180001_tags.sql`,
  "utf8"
);

describe("tag database contract", () => {
  it("uses a normalized workspace unique key instead of a time-entry JSON field", () => {
    expect(localBaseMigration).toContain("unique (workspace_id, normalized_name)");
    expect(localBaseMigration).toContain("create table if not exists time_entry_tags");
    expect(localBaseMigration).not.toMatch(/time_entries[\s\S]{0,500}tags jsonb/);
    expect(localUpgradeMigration).toContain("drop constraint if exists tags_workspace_id_name_key");
  });

  it("enforces workspace identity on both sides of every association", () => {
    expect(localBaseMigration).toContain("foreign key (time_entry_id, workspace_id) references time_entries(id, workspace_id)");
    expect(localBaseMigration).toContain("foreign key (tag_id, workspace_id) references tags(id, workspace_id)");
    expect(localUpgradeMigration).toContain("foreign key (time_entry_id, workspace_id)");
    expect(localUpgradeMigration).toContain("foreign key (tag_id, workspace_id)");
    expect(hostedMigration).toContain("te.id = time_entry_id and te.workspace_id = workspace_id");
    expect(hostedMigration).toContain("tag.id = tag_id and tag.workspace_id = workspace_id");
  });

  it("keeps autocomplete and association lookups indexed", () => {
    expect(localUpgradeMigration).toContain("idx_tags_workspace_normalized_name");
    expect(localUpgradeMigration).toContain("idx_time_entry_tags_workspace_tag");
    expect(localUpgradeMigration).toContain("idx_time_entry_tags_workspace_entry");
  });

  it("applies every ordered local migration for existing databases", () => {
    expect(localSetup).toContain('readdirSync(resolve(root, "migrations"))');
    expect(localSetup).toContain('.sort()');
  });
});
