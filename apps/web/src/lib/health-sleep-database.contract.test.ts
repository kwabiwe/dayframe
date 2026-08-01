import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const localMigration = readFileSync(
  `${repositoryRoot}packages/db/migrations/001_init.sql`,
  "utf8"
);
const hostedMigration = readFileSync(
  `${repositoryRoot}supabase/migrations/202608010001_health_sleep_session_reconciliation.sql`,
  "utf8"
);

describe("Health sleep reconciliation database contract", () => {
  it("tracks explicit user edits in local and hosted schemas", () => {
    expect(localMigration).toContain("user_edited_at timestamptz");
    expect(localMigration).toContain("from information_schema.columns");
    expect(localMigration).toContain("alter table time_entries add column user_edited_at timestamptz");
    expect(hostedMigration).toContain("add column if not exists user_edited_at timestamptz");
    expect(hostedMigration).toContain("updated_at > created_at");
  });

  it("indexes only unprotected completed Health sleep entries for reconciliation", () => {
    for (const migration of [localMigration, hostedMigration]) {
      expect(migration).toContain("idx_time_entries_health_sleep_reconciliation");
      expect(migration).toContain("source = 'health_sleep'");
      expect(migration).toContain("user_edited_at is null");
      expect(migration).toContain("review_status in ('confirmed', 'accepted')");
    }
  });

  it("does not destructively clean up historical confirmed duplicates", () => {
    expect(hostedMigration).not.toMatch(/delete\s+from\s+public\.time_entries/i);
    expect(hostedMigration).not.toMatch(/update\s+public\.time_entries[\s\S]*set\s+(started_at|stopped_at)/i);
  });
});
