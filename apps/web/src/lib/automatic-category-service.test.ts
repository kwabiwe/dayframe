import { describe, expect, it, vi } from "vitest";
import {
  automaticLoggingCategorySpec,
  commuteCategorySpec,
  ensureCommuteCategoryId
} from "./automatic-category-service";
import type { RequestSession } from "./session";

const session: RequestSession = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  authMode: "dev",
  scopes: []
};

function clientWithRows(existingId?: string) {
  const query = vi.fn(async (statement: string) => {
    if (statement.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (statement.includes("from categories")) {
      return { rows: existingId ? [{ id: existingId }] : [] };
    }
    if (statement.includes("insert into categories")) {
      return { rows: [{ id: "created-commute" }] };
    }
    throw new Error(`Unexpected SQL: ${statement}`);
  });
  return { query } as unknown as import("pg").PoolClient;
}

describe("automatic category service", () => {
  it("defines the established semantic category palette", () => {
    expect(commuteCategorySpec()).toEqual({ name: "Commute", color: "sky" });
    expect(automaticLoggingCategorySpec("sleep")).toEqual({ name: "Sleep", color: "lime" });
    expect(automaticLoggingCategorySpec("health")).toEqual({ name: "Health", color: "moss" });
  });

  it("reuses an existing active Commute category case-insensitively", async () => {
    const client = clientWithRows("existing-commute");

    await expect(ensureCommuteCategoryId(client, session)).resolves.toBe("existing-commute");

    const calls = vi.mocked(client.query).mock.calls;
    expect(calls[0]?.[1]).toEqual([
      `dayframe:auto-category:${session.workspaceId}:commute`
    ]);
    expect(calls[1]?.[1]).toEqual([session.workspaceId, "Commute"]);
    expect(calls.some(([statement]) => String(statement).includes("insert into categories"))).toBe(false);
  });

  it("creates Commute with sky when no active category exists", async () => {
    const client = clientWithRows();

    await expect(ensureCommuteCategoryId(client, session)).resolves.toBe("created-commute");

    const insert = vi.mocked(client.query).mock.calls.find(([statement]) =>
      String(statement).includes("insert into categories")
    );
    expect(insert?.[1]).toEqual([session.workspaceId, "Commute", "sky"]);
  });
});
