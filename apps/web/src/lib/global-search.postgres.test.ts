import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import type { RequestSession } from "./session";

const databaseUrl = process.env.DAYFRAME_HISTORY_FLAGS_TEST_DATABASE_URL;
let database: pg.Client;

vi.mock("./db", () => ({
  query: (text: string, values: unknown[]) => database.query(text, values)
}));

const { searchDayframe } = await import("./global-search");

describe.skipIf(!databaseUrl)("global search on disposable PostgreSQL", () => {
  it("uses a matching tag to find a block and keeps the full tag set for Start again", async () => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !url.pathname.endsWith("_test")) {
      throw new Error("Global search tests require a disposable local *_test database.");
    }

    database = new pg.Client({ connectionString: databaseUrl });
    await database.connect();
    try {
      await database.query("begin");
      const workspaceId = randomUUID();
      const userId = randomUUID();
      const session: RequestSession = { workspaceId, userId, authMode: "dev", scopes: ["app:read"] };
      await database.query("insert into workspaces (id, name) values ($1, 'Search tag regression')", [workspaceId]);
      await database.query("insert into users (id, email, name) values ($1, $2, 'Search tester')",
        [userId, `${userId}@example.test`]);
      const matchingTag = randomUUID();
      await database.query(
        "insert into tags (id, workspace_id, name, normalized_name) values ($1, $2, 'Search needle', 'search needle')",
        [matchingTag, workspaceId]
      );
      for (const name of ["Client one", "Client two"]) {
        const entryId = randomUUID();
        const otherTag = randomUUID();
        await database.query(
          `insert into time_entries (id, workspace_id, user_id, source, description, started_at, stopped_at)
           values ($1, $2, $3, 'manual_app', 'Quarterly memo', '2026-01-05T09:00:00Z', '2026-01-05T09:30:00Z')`,
          [entryId, workspaceId, userId]
        );
        await database.query("insert into tags (id, workspace_id, name, normalized_name) values ($1, $2, $3, lower($3))",
          [otherTag, workspaceId, name]);
        await database.query(
          "insert into time_entry_tags (workspace_id, time_entry_id, tag_id) values ($1, $2, $3), ($1, $2, $4)",
          [workspaceId, entryId, matchingTag, otherTag]
        );
      }

      const results = await searchDayframe("search needle", session);
      for (const kind of ["entry", "activity"]) {
        const matches = results.filter((result) => result.kind === kind);
        expect(matches.map((result) => [...result.tagNames].sort()).sort()).toEqual([
          ["Client one", "Search needle"],
          ["Client two", "Search needle"]
        ]);
      }
    } finally {
      await database.query("rollback");
      await database.end();
    }
  });
});
