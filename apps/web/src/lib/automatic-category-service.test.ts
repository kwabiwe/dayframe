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
    if (statement.includes("starter_key = $2")) return { rows: [] };
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
  it("uses the starter activities for Sleep and Commute, and Health's own spec", () => {
    expect(commuteCategorySpec()).toEqual({ name: "Commute", color: "graphite", icon: "commute", starterKey: "commute" });
    expect(automaticLoggingCategorySpec("sleep")).toEqual({ name: "Sleep", color: "blue-bold", icon: "sleep", starterKey: "sleep" });
    expect(automaticLoggingCategorySpec("health")).toEqual({ name: "Health", color: "moss", icon: "health", starterKey: null });
  });

  it("finds a renamed Commute starter by its key before looking at names", async () => {
    const query = vi.fn(async (statement: string, params: unknown[] = []) => {
      if (statement.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (statement.includes("starter_key = $2")) return { rows: params[1] === "commute" ? [{ id: "renamed-commute" }] : [] };
      throw new Error(`Unexpected SQL: ${statement}`);
    });
    const client = { query } as unknown as import("pg").PoolClient;

    await expect(ensureCommuteCategoryId(client, session)).resolves.toBe("renamed-commute");
    expect(query.mock.calls.some(([statement]) => String(statement).includes("lower(name)"))).toBe(false);
  });

  it("reuses an existing active Commute category case-insensitively", async () => {
    const client = clientWithRows("existing-commute");

    await expect(ensureCommuteCategoryId(client, session)).resolves.toBe("existing-commute");

    const calls = vi.mocked(client.query).mock.calls;
    expect(calls[0]?.[1]).toEqual([
      `dayframe:auto-category:${session.workspaceId}:commute`
    ]);
    expect(calls[1]?.[1]).toEqual([session.workspaceId, "commute"]);
    expect(calls[2]?.[1]).toEqual([session.workspaceId, "Commute"]);
    expect(calls.some(([statement]) => String(statement).includes("insert into categories"))).toBe(false);
  });

  it("creates Commute as the starter (graphite, car icon, starter key) when no active category exists", async () => {
    const client = clientWithRows();

    await expect(ensureCommuteCategoryId(client, session)).resolves.toBe("created-commute");

    const insert = vi.mocked(client.query).mock.calls.find(([statement]) =>
      String(statement).includes("insert into categories")
    );
    expect(insert?.[1]).toEqual([session.workspaceId, "Commute", "graphite", "commute", "commute"]);
  });
});
